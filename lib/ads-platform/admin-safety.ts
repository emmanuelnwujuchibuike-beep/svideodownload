import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { validateCampaignCreatives } from "./server";

/**
 * Part 8 — the admin's Traffic & safety centre, over what 0206 records:
 *
 *   flags     ad_risk_flags (open first). Each has its kind, severity,
 *             evidence counts and timestamps. It never carries an IP or an IP
 *             hash: evidence holds counts only.
 *   traffic   the last 7 days of qualifying vs filtered events, per campaign,
 *             and the filtered reasons (ad_invalid_daily)
 *   creatives the last 7 days of failed or blocked creatives, unsafe links and
 *             safety reviews
 *   payments  the count of open reconciliation items (the detail stays in
 *             Campaign payments)
 *   rules     the traffic thresholds in force, editable
 *
 * Reads are bounded (7 days, 100 rows), fetched when the tab opens, never polled.
 */

type Db = SupabaseClient;
const DAY = 86_400_000;

export const TRAFFIC_RULE_KEYS = [
  "max_events_per_minute_per_ip",
  "max_events_per_minute_per_visitor",
  "impressions_per_visitor_hour",
  "impressions_per_ip_hour",
  "clicks_per_visitor_day",
  "clicks_per_ip_day",
  "click_view_window_minutes",
  "min_completion_ratio",
  "flag_min_events",
  "flag_invalid_ratio",
  "flag_invalid_clicks",
  "flag_load_failures",
  "flag_self_traffic",
  "raw_retention_days",
  "ip_hash_retention_days",
  "flag_retention_days",
] as const;
export type TrafficRuleKey = (typeof TRAFFIC_RULE_KEYS)[number];

/** Sane bounds per rule - the database reads whatever is stored, so the bounds live here. */
const RULE_BOUNDS: Record<TrafficRuleKey, [number, number]> = {
  max_events_per_minute_per_ip: [50, 100_000],
  max_events_per_minute_per_visitor: [20, 10_000],
  impressions_per_visitor_hour: [1, 1000],
  impressions_per_ip_hour: [10, 100_000],
  clicks_per_visitor_day: [1, 100],
  clicks_per_ip_day: [1, 10_000],
  click_view_window_minutes: [1, 1440],
  min_completion_ratio: [0, 1],
  flag_min_events: [10, 1_000_000],
  flag_invalid_ratio: [0.05, 1],
  flag_invalid_clicks: [1, 1_000_000],
  flag_load_failures: [1, 1_000_000],
  flag_self_traffic: [1, 1_000_000],
  raw_retention_days: [7, 400],
  ip_hash_retention_days: [1, 35],
  flag_retention_days: [30, 3650],
};

export const rulesPatchSchema = z
  .record(z.enum(TRAFFIC_RULE_KEYS), z.number().finite())
  .refine((r) => Object.entries(r).every(([k, v]) => {
    const [lo, hi] = RULE_BOUNDS[k as TrafficRuleKey];
    return v >= lo && v <= hi;
  }), { message: "A value is outside its allowed range." });

export interface SafetyOverview {
  flags: {
    id: number;
    kind: string;
    severity: string;
    status: string;
    day: string;
    hits: number;
    evidence: Record<string, unknown>;
    firstSeen: string;
    lastSeen: string;
    resolutionNote: string | null;
    resolvedAt: string | null;
    campaign: { id: string; name: string; status: string } | null;
    advertiser: { id: string; name: string; status: string } | null;
  }[];
  traffic: { campaignId: string; name: string; qualifying: number; filtered: number; loadFailures: number }[];
  reasons: { reason: string; events: number }[];
  creatives: { id: string; campaignId: string; campaign: string; problem: string; detail: string | null; at: string | null }[];
  paymentIssues: number;
  rules: Record<string, number>;
  bounds: Record<string, [number, number]>;
}

export async function loadSafetyOverview(db: Db, view: "open" | "resolved" = "open"): Promise<SafetyOverview> {
  const since = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10);
  const sinceTs = new Date(Date.now() - 7 * DAY).toISOString();
  let flagsQ = db
    .from("ad_risk_flags")
    .select("id, kind, severity, status, day, hits, evidence, first_seen, last_seen, resolution_note, resolved_at, ad_campaigns(id, name, status), advertisers(id, business_name, status)")
    .order("last_seen", { ascending: false })
    .limit(100);
  flagsQ = view === "open" ? flagsQ.eq("status", "open") : flagsQ.neq("status", "open");
  const [flags, stats, reasons, badCreatives, payIssues, rules] = await Promise.all([
    flagsQ,
    db.from("ad_campaign_daily_stats").select("campaign_id, impressions, clicks, invalid_impressions, invalid_clicks, invalid_other, load_failures, ad_campaigns(name)").gte("day", since).limit(5000),
    db.from("ad_invalid_daily").select("reason, events").gte("day", since).limit(5000),
    db
      .from("ad_creatives")
      .select("id, campaign_id, validation_status, validation_errors, url_validation_status, url_block_reason, moderation_status, moderation_labels, updated_at, ad_campaigns!ad_creatives_campaign_id_fkey(name)")
      .gte("updated_at", sinceTs)
      .or("validation_status.in.(invalid,blocked),url_validation_status.in.(blocked,pending),moderation_status.in.(review,rejected)")
      .order("updated_at", { ascending: false })
      .limit(100),
    db.rpc("ad_payment_inconsistencies"),
    db.rpc("ad_traffic_rules"),
  ]);
  if (flags.error) throw new Error(`ad_risk_flags: ${flags.error.message}`);

  const per = new Map<string, { name: string; qualifying: number; filtered: number; loadFailures: number }>();
  for (const r of (stats.data ?? []) as unknown as { campaign_id: string; impressions: number; clicks: number; invalid_impressions: number; invalid_clicks: number; invalid_other: number; load_failures: number; ad_campaigns: { name: string } | null }[]) {
    const t = per.get(r.campaign_id) ?? { name: r.ad_campaigns?.name ?? "—", qualifying: 0, filtered: 0, loadFailures: 0 };
    t.qualifying += Number(r.impressions) + Number(r.clicks);
    t.filtered += Number(r.invalid_impressions) + Number(r.invalid_clicks) + Number(r.invalid_other);
    t.loadFailures += Number(r.load_failures);
    per.set(r.campaign_id, t);
  }
  const reasonTotals = new Map<string, number>();
  for (const r of (reasons.data ?? []) as { reason: string; events: number }[]) reasonTotals.set(r.reason, (reasonTotals.get(r.reason) ?? 0) + Number(r.events));

  return {
    flags: ((flags.data ?? []) as unknown as Record<string, unknown>[]).map((f) => {
      const c = f.ad_campaigns as { id: string; name: string; status: string } | null;
      const a = f.advertisers as { id: string; business_name: string; status: string } | null;
      return {
        id: Number(f.id),
        kind: f.kind as string,
        severity: f.severity as string,
        status: f.status as string,
        day: f.day as string,
        hits: Number(f.hits),
        evidence: (f.evidence as Record<string, unknown>) ?? {},
        firstSeen: f.first_seen as string,
        lastSeen: f.last_seen as string,
        resolutionNote: (f.resolution_note as string | null) ?? null,
        resolvedAt: (f.resolved_at as string | null) ?? null,
        campaign: c ? { id: c.id, name: c.name, status: c.status } : null,
        advertiser: a ? { id: a.id, name: a.business_name, status: a.status } : null,
      };
    }),
    traffic: [...per.entries()]
      .map(([campaignId, t]) => ({ campaignId, ...t }))
      .sort((x, y) => y.filtered - x.filtered || y.qualifying - x.qualifying)
      .slice(0, 50),
    reasons: [...reasonTotals.entries()].map(([reason, events]) => ({ reason, events })).sort((x, y) => y.events - x.events),
    creatives: ((badCreatives.data ?? []) as unknown as Record<string, unknown>[]).map((c) => {
      const problem =
        c.moderation_status === "rejected" ? "content_rejected"
        : c.validation_status === "blocked" ? "creative_blocked"
        : c.validation_status === "invalid" ? "creative_invalid"
        : c.url_validation_status === "blocked" ? "link_blocked"
        : c.url_validation_status === "pending" ? "link_review"
        : "safety_review";
      const detail = problem.startsWith("link") ? ((c.url_block_reason as string | null) ?? null) : [...((c.validation_errors as string[]) ?? []), ...((c.moderation_labels as string[]) ?? [])].join(", ") || null;
      return { id: c.id as string, campaignId: c.campaign_id as string, campaign: (c.ad_campaigns as { name: string } | null)?.name ?? "—", problem, detail, at: (c.updated_at as string | null) ?? null };
    }),
    paymentIssues: Array.isArray(payIssues.data) ? payIssues.data.length : 0,
    rules: Object.fromEntries(Object.entries((rules.data as Record<string, unknown>) ?? {}).map(([k, v]) => [k, Number(v)])),
    bounds: RULE_BOUNDS,
  };
}

export async function resolveFlag(db: Db, adminId: string, input: { id: number; action: "dismiss" | "confirm"; note: string; exclude: boolean }) {
  const { data, error } = await db.rpc("admin_resolve_ad_risk_flag", { p_flag: input.id, p_action: input.action, p_admin: adminId, p_note: input.note, p_exclude: input.exclude });
  if (error) throw new Error(`resolve flag: ${error.message}`);
  return (data ?? { ok: false, reason: "no_result" }) as { ok: boolean; reason?: string; excluded?: unknown };
}

/**
 * An admin's "revalidate": re-run every check on a campaign's active creatives
 * - format, the deep link check (safety, blocklist, reputation, redirects) -
 * and write the verdicts. A creative that fails stops serving within one
 * serving bucket (the snapshot serves valid creatives only).
 */
export async function revalidateCampaign(db: Db, campaignId: string) {
  return validateCampaignCreatives(db, campaignId);
}

export async function saveTrafficRules(db: Db, patch: Partial<Record<TrafficRuleKey, number>>): Promise<Record<string, unknown>> {
  const { data: cur } = await db.from("ad_platform_settings").select("traffic_rules").eq("id", true).maybeSingle();
  const next = { ...((cur?.traffic_rules as Record<string, unknown>) ?? {}), ...patch };
  const { error } = await db.from("ad_platform_settings").update({ traffic_rules: next, updated_at: new Date().toISOString() }).eq("id", true);
  if (error) throw new Error(`traffic rules: ${error.message}`);
  return next;
}
