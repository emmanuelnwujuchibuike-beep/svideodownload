import { matchPage, PAGES } from "@/lib/analytics/pages";
import { createAdminClient } from "@/lib/supabase/admin";

/** The bucket for a path no catalogue entry claims. */
const OTHER_PAGE_ID = "__other";

/** The full catalogue at zero — the shape every range starts from, so a page
 *  with no traffic still reports rather than vanishing. */
function emptyPageStats(): PageStat[] {
  return PAGES.map((p) => ({ id: p.id, label: p.label, group: p.group, views: 0, visitors: 0 }));
}

/**
 * Admin analytics reads over the Phase-1 tables plus the monetization + security
 * tables.
 *
 * ── Everything here is now an EXACT aggregate (owner audit, 2026-08-09) ──────
 *
 * It used to pull up to `SAMPLE_CAP` (20 000) recent event rows and compute
 * unique visitors, live visitors, breakdowns, engagement and the trend chart
 * over that sample in JavaScript. The failure mode was quiet and bad: past
 * 20 000 events in a range, "Unique visitors" stopped growing and converged on
 * however many distinct visitors happened to be inside the most recent 20 000
 * events. On a dashboard, an undercount that stops rising is indistinguishable
 * from a plateau in real traffic — so the number would have been read as a
 * business signal rather than a measurement artefact.
 *
 * New vs returning was worse still: it sampled 500 visitors, measured what
 * fraction of THOSE had prior events, and multiplied that rate up to the full
 * unique count. A ratio estimated from a sample, presented as a count, with no
 * error bar.
 *
 * All of it now runs in Postgres through the RPCs in migration 0115, which also
 * exclude bot traffic. `approxBreakdowns` is retained in the response shape but
 * is always false — the dashboard still reads it, and removing the field would
 * be a silent contract change for a value that is now simply always exact.
 *
 * Degrades to zeros before the analytics tables exist — every block is
 * independently try/caught so one missing table never blanks the whole
 * dashboard. A MISSING RPC (the migration not yet applied) is reported rather
 * than silently zeroed: see `rpcHealth` on the summary.
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

/** One catalogued surface and its traffic. Zero-view pages are INCLUDED — see
 *  `lib/analytics/pages.ts` for why a zero is information worth rendering. */
export interface PageStat {
  id: string;
  label: string;
  group: string;
  views: number;
  /** Distinct visitors on this page over the sample. */
  visitors: number;
}

export interface Engagement {
  topPages: Breakdown[];
  topReferrers: Breakdown[];
  /** Referrers that are search engines, grouped by engine rather than host. */
  searchEngines: Breakdown[];
  /** EVERY catalogued page, grouped, including the ones with no traffic. */
  pages: PageStat[];
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

/**
 * Download counts by lifecycle stage.
 *
 * `total` deliberately EXCLUDES cancelled downloads, and `successRate` is
 * measured against attempts that were actually carried through
 * (completed + failed) rather than against every row.
 *
 * Why: a row sits at 'requested' from the moment a visitor presses the button.
 * Someone who changes their mind, or closes the tab, leaves a 'requested' row
 * behind forever. Counting those as downloads we failed to deliver made the
 * success rate a measure of visitor intent as much as of our reliability — and
 * it moved in the wrong direction whenever the site got busier. `attempted` is
 * the honest denominator; `abandoned` is reported separately, because it is a
 * real and interesting number, just not a failure.
 */
export interface DownloadStats {
  /** Requested and not cancelled — every download we were asked to deliver. */
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  /** Requested, never cancelled, never reached a terminal state (tab closed, etc). */
  abandoned: number;
  /** completed + failed — the denominator for `successRate`. */
  attempted: number;
  successRate: number;
  /** Bytes actually delivered for completed downloads, summed exactly. */
  bytesDelivered: number;
}

/**
 * Which exact-aggregate RPCs answered.
 *
 * Reported rather than swallowed. Every block in this file is try/caught so one
 * missing table cannot blank the dashboard — but a caught error and a genuine
 * zero look identical to a reader, and "0 unique visitors" on a site with
 * traffic is exactly the kind of confident wrong number this audit was about.
 * The dashboard renders a warning instead of a zero when this is false.
 */
export interface RpcHealth {
  /** False when migration 0115 has not been applied — numbers are unavailable, not zero. */
  exactAggregates: boolean;
  note: string | null;
}

/**
 * The same headline numbers for the IMMEDIATELY PRECEDING window of equal
 * length, so every card can show a real change instead of a bare number.
 *
 * Compared against the previous PERIOD rather than "the same day last week":
 * this site's traffic is driven by shares and search, not by a weekly office
 * rhythm, so period-over-period is the comparison that actually reflects
 * whether something changed today.
 *
 * Null when the previous window could not be read. The dashboard then shows no
 * trend arrow at all — an unknown trend must not render as 0%, which reads as
 * "flat" rather than "unknown".
 */
export interface PreviousPeriod {
  uniqueVisitors: number;
  sessions: number;
  pageViews: number;
  downloadsCompleted: number;
  downloadsFailed: number;
  successRate: number;
  bounceRatePct: number;
  avgTimeOnPageSec: number;
  adImpressions: number;
  adClicks: number;
}

export interface AnalyticsSummary {
  range: Range;
  liveVisitors: number;
  uniqueVisitors: number;
  newVisitors: number;
  returningVisitors: number;
  sessions: number;
  pageViews: number;
  totalEvents: number;
  /** Sessions with exactly one page view, as a percentage of all sessions. */
  bounceRatePct: number;
  /** Mean visible seconds per page, from measured `page_exit` dwell. */
  avgTimeOnPageSec: number;
  downloads: DownloadStats;
  topPlatforms: Breakdown[];
  byDevice: Breakdown[];
  byBrowser: Breakdown[];
  byOs: Breakdown[];
  byCountry: Breakdown[];
  byRegion: Breakdown[];
  timeseries: { granularity: "hour" | "day"; buckets: TimeBucket[] };
  ads: AdAnalytics;
  /** Rewarded ads watched through to claiming the unlock. */
  rewardsWatched: number;
  engagement: Engagement;
  monitoring: Monitoring;
  /** Always false now — retained so the dashboard's contract does not change. */
  approxBreakdowns: boolean;
  rpcHealth: RpcHealth;
  /** Null when unknown — never render an unknown trend as 0%. */
  previous: PreviousPeriod | null;
  generatedAt: string;
}

const SAMPLE_CAP = 20_000;
const DEFAULT_CPM_USD = 2.5;

function rangeDays(range: Range): number {
  return range === "24h" ? 1 : range === "7d" ? 7 : 30;
}

function sinceIso(range: Range): string {
  return new Date(Date.now() - rangeDays(range) * 86_400_000).toISOString();
}

/** The window immediately before the current one, same length. */
function priorWindow(range: Range): { from: string; to: string } {
  const ms = rangeDays(range) * 86_400_000;
  const now = Date.now();
  return { from: new Date(now - 2 * ms).toISOString(), to: new Date(now - ms).toISOString() };
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
    newVisitors: 0,
    returningVisitors: 0,
    sessions: 0,
    pageViews: 0,
    totalEvents: 0,
    bounceRatePct: 0,
    avgTimeOnPageSec: 0,
    downloads: {
      total: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      abandoned: 0,
      attempted: 0,
      successRate: 0,
      bytesDelivered: 0,
    },
    topPlatforms: [],
    byDevice: [],
    byBrowser: [],
    byOs: [],
    byCountry: [],
    byRegion: [],
    timeseries: { granularity, buckets: emptyBuckets },
    ads: { impressions: 0, clicks: 0, ctr: 0, cpmUsd: DEFAULT_CPM_USD, revenueUsd: 0, byZone: [] },
    rewardsWatched: 0,
    engagement: { topPages: [], topReferrers: [], searchEngines: [], pages: emptyPageStats(), newVisitors: 0, returningVisitors: 0 },
    monitoring: { errorRatePct: 0, failedDownloads: 0, recentErrors: [], recentSecurity: [] },
    approxBreakdowns: false,
    rpcHealth: { exactAggregates: false, note: "Analytics tables are not available." },
    previous: null,
    generatedAt: new Date().toISOString(),
  };

  try {
    const db = createAdminClient();
    const since = sinceIso(range);
    /*
      The live window.

      Five minutes, matching Plausible's "current visitors". It has to be longer
      than the client's flush debounce (3s) plus a slow round trip, or someone
      genuinely reading a page drops out of the count between beacons and the
      number flickers. It also has to be short enough that "live" means live —
      GA's 30-minute realtime window reports people who left twenty minutes ago.
    */
    const liveSince = new Date(Date.now() - 5 * 60_000).toISOString();

    const countOf = async (build: CountBuild): Promise<number> => {
      const { count } = await build;
      return count ?? 0;
    };

    /** One RPC call. Returns null (never throws) when the function is absent. */
    const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T[] | null> => {
      const { data, error } = await db.rpc(name, args);
      if (error) return null;
      return (data ?? []) as T[];
    };

    const [totals, split, dlTotals, series, pageRows, devices, browsers, oses, countries, regions, paths, referrers] =
      await Promise.all([
        rpc<{
          total_events: number;
          page_views: number;
          unique_visitors: number;
          sessions: number;
          live_visitors: number;
          bounced_sessions: number;
          dwell_samples: number;
          dwell_seconds: number;
          rewards_watched: number;
        }>("analytics_traffic_totals", { p_since: since, p_live_since: liveSince }),
        rpc<{ new_visitors: number; returning_visitors: number }>("analytics_visitor_split", { p_since: since }),
        rpc<{ status: string; downloads: number; bytes: number }>("analytics_download_totals", { p_since: since }),
        rpc<{ bucket: string; visitors: number; page_views: number; downloads: number }>("analytics_timeseries", {
          p_since: since,
          p_bucket: granularity,
        }),
        rpc<{ path: string; views: number; visitors: number }>("analytics_page_traffic", { p_since: since }),
        rpc<Breakdown>("analytics_breakdown", { p_since: since, p_dimension: "device", p_limit: 8 }),
        rpc<Breakdown>("analytics_breakdown", { p_since: since, p_dimension: "browser", p_limit: 8 }),
        rpc<Breakdown>("analytics_breakdown", { p_since: since, p_dimension: "os", p_limit: 8 }),
        rpc<Breakdown>("analytics_breakdown", { p_since: since, p_dimension: "country", p_limit: 12 }),
        rpc<Breakdown>("analytics_breakdown", { p_since: since, p_dimension: "region", p_limit: 8 }),
        rpc<Breakdown>("analytics_breakdown", { p_since: since, p_dimension: "path", p_limit: 8 }),
        rpc<Breakdown>("analytics_breakdown", { p_since: since, p_dimension: "referrer", p_limit: 200 }),
      ]);

    /*
      A missing RPC is REPORTED, not zeroed.

      Until migration 0115 is applied every call above returns null, and a
      dashboard full of confident zeros is precisely the failure this audit
      exists to remove. The flag drives a banner instead.
    */
    if (!totals) {
      return { ...empty, rpcHealth: { exactAggregates: false, note: "Run migration 0115 — exact analytics aggregates are unavailable." } };
    }

    const t = totals[0] ?? {
      total_events: 0,
      page_views: 0,
      unique_visitors: 0,
      sessions: 0,
      live_visitors: 0,
      bounced_sessions: 0,
      dwell_samples: 0,
      dwell_seconds: 0,
      rewards_watched: 0,
    };

    const num0 = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

    const totalEvents = num0(t.total_events);
    const pageViews = num0(t.page_views);
    const sessions = num0(t.sessions);
    const bounceRatePct = sessions > 0 ? Math.round((num0(t.bounced_sessions) / sessions) * 1000) / 10 : 0;
    const dwellSamples = num0(t.dwell_samples);
    const avgTimeOnPageSec = dwellSamples > 0 ? Math.round(num0(t.dwell_seconds) / dwellSamples) : 0;

    /* ── downloads, by lifecycle stage ─────────────────────────────────────── */
    const byStatus = new Map<string, { n: number; bytes: number }>();
    for (const r of dlTotals ?? []) byStatus.set(r.status, { n: num0(r.downloads), bytes: num0(r.bytes) });
    const stat = (s: string) => byStatus.get(s)?.n ?? 0;
    const completed = stat("completed");
    const failed = stat("failed");
    const cancelled = stat("cancelled");
    const inFlight = stat("requested") + stat("started") + stat("preparing");
    const attempted = completed + failed;
    const downloads: DownloadStats = {
      total: completed + failed + inFlight,
      completed,
      failed,
      cancelled,
      abandoned: inFlight,
      attempted,
      // Against ATTEMPTS, not against everything ever requested — see DownloadStats.
      successRate: attempted > 0 ? Math.round((completed / attempted) * 1000) / 10 : 0,
      bytesDelivered: byStatus.get("completed")?.bytes ?? 0,
    };

    /* ── engagement ────────────────────────────────────────────────────────── */
    // Referrers are normalised to a host AFTER the SQL tally, so several raw
    // URLs from one site collapse into one row; a generous limit goes in so the
    // top 8 hosts survive that collapse.
    const refByHost = new Map<string, number>();
    for (const r of referrers ?? []) {
      const host = normalizeReferrer(r.key === "Unknown" ? null : r.key);
      if (!host) continue;
      refByHost.set(host, (refByHost.get(host) ?? 0) + num0(r.count));
    }
    const topReferrers = [...refByHost.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    /*
      Search traffic, grouped by ENGINE rather than by host.

      Google alone arrives as a dozen country domains, so search was scattered
      across the referrer list with no single row big enough to surface. This is
      the acquisition number the owner asked for and it had no home before.
    */
    const searchTally = new Map<string, number>();
    for (const [host, count] of refByHost) {
      const engine = searchEngineFor(host);
      if (engine) searchTally.set(engine, (searchTally.get(engine) ?? 0) + count);
    }
    const searchEngines = [...searchTally.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);

    const topPages = (paths ?? []).map((r) => ({ key: r.key, count: num0(r.count) }));

    // Per-PAGE stats over the catalogue: every surface reports, including the
    // ones nobody visited, and dynamic routes collapse into a single row.
    const pageViewTally = new Map<string, number>();
    const pageVisitorTally = new Map<string, number>();
    for (const r of pageRows ?? []) {
      const id = matchPage(r.path) ?? OTHER_PAGE_ID;
      pageViewTally.set(id, (pageViewTally.get(id) ?? 0) + num0(r.views));
      /*
        Distinct visitors are summed across the paths a catalogue entry owns.

        This can over-count one person who visited two paths of the same entry
        (two different profiles, say) — a true distinct-per-entry count would
        need the catalogue's regexes inside SQL, which would mean maintaining
        them in two languages. The over-count is bounded by the page's own view
        count and only affects the per-page visitor column, so it is the one
        approximation left in this file and it is named here rather than hidden.
      */
      pageVisitorTally.set(id, (pageVisitorTally.get(id) ?? 0) + num0(r.visitors));
    }
    const pages: PageStat[] = emptyPageStats().map((p) => ({
      ...p,
      views: pageViewTally.get(p.id) ?? 0,
      visitors: Math.min(pageVisitorTally.get(p.id) ?? 0, pageViewTally.get(p.id) ?? 0),
    }));
    // Uncatalogued paths are surfaced, never dropped — an "Other" row with a
    // count is how a forgotten page gets noticed and catalogued.
    const otherViews = pageViewTally.get(OTHER_PAGE_ID) ?? 0;
    if (otherViews > 0) {
      pages.push({
        id: OTHER_PAGE_ID,
        label: "Other (uncatalogued)",
        group: "Other",
        views: otherViews,
        visitors: Math.min(pageVisitorTally.get(OTHER_PAGE_ID) ?? 0, otherViews),
      });
    }

    const newVisitors = num0(split?.[0]?.new_visitors);
    const returningVisitors = num0(split?.[0]?.returning_visitors);

    /* ── platform split (downloads) — exact, the last one to stop sampling ── */
    const platRows = await rpc<Breakdown>("analytics_platform_totals", { p_since: since, p_limit: 12 });
    const topPlatforms = (platRows ?? []).map((r) => ({ key: r.key, count: num0(r.count) }));

    /* ── timeseries: exact buckets, dropped into the gap-free grid ─────────── */
    const idxByBucket = new Map<number, number>();
    keys.forEach((k, i) => idxByBucket.set(bucketStartMs(k, granularity), i));
    const buckets = keys.map((t2) => ({ t: t2, visitors: 0, pageViews: 0, downloads: 0 }));
    for (const r of series ?? []) {
      const bi = idxByBucket.get(bucketStartMs(r.bucket, granularity));
      if (bi === undefined) continue;
      const b = buckets[bi];
      if (!b) continue;
      b.visitors = num0(r.visitors);
      b.pageViews = num0(r.page_views);
      b.downloads = num0(r.downloads);
    }

    const [ads, monitoring, previous] = await Promise.all([
      getAdAnalytics(db, since, countOf),
      getMonitoring(db, since, completed, failed),
      getPreviousPeriod(db, range, rpc, countOf),
    ]);

    const clean = (rows: Breakdown[] | null): Breakdown[] =>
      (rows ?? []).map((r) => ({ key: r.key, count: num0(r.count) }));

    return {
      range,
      liveVisitors: num0(t.live_visitors),
      uniqueVisitors: num0(t.unique_visitors),
      newVisitors,
      returningVisitors,
      sessions,
      pageViews,
      totalEvents,
      bounceRatePct,
      avgTimeOnPageSec,
      downloads,
      topPlatforms,
      byDevice: clean(devices),
      byBrowser: clean(browsers),
      byOs: clean(oses),
      byCountry: clean(countries),
      byRegion: clean(regions),
      timeseries: { granularity, buckets },
      ads,
      rewardsWatched: num0(t.rewards_watched),
      engagement: { topPages, topReferrers, searchEngines, pages, newVisitors, returningVisitors },
      monitoring,
      approxBreakdowns: false,
      rpcHealth: { exactAggregates: true, note: null },
      previous,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return empty; // tables not migrated yet, or a transient error
  }
}

/**
 * The preceding window of equal length — the baseline every trend is measured
 * against.
 *
 * Returns null rather than zeros on any failure. A card showing "0%" claims the
 * metric was flat; a card showing nothing admits it does not know. Those are
 * very different statements and only one of them is true here.
 */
async function getPreviousPeriod(
  db: ReturnType<typeof createAdminClient>,
  range: Range,
  rpc: <T>(name: string, args: Record<string, unknown>) => Promise<T[] | null>,
  countOf: (b: CountBuild) => Promise<number>,
): Promise<PreviousPeriod | null> {
  try {
    const { from, to } = priorWindow(range);
    const [totals, dl, impressions, clicks] = await Promise.all([
      rpc<{
        page_views: number;
        unique_visitors: number;
        sessions: number;
        bounced_sessions: number;
        dwell_samples: number;
        dwell_seconds: number;
      }>("analytics_traffic_totals", { p_since: from, p_live_since: from, p_until: to }),
      rpc<{ status: string; downloads: number }>("analytics_download_totals", { p_since: from, p_until: to }),
      countOf(
        db.from("ad_impressions").select("id", { head: true, count: "exact" }).gte("created_at", from).lt("created_at", to),
      ),
      countOf(
        db.from("ad_clicks").select("id", { head: true, count: "exact" }).gte("created_at", from).lt("created_at", to),
      ),
    ]);
    if (!totals) return null;

    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
    const t = totals[0];
    const sessions = n(t?.sessions);
    const samples = n(t?.dwell_samples);
    const byStatus = new Map((dl ?? []).map((r) => [r.status, n(r.downloads)]));
    const done = byStatus.get("completed") ?? 0;
    const bad = byStatus.get("failed") ?? 0;

    return {
      uniqueVisitors: n(t?.unique_visitors),
      sessions,
      pageViews: n(t?.page_views),
      downloadsCompleted: done,
      downloadsFailed: bad,
      successRate: done + bad > 0 ? Math.round((done / (done + bad)) * 1000) / 10 : 0,
      bounceRatePct: sessions > 0 ? Math.round((n(t?.bounced_sessions) / sessions) * 1000) / 10 : 0,
      avgTimeOnPageSec: samples > 0 ? Math.round(n(t?.dwell_seconds) / samples) : 0,
      adImpressions: impressions,
      adClicks: clicks,
    };
  } catch {
    return null;
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

/**
 * The search engine a referrer host belongs to, or null if it is not search.
 *
 * ── Why a name table and not "does the host contain 'search'" ────────────────
 * Google alone arrives as dozens of country hosts (google.com, google.co.uk,
 * google.com.ng…), and Yahoo/Bing/DuckDuckGo each have their own. Grouped by
 * ENGINE, "Google" is usually the largest acquisition channel on the site; left
 * as raw hosts it is scattered across a dozen rows, none individually large
 * enough to appear in a top-8 referrer list — which is why search traffic
 * looked smaller than it is.
 *
 * Matched on the registrable prefix rather than a substring, so a host like
 * `notgoogle.example.com` cannot be miscredited to Google.
 */
const SEARCH_ENGINES: { name: string; test: RegExp }[] = [
  { name: "Google", test: /(^|\.)google\.[a-z.]+$/i },
  { name: "Bing", test: /(^|\.)bing\.com$/i },
  { name: "Yahoo", test: /(^|\.)search\.yahoo\.[a-z.]+$|(^|\.)yahoo\.[a-z.]+$/i },
  { name: "DuckDuckGo", test: /(^|\.)duckduckgo\.com$/i },
  { name: "Yandex", test: /(^|\.)yandex\.[a-z.]+$/i },
  { name: "Baidu", test: /(^|\.)baidu\.com$/i },
  { name: "Ecosia", test: /(^|\.)ecosia\.org$/i },
  { name: "Brave", test: /(^|\.)search\.brave\.com$/i },
  { name: "Startpage", test: /(^|\.)startpage\.com$/i },
];

export function searchEngineFor(host: string): string | null {
  return SEARCH_ENGINES.find((e) => e.test.test(host))?.name ?? null;
}
