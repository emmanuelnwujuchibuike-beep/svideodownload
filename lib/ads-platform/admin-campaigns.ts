import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { notifyAdvertiser } from "./ad-notify";
import { actionsFor, type AdminCampaignView, ADMIN_CAMPAIGN_VIEWS, type AdvertiserStatus, type ModerationAction } from "./admin-shared";

/**
 * Part 7 — the admin's side of self-serve campaigns. Reads are plain selects
 * with the service role (fetched when the admin opens the panel, never polled).
 * Every decision is ONE database function under a row lock with the version
 * the admin saw (0204): admin_moderate_ad_campaign, admin_set_ad_refund,
 * admin_set_advertiser_status. Nothing here moves money: a refund is paid in
 * the provider dashboard and its webhook records it on the payment
 * (ad_payment_reverse); this records what is owed and the admin's decision.
 */

type Db = SupabaseClient;

export { ADVERTISER_STATUSES, MODERATION_ACTIONS } from "./admin-shared";

const CAMPAIGN_STATUSES = ["draft", "awaiting_payment", "payment_processing", "paid", "validating", "active", "paused", "expired", "rejected", "cancelled", "removed"];

/** The statuses each view shows. `refunds` filters on refund_status instead. */
const VIEW_STATUSES: Record<Exclude<AdminCampaignView, "refunds">, string[] | null> = {
  review: ["paid", "validating"],
  live: ["active", "paused"],
  all: null,
};

export interface AdminCreative {
  id: string;
  mediaType: string;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  headline: string | null;
  description: string | null;
  destinationUrl: string | null;
  validationStatus: string;
  validationErrors: string[];
  urlStatus: string;
  urlBlockReason: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
}

export interface AdminCampaignRow {
  id: string;
  name: string;
  status: string;
  statusReason: string | null;
  version: number;
  advertiser: { id: string; name: string; status: string } | null;
  placement: { code: string; name: string; format: string } | null;
  durationDays: number | null;
  extraDays: number;
  currency: string | null;
  totalMinor: number | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  paidAt: string | null;
  createdAt: string;
  startAt: string | null;
  endAt: string | null;
  startedAt: string | null;
  flags: string[];
  refund: { status: string; owedMinor: number | null; note: string | null; decidedAt: string | null };
  /** 0211: dashboard figures multiplier (1 = real, 10 = test mode) */
  statsMultiplier: number;
  creatives: AdminCreative[];
  impressions: number;
  clicks: number;
  actions: ModerationAction[];
}

export interface AdminCampaignFilters {
  view?: string;
  status?: string;
  q?: string;
  limit?: number;
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function listAdminCampaigns(db: Db, f: AdminCampaignFilters): Promise<{ rows: AdminCampaignRow[]; counts: Record<AdminCampaignView, number> }> {
  const view: AdminCampaignView = (ADMIN_CAMPAIGN_VIEWS as readonly string[]).includes(f.view ?? "") ? (f.view as AdminCampaignView) : "review";
  let q = db
    .from("ad_campaigns")
    .select(
      "id, name, status, status_reason, version, duration_days, extra_days, currency, total_amount_minor, payment_method, payment_reference, payment_verified_at, created_at, start_at, end_at, started_at, review_flags, refund_status, refund_owed_minor, refund_note, refund_decided_at, stats_multiplier, advertisers(id, business_name, status), ad_placements(code, name, format_code)",
    )
    .order("updated_at", { ascending: false })
    .limit(Math.min(100, Math.max(1, f.limit ?? 50)));
  if (view === "refunds") q = q.eq("refund_status", "owed");
  else if (VIEW_STATUSES[view]) q = q.in("status", VIEW_STATUSES[view]!);
  if (f.status && CAMPAIGN_STATUSES.includes(f.status)) q = q.eq("status", f.status);
  const term = (f.q ?? "").trim().slice(0, 80).replace(/[%_,()]/g, " ").trim();
  if (term) q = q.ilike("name", `%${term}%`);
  const { data, error } = await q;
  if (error) throw new Error(`admin campaigns: ${error.message}`);
  const camps = (data ?? []) as unknown as Record<string, unknown>[];
  const ids = camps.map((c) => c.id as string);

  const [creatives, stats, counts] = await Promise.all([
    ids.length
      ? db
          .from("ad_creatives")
          .select("id, campaign_id, media_type, media_url, thumbnail_url, headline, description, destination_url, validation_status, validation_errors, url_validation_status, url_block_reason, duration_seconds, width, height")
          .in("campaign_id", ids)
          .eq("status", "active")
      : Promise.resolve({ data: [] }),
    ids.length ? db.from("ad_campaign_daily_stats").select("campaign_id, impressions, clicks").in("campaign_id", ids) : Promise.resolve({ data: [] }),
    viewCounts(db),
  ]);

  const byCampaign = new Map<string, AdminCreative[]>();
  for (const c of (creatives.data ?? []) as Record<string, unknown>[]) {
    const list = byCampaign.get(c.campaign_id as string) ?? [];
    list.push({
      id: c.id as string,
      mediaType: c.media_type as string,
      mediaUrl: (c.media_url as string | null) ?? null,
      thumbnailUrl: (c.thumbnail_url as string | null) ?? null,
      headline: (c.headline as string | null) ?? null,
      description: (c.description as string | null) ?? null,
      destinationUrl: (c.destination_url as string | null) ?? null,
      validationStatus: c.validation_status as string,
      validationErrors: (c.validation_errors as string[] | null) ?? [],
      urlStatus: c.url_validation_status as string,
      urlBlockReason: (c.url_block_reason as string | null) ?? null,
      durationSeconds: n(c.duration_seconds),
      width: n(c.width),
      height: n(c.height),
    });
    byCampaign.set(c.campaign_id as string, list);
  }
  const totals = new Map<string, { impressions: number; clicks: number }>();
  for (const s of (stats.data ?? []) as { campaign_id: string; impressions: number; clicks: number }[]) {
    const t = totals.get(s.campaign_id) ?? { impressions: 0, clicks: 0 };
    t.impressions += Number(s.impressions) || 0;
    t.clicks += Number(s.clicks) || 0;
    totals.set(s.campaign_id, t);
  }

  const rows = camps.map((c): AdminCampaignRow => {
    const adv = c.advertisers as { id: string; business_name: string; status: string } | null;
    const pl = c.ad_placements as { code: string; name: string; format_code: string } | null;
    const id = c.id as string;
    return {
      id,
      name: c.name as string,
      status: c.status as string,
      statusReason: (c.status_reason as string | null) ?? null,
      version: Number(c.version),
      advertiser: adv ? { id: adv.id, name: adv.business_name, status: adv.status } : null,
      placement: pl ? { code: pl.code, name: pl.name, format: pl.format_code } : null,
      durationDays: n(c.duration_days),
      extraDays: Number(c.extra_days ?? 0),
      currency: (c.currency as string | null) ?? null,
      totalMinor: n(c.total_amount_minor),
      paymentMethod: (c.payment_method as string | null) ?? null,
      paymentReference: (c.payment_reference as string | null) ?? null,
      paidAt: (c.payment_verified_at as string | null) ?? null,
      createdAt: c.created_at as string,
      startAt: (c.start_at as string | null) ?? null,
      endAt: (c.end_at as string | null) ?? null,
      startedAt: (c.started_at as string | null) ?? null,
      flags: (c.review_flags as string[] | null) ?? [],
      refund: { status: c.refund_status as string, owedMinor: n(c.refund_owed_minor), note: (c.refund_note as string | null) ?? null, decidedAt: (c.refund_decided_at as string | null) ?? null },
      statsMultiplier: Number(c.stats_multiplier ?? 1),
      creatives: byCampaign.get(id) ?? [],
      impressions: totals.get(id)?.impressions ?? 0,
      clicks: totals.get(id)?.clicks ?? 0,
      actions: actionsFor(c.status as string),
    };
  });
  return { rows, counts };
}

/** How many campaigns wait in each view — head-only counts, no rows. */
async function viewCounts(db: Db): Promise<Record<AdminCampaignView, number>> {
  const head = { count: "exact" as const, head: true };
  const [review, live, refunds, all] = await Promise.all([
    db.from("ad_campaigns").select("id", head).in("status", VIEW_STATUSES.review!),
    db.from("ad_campaigns").select("id", head).in("status", VIEW_STATUSES.live!),
    db.from("ad_campaigns").select("id", head).eq("refund_status", "owed"),
    db.from("ad_campaigns").select("id", head),
  ]);
  return { review: review.count ?? 0, live: live.count ?? 0, refunds: refunds.count ?? 0, all: all.count ?? 0 };
}

export interface AdminCampaignEvent {
  kind: string;
  from: string | null;
  to: string | null;
  role: string;
  reason: string | null;
  at: string;
}

export async function campaignEvents(db: Db, campaignId: string): Promise<AdminCampaignEvent[]> {
  const { data, error } = await db
    .from("ad_campaign_events")
    .select("kind, from_status, to_status, actor_role, reason, created_at")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) throw new Error(`campaign events: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((e) => ({
    kind: e.kind as string,
    from: (e.from_status as string | null) ?? null,
    to: (e.to_status as string | null) ?? null,
    role: e.actor_role as string,
    reason: (e.reason as string | null) ?? null,
    at: e.created_at as string,
  }));
}

export type RpcResult = { ok: boolean; reason?: string; [k: string]: unknown };

/** One moderation decision. The advertiser hears about it; a notice never decides the outcome. */
export async function moderateCampaign(db: Db, adminId: string, input: { id: string; action: ModerationAction; version: number | null; reason: string | null }): Promise<RpcResult> {
  const { data, error } = await db.rpc("admin_moderate_ad_campaign", {
    p_campaign: input.id,
    p_action: input.action,
    p_expected_version: input.version,
    p_admin: adminId,
    p_reason: input.reason,
  });
  if (error) throw new Error(`moderate: ${error.message}`);
  const out = (data ?? { ok: false, reason: "no_result" }) as RpcResult;
  if (out.ok && !out.already_active) {
    const notice = noticeFor(input.action, out, input.reason);
    if (notice) await notifyAdvertiser(db, input.id, notice);
  }
  return out;
}

function noticeFor(action: ModerationAction, out: RpcResult, reason: string | null): Parameters<typeof notifyAdvertiser>[2] | null {
  switch (action) {
    case "approve":
      return { kind: "activated", endAt: (out.end_at as string | null) ?? null };
    case "resume":
      return { kind: "resumed" };
    case "pause":
      return { kind: "paused_by_frenzsave" };
    case "reject":
      return { kind: "rejected", reason, refundOwed: Number(out.refund_owed ?? 0) > 0 };
    case "remove":
      return { kind: "removed", reason, refundOwed: Number(out.refund_owed ?? 0) > 0 };
  }
}

export async function setRefund(db: Db, adminId: string, input: { id: string; status: "refunded" | "waived"; note: string | null }): Promise<RpcResult> {
  const { data, error } = await db.rpc("admin_set_ad_refund", { p_campaign: input.id, p_status: input.status, p_admin: adminId, p_note: input.note });
  if (error) throw new Error(`refund: ${error.message}`);
  return (data ?? { ok: false, reason: "no_result" }) as RpcResult;
}

/* ─────────────────────────────── advertisers ─────────────────────────────── */

export interface AdminAdvertiserRow {
  id: string;
  businessName: string;
  displayName: string;
  contactEmail: string | null;
  website: string | null;
  status: string;
  statusReason: string | null;
  createdAt: string;
  campaigns: number;
  live: number;
}

export async function listAdvertisers(db: Db, q?: string): Promise<AdminAdvertiserRow[]> {
  let query = db
    .from("advertisers")
    .select("id, business_name, display_name, contact_email, website_url, status, status_reason, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  const term = (q ?? "").trim().slice(0, 80).replace(/[%_,()]/g, " ").trim();
  if (term) query = query.ilike("business_name", `%${term}%`);
  const { data, error } = await query;
  if (error) throw new Error(`advertisers: ${error.message}`);
  const rows = (data ?? []) as Record<string, unknown>[];
  const ids = rows.map((r) => r.id as string);
  const { data: camps } = ids.length ? await db.from("ad_campaigns").select("advertiser_id, status").in("advertiser_id", ids) : { data: [] };
  const tally = new Map<string, { campaigns: number; live: number }>();
  for (const c of (camps ?? []) as { advertiser_id: string; status: string }[]) {
    const t = tally.get(c.advertiser_id) ?? { campaigns: 0, live: 0 };
    t.campaigns += 1;
    if (c.status === "active") t.live += 1;
    tally.set(c.advertiser_id, t);
  }
  return rows.map((r) => ({
    id: r.id as string,
    businessName: r.business_name as string,
    displayName: r.display_name as string,
    contactEmail: (r.contact_email as string | null) ?? null,
    website: (r.website_url as string | null) ?? null,
    status: r.status as string,
    statusReason: (r.status_reason as string | null) ?? null,
    createdAt: r.created_at as string,
    campaigns: tally.get(r.id as string)?.campaigns ?? 0,
    live: tally.get(r.id as string)?.live ?? 0,
  }));
}

export async function setAdvertiserStatus(db: Db, adminId: string, input: { id: string; status: AdvertiserStatus; reason: string | null }): Promise<RpcResult> {
  const { data, error } = await db.rpc("admin_set_advertiser_status", { p_advertiser: input.id, p_status: input.status, p_admin: adminId, p_reason: input.reason });
  if (error) throw new Error(`advertiser status: ${error.message}`);
  return (data ?? { ok: false, reason: "no_result" }) as RpcResult;
}

/** 0211: switch a campaign's dashboard figures between real (1) and test mode (10). Display only. */
export async function setStatsBoost(db: Db, adminId: string, input: { id: string; multiplier: 1 | 10 }): Promise<{ ok: boolean; reason?: string; multiplier?: number }> {
  const { data, error } = await db.rpc("admin_set_ad_stats_boost", { p_campaign: input.id, p_multiplier: input.multiplier, p_admin: adminId });
  if (error) throw new Error(`stats boost: ${error.message}`);
  return data as { ok: boolean; reason?: string; multiplier?: number };
}
