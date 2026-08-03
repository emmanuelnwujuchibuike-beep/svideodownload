import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin analytics reads over the Phase-1 tables plus the monetization + security
 * tables. Totals use accurate COUNT filters; breakdowns, timeseries + unique/live
 * visitor tallies use a capped recent sample aggregated in JS (exact grouped/distinct
 * aggregates at very high volume are a later phase via a SQL RPC). Degrades to zeros
 * before the analytics tables exist — every block is independently try/caught so one
 * missing table never blanks the whole dashboard.
 */
export type Range = "24h" | "7d" | "30d";

export interface Breakdown {
  key: string;
  count: number;
}

export interface TimeBucket {
  /** ISO start-of-bucket. */
  t: string;
  visitors: number;
  pageViews: number;
  downloads: number;
}

export interface AdZoneStat {
  key: string;
  impressions: number;
  clicks: number;
  ctr: number; // percent
  revenueUsd: number;
}

export interface AdAnalytics {
  impressions: number;
  clicks: number;
  ctr: number; // percent
  cpmUsd: number; // configurable estimate rate
  revenueUsd: number; // impressions / 1000 * cpm
  byZone: AdZoneStat[];
}

export interface Engagement {
  topPages: Breakdown[];
  topReferrers: Breakdown[];
  newVisitors: number;
  returningVisitors: number;
}

export interface MonitorRow {
  at: string;
  label: string;
  detail: string;
}

export interface Monitoring {
  errorRatePct: number; // failed / (completed + failed)
  failedDownloads: number;
  recentErrors: MonitorRow[];
  recentSecurity: MonitorRow[];
}

export interface AnalyticsSummary {
  range: Range;
  liveVisitors: number;
  uniqueVisitors: number;
  sessions: number;
  pageViews: number;
  totalEvents: number;
  downloads: { total: number; completed: number; failed: number; successRate: number };
  topPlatforms: Breakdown[];
  byDevice: Breakdown[];
  byBrowser: Breakdown[];
  byCountry: Breakdown[];
  timeseries: { granularity: "hour" | "day"; buckets: TimeBucket[] };
  ads: AdAnalytics;
  engagement: Engagement;
  monitoring: Monitoring;
  approxBreakdowns: boolean;
  generatedAt: string;
}

const SAMPLE_CAP = 20_000;
const DEFAULT_CPM_USD = 2.5;

function sinceIso(range: Range): string {
  const days = range === "24h" ? 1 : range === "7d" ? 7 : 30;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** Ordered, gap-free bucket keys from the start of the range to now. */
function buildBuckets(range: Range): { granularity: "hour" | "day"; keys: string[]; step: number } {
  const granularity: "hour" | "day" = range === "24h" ? "hour" : "day";
  const count = range === "24h" ? 24 : range === "7d" ? 7 : 30;
  const step = granularity === "hour" ? 3_600_000 : 86_400_000;
  const base = new Date();
  if (granularity === "hour") base.setMinutes(0, 0, 0);
  else base.setHours(0, 0, 0, 0);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) keys.push(new Date(base.getTime() - i * step).toISOString());
  return { granularity, keys, step };
}

function bucketStartMs(iso: string, granularity: "hour" | "day"): number {
  const d = new Date(iso);
  if (granularity === "hour") d.setMinutes(0, 0, 0);
  else d.setHours(0, 0, 0, 0);
  return d.getTime();
}

type CountBuild = PromiseLike<{ count: number | null }>;

async function getCpmUsd(db: ReturnType<typeof createAdminClient>): Promise<number> {
  try {
    const { data } = await db.from("settings").select("value").eq("key", "analytics").maybeSingle();
    const v = (data?.value ?? {}) as { cpmUsd?: number };
    return typeof v.cpmUsd === "number" && v.cpmUsd >= 0 ? v.cpmUsd : DEFAULT_CPM_USD;
  } catch {
    return DEFAULT_CPM_USD;
  }
}

/** Admin: persist the estimated CPM used for the ad-revenue projection. */
export async function setCpmUsd(cpm: number): Promise<void> {
  const db = createAdminClient();
  const { data } = await db.from("settings").select("value").eq("key", "analytics").maybeSingle();
  const cur = (data?.value ?? {}) as Record<string, unknown>;
  await db.from("settings").upsert({ key: "analytics", value: { ...cur, cpmUsd: cpm } }, { onConflict: "key" });
}

/** Ad impressions/clicks/CTR + an estimated revenue at the configured CPM. */
async function getAdAnalytics(
  db: ReturnType<typeof createAdminClient>,
  since: string,
  countOf: (b: CountBuild) => Promise<number>,
): Promise<AdAnalytics> {
  const cpmUsd = await getCpmUsd(db);
  try {
    const [impressions, clicks] = await Promise.all([
      countOf(db.from("ad_impressions").select("id", { head: true, count: "exact" }).gte("created_at", since)),
      countOf(db.from("ad_clicks").select("id", { head: true, count: "exact" }).gte("created_at", since)),
    ]);

    // Per-zone split from a capped recent sample of each.
    const [{ data: impSample }, { data: clkSample }] = await Promise.all([
      db.from("ad_impressions").select("zone").gte("created_at", since).limit(SAMPLE_CAP),
      db.from("ad_clicks").select("zone").gte("created_at", since).limit(SAMPLE_CAP),
    ]);
    const impByZone = new Map<string, number>();
    for (const r of (impSample ?? []) as { zone: string | null }[]) {
      const z = r.zone || "unknown";
      impByZone.set(z, (impByZone.get(z) ?? 0) + 1);
    }
    const clkByZone = new Map<string, number>();
    for (const r of (clkSample ?? []) as { zone: string | null }[]) {
      const z = r.zone || "unknown";
      clkByZone.set(z, (clkByZone.get(z) ?? 0) + 1);
    }
    const zones = new Set<string>([...impByZone.keys(), ...clkByZone.keys()]);
    const byZone: AdZoneStat[] = [...zones]
      .map((key) => {
        const imp = impByZone.get(key) ?? 0;
        const clk = clkByZone.get(key) ?? 0;
        return {
          key,
          impressions: imp,
          clicks: clk,
          ctr: imp ? Math.round((clk / imp) * 1000) / 10 : 0,
          revenueUsd: Math.round((imp / 1000) * cpmUsd * 100) / 100,
        };
      })
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 10);

    return {
      impressions,
      clicks,
      ctr: impressions ? Math.round((clicks / impressions) * 1000) / 10 : 0,
      cpmUsd,
      revenueUsd: Math.round((impressions / 1000) * cpmUsd * 100) / 100,
      byZone,
    };
  } catch {
    return { impressions: 0, clicks: 0, ctr: 0, cpmUsd, revenueUsd: 0, byZone: [] };
  }
}

/** Recent failed downloads + recent security-audit events for the monitoring panel. */
async function getMonitoring(
  db: ReturnType<typeof createAdminClient>,
  since: string,
  completed: number,
  failed: number,
): Promise<Monitoring> {
  const errorRatePct = completed + failed > 0 ? Math.round((failed / (completed + failed)) * 1000) / 10 : 0;
  let recentErrors: MonitorRow[] = [];
  let recentSecurity: MonitorRow[] = [];

  try {
    const { data } = await db
      .from("analytics_downloads")
      .select("platform, error_reason, updated_at")
      .eq("status", "failed")
      .gte("created_at", since)
      .order("updated_at", { ascending: false })
      .limit(8);
    recentErrors = ((data ?? []) as { platform: string | null; error_reason: string | null; updated_at: string }[]).map((r) => ({
      at: r.updated_at,
      label: `${r.platform || "download"} failed`,
      detail: r.error_reason || "Unknown error",
    }));
  } catch {
    /* table absent */
  }

  try {
    const { data } = await db
      .from("security_audit_log")
      .select("event_type, created_at, metadata")
      .order("created_at", { ascending: false })
      .limit(8);
    recentSecurity = ((data ?? []) as { event_type: string; created_at: string; metadata: Record<string, unknown> | null }[]).map(
      (r) => ({
        at: r.created_at,
        label: r.event_type.replace(/[._]/g, " "),
        detail: shortMeta(r.metadata),
      }),
    );
  } catch {
    /* table absent */
  }

  return { errorRatePct, failedDownloads: failed, recentErrors, recentSecurity };
}

function shortMeta(meta: Record<string, unknown> | null): string {
  if (!meta) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(meta)) {
    if (v == null || typeof v === "object") continue;
    parts.push(`${k}: ${String(v).slice(0, 40)}`);
    if (parts.length >= 3) break;
  }
  return parts.join(" · ");
}

export async function getAnalyticsSummary(range: Range): Promise<AnalyticsSummary> {
  const { granularity, keys } = buildBuckets(range);
  const emptyBuckets = keys.map((t) => ({ t, visitors: 0, pageViews: 0, downloads: 0 }));
  const empty: AnalyticsSummary = {
    range,
    liveVisitors: 0,
    uniqueVisitors: 0,
    sessions: 0,
    pageViews: 0,
    totalEvents: 0,
    downloads: { total: 0, completed: 0, failed: 0, successRate: 0 },
    topPlatforms: [],
    byDevice: [],
    byBrowser: [],
    byCountry: [],
    timeseries: { granularity, buckets: emptyBuckets },
    ads: { impressions: 0, clicks: 0, ctr: 0, cpmUsd: DEFAULT_CPM_USD, revenueUsd: 0, byZone: [] },
    engagement: { topPages: [], topReferrers: [], newVisitors: 0, returningVisitors: 0 },
    monitoring: { errorRatePct: 0, failedDownloads: 0, recentErrors: [], recentSecurity: [] },
    approxBreakdowns: false,
    generatedAt: new Date().toISOString(),
  };

  try {
    const db = createAdminClient();
    const since = sinceIso(range);
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();

    const countOf = async (build: CountBuild): Promise<number> => {
      const { count } = await build;
      return count ?? 0;
    };

    const [totalEvents, pageViews, sessions, dlTotal, dlCompleted, dlFailed] = await Promise.all([
      countOf(db.from("analytics_events").select("event_id", { head: true, count: "exact" }).gte("received_at", since)),
      countOf(db.from("analytics_events").select("event_id", { head: true, count: "exact" }).eq("event_type", "page_view").gte("received_at", since)),
      countOf(db.from("analytics_events").select("event_id", { head: true, count: "exact" }).eq("event_type", "session_start").gte("received_at", since)),
      countOf(db.from("analytics_downloads").select("download_id", { head: true, count: "exact" }).gte("created_at", since)),
      countOf(db.from("analytics_downloads").select("download_id", { head: true, count: "exact" }).eq("status", "completed").gte("created_at", since)),
      countOf(db.from("analytics_downloads").select("download_id", { head: true, count: "exact" }).eq("status", "failed").gte("created_at", since)),
    ]);

    // Sample recent events for the visitor tallies, breakdowns, engagement + timeseries.
    const { data: sample } = await db
      .from("analytics_events")
      .select("visitor_id, event_type, path, referrer, device, browser, country, received_at")
      .gte("received_at", since)
      .order("received_at", { ascending: false })
      .limit(SAMPLE_CAP);
    type Row = {
      visitor_id: string;
      event_type: string;
      path: string | null;
      referrer: string | null;
      device: string | null;
      browser: string | null;
      country: string | null;
      received_at: string;
    };
    const rows = (sample ?? []) as Row[];

    const uniq = new Set<string>();
    const live = new Set<string>();
    for (const r of rows) {
      uniq.add(r.visitor_id);
      if (r.received_at >= fiveMinAgo) live.add(r.visitor_id);
    }

    const tally = (get: (r: Row) => string | null): Breakdown[] => {
      const m = new Map<string, number>();
      for (const r of rows) {
        const k = get(r) || "Unknown";
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 8);
    };

    // Engagement: top pages + referrers (page_view rows only), new vs returning.
    const pageTally = new Map<string, number>();
    const refTally = new Map<string, number>();
    for (const r of rows) {
      if (r.event_type !== "page_view") continue;
      if (r.path) pageTally.set(r.path, (pageTally.get(r.path) ?? 0) + 1);
      const ref = normalizeReferrer(r.referrer);
      if (ref) refTally.set(ref, (refTally.get(ref) ?? 0) + 1);
    }
    const topPages = [...pageTally.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 8);
    const topReferrers = [...refTally.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 8);

    // New vs returning: over a bounded sample of this range's visitors, how many
    // also have an event STRICTLY BEFORE the range started. Scaled to the full
    // unique count by the observed returning rate (flagged approximate).
    let returningVisitors = 0;
    let newVisitors = uniq.size;
    try {
      const sampledVisitors = [...uniq].slice(0, 500);
      if (sampledVisitors.length > 0) {
        const { data: prior } = await db
          .from("analytics_events")
          .select("visitor_id")
          .in("visitor_id", sampledVisitors)
          .lt("received_at", since)
          .limit(5000);
        const returningSet = new Set(((prior ?? []) as { visitor_id: string }[]).map((r) => r.visitor_id));
        const rate = returningSet.size / sampledVisitors.length;
        returningVisitors = Math.round(uniq.size * rate);
        newVisitors = Math.max(0, uniq.size - returningVisitors);
      }
    } catch {
      /* keep defaults */
    }

    // Downloads sample for platform split + timeseries.
    const { data: dlSample } = await db
      .from("analytics_downloads")
      .select("platform, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(SAMPLE_CAP);
    const dlRows = (dlSample ?? []) as { platform: string | null; created_at: string }[];
    const pm = new Map<string, number>();
    for (const r of dlRows) {
      const p = r.platform || "unknown";
      pm.set(p, (pm.get(p) ?? 0) + 1);
    }
    const topPlatforms = [...pm.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 10);

    // Timeseries — bucket the samples into the gap-free key grid.
    const idxByBucket = new Map<number, number>();
    keys.forEach((k, i) => idxByBucket.set(bucketStartMs(k, granularity), i));
    const buckets = keys.map((t) => ({ t, visitors: 0, pageViews: 0, downloads: 0 }));
    const seenPerBucket: Map<number, Set<string>> = new Map();
    for (const r of rows) {
      const bi = idxByBucket.get(bucketStartMs(r.received_at, granularity));
      if (bi === undefined) continue;
      const b = buckets[bi];
      if (!b) continue;
      if (r.event_type === "page_view") b.pageViews += 1;
      let set = seenPerBucket.get(bi);
      if (!set) {
        set = new Set<string>();
        seenPerBucket.set(bi, set);
      }
      if (!set.has(r.visitor_id)) {
        set.add(r.visitor_id);
        b.visitors += 1;
      }
    }
    for (const r of dlRows) {
      const bi = idxByBucket.get(bucketStartMs(r.created_at, granularity));
      if (bi === undefined) continue;
      const b = buckets[bi];
      if (b) b.downloads += 1;
    }

    const [ads, monitoring] = await Promise.all([
      getAdAnalytics(db, since, countOf),
      getMonitoring(db, since, dlCompleted, dlFailed),
    ]);

    return {
      range,
      liveVisitors: live.size,
      uniqueVisitors: uniq.size,
      sessions,
      pageViews,
      totalEvents,
      downloads: { total: dlTotal, completed: dlCompleted, failed: dlFailed, successRate: dlTotal ? Math.round((dlCompleted / dlTotal) * 100) : 0 },
      topPlatforms,
      byDevice: tally((r) => r.device),
      byBrowser: tally((r) => r.browser),
      byCountry: tally((r) => r.country),
      timeseries: { granularity, buckets },
      ads,
      engagement: { topPages, topReferrers, newVisitors, returningVisitors },
      monitoring,
      approxBreakdowns: rows.length >= SAMPLE_CAP,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return empty; // tables not migrated yet, or a transient error
  }
}

/** Reduce a raw referrer URL to a host (or "Direct" / "Internal"). */
function normalizeReferrer(ref: string | null): string | null {
  if (!ref) return "Direct";
  try {
    const host = new URL(ref).hostname.replace(/^www\./, "");
    if (!host) return "Direct";
    if (host.includes("frenzsave")) return "Internal";
    return host;
  } catch {
    return null;
  }
}
