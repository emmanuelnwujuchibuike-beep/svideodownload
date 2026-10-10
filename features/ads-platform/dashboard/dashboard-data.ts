"use client";

import { adMessage } from "@/lib/ads-platform/messages";
import { getClient } from "@/lib/supabase/client-lazy";

/**
 * The advertiser dashboard's data (Part 6).
 *
 * READS go straight from the browser to Postgres with the member's own session:
 * Row Level Security (0195/0198) returns only their campaigns, creatives,
 * stats, extensions and audit; their payments and totals come from two
 * owner-scoped functions (ad_my_summary / ad_my_payments). No Vercel or
 * Railway function runs to read a dashboard, and nothing polls — a page reads
 * once when it opens and again only after an action.
 *
 * Totals come from the per-day aggregate table, never from raw events, so a
 * dashboard read is a handful of small rows however busy a campaign is. Every
 * number is the database's own count, unadjusted - except campaigns an admin put in
 * test mode (0211), which show x10 and say so.
 *
 * ACTIONS go through one route (/api/ads/advertiser/manage), which re-checks
 * ownership and state in the database under a row lock.
 */

export interface Summary {
  total: number;
  live: number;
  awaiting_payment: number;
  validating: number;
  paused: number;
  expired: number;
  impressions: number;
  clicks: number;
  reward_completes: number;
  video_completes: number;
  /** 0201: members who opened the ad's details on Frenzsave (also counted as clicks) */
  conversions: number;
  /** 0212: campaigns an admin put in test mode (figures shown x10) */
  boosted: number;
  /** 0201: members who then chose to visit the site after the external-link warning */
  outbounds: number;
  spend_usd_cents: number;
}

export interface CampaignCreative {
  id: string;
  status: string;
  media_type: "image" | "video";
  media_url: string | null;
  thumbnail_url: string | null;
  destination_url: string | null;
  headline: string | null;
  description: string | null;
  validation_status: string;
  validation_errors: string[] | null;
  url_validation_status: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | string | null;
  updated_at: string;
}

export interface CampaignRow {
  id: string;
  name: string;
  status: string;
  status_reason: string | null;
  version: number;
  duration_days: number | null;
  extra_days: number;
  start_at: string | null;
  end_at: string | null;
  payment_verified_at: string | null;
  payment_reference: string | null;
  total_amount_minor: number | null;
  currency: string | null;
  created_at: string;
  updated_at: string;
  ad_placements: { code: string; name: string; format_code: string } | null;
  ad_creatives: CampaignCreative[];
}

export interface StatRow {
  campaign_id: string;
  creative_id: string;
  day: string;
  impressions: number;
  clicks: number;
  video_starts: number;
  video_completes: number;
  reward_starts: number;
  reward_completes: number;
  conversions?: number;
  outbounds?: number;
  /** 0206 (Part 8): events filtered as invalid traffic - counted apart, never in the figures above */
  invalid_impressions?: number;
  invalid_clicks?: number;
}

export interface Totals {
  views: number;
  clicks: number;
  ctr: number | null;
  videoPlays: number;
  videoCompletes: number;
  rewardCompletes: number;
  conversions: number;
  outbounds: number;
  /** views and clicks filtered as invalid traffic (Part 8) */
  filtered: number;
}

export interface PaymentRow {
  reference: string;
  provider: string;
  status: string;
  usd_cents: number;
  currency: string;
  provider_amount: number | null;
  provider_currency: string | null;
  paid_amount: number | null;
  paid_currency: string | null;
  created_at: string;
  verified_at: string | null;
  refunded_amount: number | null;
  refunded_at: string | null;
  kind: "application" | "extension" | null;
  promotion_id: string | null;
  bonus_days: number | null;
  campaign_id: string | null;
}

const CAMPAIGN_COLUMNS =
  "id, name, status, status_reason, version, duration_days, extra_days, start_at, end_at, payment_verified_at, payment_reference, total_amount_minor, currency, created_at, updated_at, ad_placements(code, name, format_code), ad_creatives!ad_creatives_campaign_id_fkey(id, status, media_type, media_url, thumbnail_url, destination_url, headline, description, validation_status, validation_errors, url_validation_status, width, height, duration_seconds, updated_at)";

export async function loadSummary(): Promise<Summary | null> {
  const sb = await getClient();
  const { data, error } = await sb.rpc("ad_my_summary", { p_from: null });
  if (error || !data) return null;
  const d = data as Record<string, number | string>;
  const n = (k: string) => Number(d[k] ?? 0);
  return { total: n("total"), live: n("live"), awaiting_payment: n("awaiting_payment"), validating: n("validating"), paused: n("paused"), expired: n("expired"), impressions: n("impressions"), clicks: n("clicks"), reward_completes: n("reward_completes"), video_completes: n("video_completes"), conversions: n("conversions"), boosted: n("boosted"), outbounds: n("outbounds"), spend_usd_cents: n("spend_usd_cents") };
}

export type SortKey = "newest" | "oldest" | "ending" | "name";
export const PAGE_SIZE = 10;

/** One page of the advertiser's campaigns — search, status filter, sort, paginate, all in the database. */
export async function loadCampaigns(opts: { search: string; statuses: string[] | null; sort: SortKey; page: number }): Promise<{ rows: CampaignRow[]; total: number }> {
  const sb = await getClient();
  let q = sb.from("ad_campaigns").select(CAMPAIGN_COLUMNS, { count: "exact" }).neq("status", "cancelled");
  const term = opts.search.trim().replace(/[%_,()]/g, " ").slice(0, 80);
  if (term) q = q.ilike("name", `%${term}%`);
  if (opts.statuses?.length) q = q.in("status", opts.statuses);
  q =
    opts.sort === "oldest" ? q.order("created_at", { ascending: true })
    : opts.sort === "ending" ? q.order("end_at", { ascending: true, nullsFirst: false })
    : opts.sort === "name" ? q.order("name", { ascending: true })
    : q.order("created_at", { ascending: false });
  const from = Math.max(0, opts.page) * PAGE_SIZE;
  const { data, count } = await q.range(from, from + PAGE_SIZE - 1);
  return { rows: (data ?? []) as unknown as CampaignRow[], total: count ?? 0 };
}

export async function loadCampaign(id: string): Promise<CampaignRow | null> {
  const sb = await getClient();
  const { data } = await sb.from("ad_campaigns").select(CAMPAIGN_COLUMNS).eq("id", id).maybeSingle();
  return (data as unknown as CampaignRow | null) ?? null;
}

/** Daily aggregate rows for some campaigns (all of mine when `ids` is null), from a day on. */
export async function loadStats(ids: readonly string[] | null, fromDay: string | null): Promise<StatRow[]> {
  return applyBoost(await loadStatsRaw(ids, fromDay));
}

/**
 * 0211 admin test mode: campaigns whose figures are shown x10. Display only -
 * the stored counts are untouched. Fails open: before the migration runs, or on
 * any error, nothing is scaled.
 */
export async function loadBoosts(): Promise<Map<string, number>> {
  try {
    const sb = await getClient();
    const { data, error } = await sb.from("ad_campaigns").select("id, stats_multiplier").gt("stats_multiplier", 1);
    if (error || !data) return new Map();
    return new Map((data as { id: string; stats_multiplier: number }[]).map((r) => [r.id, Number(r.stats_multiplier)]));
  } catch {
    return new Map();
  }
}

async function applyBoost(rows: StatRow[]): Promise<StatRow[]> {
  const boosts = await loadBoosts();
  if (boosts.size === 0) return rows;
  return rows.map((r) => {
    const m = boosts.get(r.campaign_id);
    if (!m) return r;
    return { ...r, impressions: r.impressions * m, clicks: r.clicks * m, video_starts: r.video_starts * m, video_completes: r.video_completes * m, reward_starts: r.reward_starts * m, reward_completes: r.reward_completes * m, conversions: (r.conversions ?? 0) * m, outbounds: (r.outbounds ?? 0) * m };
  });
}

async function loadStatsRaw(ids: readonly string[] | null, fromDay: string | null): Promise<StatRow[]> {
  const sb = await getClient();
  if (ids && ids.length === 0) return [];
  const read = (cols: string) => {
    let q = sb.from("ad_campaign_daily_stats").select(cols);
    if (ids) q = q.in("campaign_id", ids as string[]);
    if (fromDay) q = q.gte("day", fromDay);
    return q.order("day", { ascending: true }).limit(5000);
  };
  const base = "campaign_id, creative_id, day, impressions, clicks, video_starts, video_completes, reward_starts, reward_completes";
  // 0206's and 0201's columns; a database without them yet (the deploy window) answers an older shape instead of nothing
  const with206 = await read(`${base}, conversions, outbounds, invalid_impressions, invalid_clicks`);
  if (!with206.error) return (with206.data ?? []) as unknown as StatRow[];
  const withNew = await read(`${base}, conversions, outbounds`);
  if (!withNew.error) return (withNew.data ?? []) as unknown as StatRow[];
  const { data } = await read(base);
  return (data ?? []) as unknown as StatRow[];
}

export function totalsOf(rows: readonly StatRow[]): Totals {
  const t = rows.reduce(
    (a, r) => ({ views: a.views + r.impressions, clicks: a.clicks + r.clicks, videoPlays: a.videoPlays + r.video_starts, videoCompletes: a.videoCompletes + r.video_completes, rewardCompletes: a.rewardCompletes + r.reward_completes, conversions: a.conversions + (r.conversions ?? 0), outbounds: a.outbounds + (r.outbounds ?? 0), filtered: a.filtered + (r.invalid_impressions ?? 0) + (r.invalid_clicks ?? 0) }),
    { views: 0, clicks: 0, videoPlays: 0, videoCompletes: 0, rewardCompletes: 0, conversions: 0, outbounds: 0, filtered: 0 },
  );
  // CTR = qualifying clicks ÷ qualifying views; "—" with no views (never a made-up 0 %)
  return { ...t, ctr: t.views > 0 ? t.clicks / t.views : null };
}

export function byCampaign(rows: readonly StatRow[]): Map<string, Totals> {
  const groups = new Map<string, StatRow[]>();
  for (const r of rows) groups.set(r.campaign_id, [...(groups.get(r.campaign_id) ?? []), r]);
  return new Map([...groups].map(([k, v]) => [k, totalsOf(v)]));
}

export function byDay(rows: readonly StatRow[]): { day: string; views: number; clicks: number }[] {
  const m = new Map<string, { views: number; clicks: number }>();
  for (const r of rows) {
    const d = m.get(r.day) ?? { views: 0, clicks: 0 };
    m.set(r.day, { views: d.views + r.impressions, clicks: d.clicks + r.clicks });
  }
  return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v }));
}

export async function loadPayments(page = 0, size = 25): Promise<PaymentRow[]> {
  const sb = await getClient();
  const { data, error } = await sb.rpc("ad_my_payments", { p_limit: size, p_offset: page * size });
  if (error || !Array.isArray(data)) return [];
  return data as PaymentRow[];
}

export interface CampaignEvent {
  kind: string;
  from_status: string | null;
  to_status: string | null;
  actor_role: string;
  created_at: string;
}

/** The campaign's history (own rows only, RLS) — the audit the advertiser may see. */
export async function loadHistory(campaignId: string): Promise<CampaignEvent[]> {
  const sb = await getClient();
  const { data } = await sb.from("ad_campaign_events").select("kind, from_status, to_status, actor_role, created_at").eq("campaign_id", campaignId).order("created_at", { ascending: false }).limit(50);
  return (data ?? []) as CampaignEvent[];
}

export interface ExtensionRow {
  id: string;
  status: string;
  days: number;
  extra_days: number;
  total_minor: number;
  currency: string;
  new_end_at: string | null;
  created_at: string;
}

export async function loadExtensions(campaignId: string): Promise<ExtensionRow[]> {
  const sb = await getClient();
  const { data } = await sb.from("ad_campaign_extensions").select("id, status, days, extra_days, total_minor, currency, new_end_at, created_at").eq("campaign_id", campaignId).neq("status", "cancelled").order("created_at", { ascending: false }).limit(20);
  return (data ?? []) as ExtensionRow[];
}

/* ─────────────────────────────── actions ─────────────────────────────── */

export async function manage<T>(body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; message: string; code?: string }> {
  try {
    const res = await fetch("/api/ads/advertiser/manage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => null)) as (T & { message?: string; error?: string }) | null;
    if (!res.ok || !json) return { ok: false, message: json?.message ?? adMessage("server"), code: json?.error };
    return { ok: true, data: json };
  } catch {
    return { ok: false, message: "You appear to be offline. Please check your connection and try again." };
  }
}

/* ─────────────────────────────── display ─────────────────────────────── */

export type Tone = "emerald" | "indigo" | "amber" | "rose" | "slate";

/** The status an advertiser reads — from the SERVER's status, never guessed. */
export function statusLabel(c: Pick<CampaignRow, "status" | "status_reason" | "start_at" | "end_at" | "ad_creatives">, now = Date.now()): { text: string; tone: Tone } {
  const editing = c.ad_creatives?.some((x) => x.status === "staged" && x.validation_status === "pending");
  const blocked = c.ad_creatives?.some((x) => x.status === "active" && x.validation_status === "blocked");
  if (blocked || c.status === "removed") return { text: "Blocked", tone: "rose" };
  switch (c.status) {
    case "active":
      if (c.start_at && Date.parse(c.start_at) > now) return { text: "Scheduled", tone: "indigo" };
      return editing ? { text: "Live · update checking", tone: "emerald" } : { text: "Live", tone: "emerald" };
    case "paid":
      return { text: "Verifying payment", tone: "indigo" };
    case "validating":
      return { text: "Validating", tone: "amber" };
    case "payment_processing":
      return { text: "Payment processing", tone: "indigo" };
    case "awaiting_payment":
      return { text: "Ready for payment", tone: "indigo" };
    case "draft":
      return { text: "Draft", tone: "slate" };
    case "paused":
      return { text: c.status_reason === "advertiser_paused" ? "Paused" : "Paused by Frenzsave", tone: "amber" };
    case "expired":
      return { text: "Expired", tone: "slate" };
    case "rejected":
      return { text: "Failed checks", tone: "rose" };
    default:
      return { text: c.status, tone: "slate" };
  }
}

export const usd = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const num = (n: number) => n.toLocaleString("en-US");
export const pct = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(r < 0.01 ? 2 : 1)}%`);
export const date = (v: string | null) => (v ? new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

export function remaining(endAt: string | null, now = Date.now()): string | null {
  if (!endAt) return null;
  const ms = Date.parse(endAt) - now;
  if (ms <= 0) return "Ended";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return days > 0 ? `${days} day${days === 1 ? "" : "s"} left` : `${Math.max(1, hours)} hour${hours === 1 ? "" : "s"} left`;
}

export function liveCreative(c: Pick<CampaignRow, "ad_creatives">): CampaignCreative | null {
  return c.ad_creatives?.find((x) => x.status === "active") ?? null;
}
