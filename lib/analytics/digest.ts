import "server-only";

import { getAnalyticsSummary, type AnalyticsSummary, type Range } from "@/lib/analytics/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { paginatedSelect } from "@/lib/supabase/paginate";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ADMIN DIGEST — daily / weekly / monthly
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-08-16: "a premium email with area chart… total downloads,
 * visitors, page views, download completed/failed/cancelled/abandoned, reward
 * ad watched, idle interstitial shown, signed in users, anonymous users,
 * anonymous users who downloaded repeated…, top 5 most page viewed, and new
 * signed in users… sent at end of day (1am), week (Sunday 1am), month end."
 *
 * ── Why the window is ROLLING, not calendar-aligned ────────────────────────
 * "End of day" / "end of week" / "end of month" would need calendar-bucketed
 * queries — a new RPC, which means a new migration, and unapplied migrations
 * are a standing, documented problem on this project (see the 0115 note in
 * `lib/analytics/queries.ts`). `getAnalyticsSummary` already computes exact
 * current-vs-previous-period numbers for a ROLLING window ("24h" / "7d" /
 * "30d" ending now) through the existing RPCs, with no new SQL required. Fired
 * at 1am right after the period the cron schedule names, a rolling 24h window
 * IS essentially "yesterday"; rolling 7d is essentially "the last 7 days"; and
 * rolling 30d is essentially "the last month". The label says "last N days"
 * rather than claiming Monday-to-Sunday precision it doesn't have — an honest
 * approximation beats a fabricated exact one.
 *
 * ── Why trend is present for some metrics and absent for others ───────────
 * `AnalyticsSummary.previous` already carries an exact previous-period figure
 * for visitors, page views, downloads completed/failed — reused here as-is.
 * Cancelled/abandoned downloads, reward views, idle-interstitial impressions,
 * signed-in/anonymous split, new signups and repeat-downloader counts have no
 * previous-period equivalent anywhere in this codebase; rather than invent one
 * with a different, inconsistent method, those render as a plain count with no
 * trend arrow. An absent trend must never be shown as "0%" — that reads as
 * "flat" when the truth is "not measured this way".
 *
 * ── The supplemental raw queries ────────────────────────────────────────────
 * Signed-in-vs-anonymous, new-signups and repeat-anonymous-downloader counts
 * are not covered by any existing RPC, so they're computed here directly
 * against `analytics_downloads` / `profiles`, using the SAME window math
 * (`priorWindow`-equivalent) `getAnalyticsSummary` uses internally, so a
 * reader comparing two numbers from different sections of the same email is
 * always comparing the same span of time.
 */

export type DigestPeriod = "daily" | "weekly" | "monthly";

const RANGE_BY_PERIOD: Record<DigestPeriod, Range> = { daily: "24h", weekly: "7d", monthly: "30d" };
const WINDOW_DAYS: Record<DigestPeriod, number> = { daily: 1, weekly: 7, monthly: 30 };
const PERIOD_NOUN: Record<DigestPeriod, string> = { daily: "day", weekly: "week", monthly: "month" };

/** Rows a repeat-downloader scan will read before it's declared partial — a
 *  visitor-grouping query has no `count:"exact"` shortcut, so this one really
 *  does read rows, capped the same way `revenue-series.ts` caps its scans. */
const REPEAT_SCAN_CAP = 20_000;

export interface DigestMetric {
  key: string;
  label: string;
  value: number;
  /** Percent change vs the immediately preceding period of equal length. Null = not measured this way — never render as 0%. */
  trendPct: number | null;
}

export interface DigestData {
  period: DigestPeriod;
  /** e.g. "Daily digest — last 24 hours", human-facing, honest about being rolling not calendar-aligned. */
  windowLabel: string;
  generatedAt: string;
  metrics: DigestMetric[];
  topPages: { label: string; views: number }[];
  chart: { label: string; value: number }[];
  chartMetricLabel: string;
  warnings: string[];
}

function pct(cur: number, prev: number | undefined | null): number | null {
  if (prev === undefined || prev === null || prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

function windowBounds(period: DigestPeriod): { since: string; prevSince: string; prevUntil: string } {
  const ms = WINDOW_DAYS[period] * 86_400_000;
  const now = Date.now();
  return {
    since: new Date(now - ms).toISOString(),
    prevSince: new Date(now - 2 * ms).toISOString(),
    prevUntil: new Date(now - ms).toISOString(),
  };
}

/** Same shape `queries.ts`'s own `countOf` reduces — a Postgrest head-count
 *  response, awaited and defaulted so a table hiccup reads as zero, not NaN. */
type CountBuild = PromiseLike<{ count: number | null; error: unknown }>;
async function countOf(build: CountBuild): Promise<number> {
  try {
    const { count, error } = await build;
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** Signed-in vs anonymous COMPLETED downloads, current + previous window. */
async function getAttributionSplit(db: ReturnType<typeof createAdminClient>, period: DigestPeriod) {
  const { since, prevSince, prevUntil } = windowBounds(period);
  const [signedIn, anonymous, signedInPrev, anonymousPrev] = await Promise.all([
    countOf(
      db
        .from("analytics_downloads")
        .select("download_id", { head: true, count: "exact" })
        .eq("status", "completed")
        .gte("created_at", since)
        .not("user_id", "is", null),
    ),
    countOf(
      db
        .from("analytics_downloads")
        .select("download_id", { head: true, count: "exact" })
        .eq("status", "completed")
        .gte("created_at", since)
        .is("user_id", null),
    ),
    countOf(
      db
        .from("analytics_downloads")
        .select("download_id", { head: true, count: "exact" })
        .eq("status", "completed")
        .gte("created_at", prevSince)
        .lt("created_at", prevUntil)
        .not("user_id", "is", null),
    ),
    countOf(
      db
        .from("analytics_downloads")
        .select("download_id", { head: true, count: "exact" })
        .eq("status", "completed")
        .gte("created_at", prevSince)
        .lt("created_at", prevUntil)
        .is("user_id", null),
    ),
  ]);
  return { signedIn, anonymous, signedInPrev, anonymousPrev };
}

/** New profiles created in the window, current + previous. */
async function getNewSignups(db: ReturnType<typeof createAdminClient>, period: DigestPeriod) {
  const { since, prevSince, prevUntil } = windowBounds(period);
  const [current, previous] = await Promise.all([
    countOf(db.from("profiles").select("id", { head: true, count: "exact" }).gte("created_at", since)),
    countOf(
      db
        .from("profiles")
        .select("id", { head: true, count: "exact" })
        .gte("created_at", prevSince)
        .lt("created_at", prevUntil),
    ),
  ]);
  return { current, previous };
}

/**
 * Anonymous visitors with 2+ completed downloads in the window. `repeatDownloads`
 * counts only the downloads BEYOND each repeat visitor's first — the downloads
 * that were, literally, repeats — not their full total.
 */
async function getRepeatAnonymousDownloaders(
  db: ReturnType<typeof createAdminClient>,
  period: DigestPeriod,
): Promise<{ visitors: number; repeatDownloads: number; capped: boolean }> {
  const { since } = windowBounds(period);
  try {
    const { rows, capped } = await paginatedSelect<{ visitor_id: string }>(
      (from, to) =>
        db
          .from("analytics_downloads")
          .select("visitor_id")
          .eq("status", "completed")
          .is("user_id", null)
          .gte("created_at", since)
          .range(from, to),
      REPEAT_SCAN_CAP,
    );
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.visitor_id, (r.visitor_id ? counts.get(r.visitor_id) ?? 0 : 0) + 1);
    let visitors = 0;
    let repeatDownloads = 0;
    for (const n of counts.values()) {
      if (n >= 2) {
        visitors += 1;
        repeatDownloads += n - 1;
      }
    }
    return { visitors, repeatDownloads, capped };
  } catch {
    return { visitors: 0, repeatDownloads: 0, capped: false };
  }
}

function idleInterstitialImpressions(summary: AnalyticsSummary): number {
  return summary.ads.byZone.find((z) => z.key === "idle_interstitial")?.impressions ?? 0;
}

function windowLabel(period: DigestPeriod): string {
  const days = WINDOW_DAYS[period];
  const noun = PERIOD_NOUN[period];
  return period === "daily"
    ? `Daily digest — last ${days === 1 ? "24 hours" : `${days} days`}`
    : `${period === "weekly" ? "Weekly" : "Monthly"} digest — last ${days} days (rolling, ending this ${noun})`;
}

function chartFromBuckets(summary: AnalyticsSummary): { label: string; value: number }[] {
  const hourly = summary.timeseries.granularity === "hour";
  return summary.timeseries.buckets.map((b) => ({
    label: hourly
      ? new Date(b.t).toLocaleTimeString(undefined, { hour: "numeric" })
      : new Date(b.t).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    value: b.downloads,
  }));
}

export async function buildDigest(period: DigestPeriod): Promise<DigestData> {
  const db = createAdminClient();
  const range = RANGE_BY_PERIOD[period];

  const [summary, attribution, signups, repeat] = await Promise.all([
    getAnalyticsSummary(range),
    getAttributionSplit(db, period),
    getNewSignups(db, period),
    getRepeatAnonymousDownloaders(db, period),
  ]);

  const idleImpressions = idleInterstitialImpressions(summary);

  const metrics: DigestMetric[] = [
    { key: "downloads_total", label: "Total downloads", value: summary.downloads.total, trendPct: null },
    {
      key: "visitors",
      label: "Visitors",
      value: summary.uniqueVisitors,
      trendPct: pct(summary.uniqueVisitors, summary.previous?.uniqueVisitors),
    },
    /* New/returning split — same RPC-backed figures `getAnalyticsSummary`
     * already computes for this range, so this is zero extra queries (owner,
     * 2026-08-16: "also sent to admin email if not already set"). No
     * previous-period figure exists for the SPLIT specifically (only for the
     * combined `uniqueVisitors`), so these carry no trend arrow. */
    { key: "new_visitors", label: "New visitors", value: summary.newVisitors, trendPct: null },
    { key: "returning_visitors", label: "Returning visitors", value: summary.returningVisitors, trendPct: null },
    {
      key: "page_views",
      label: "Page views",
      value: summary.pageViews,
      trendPct: pct(summary.pageViews, summary.previous?.pageViews),
    },
    {
      key: "downloads_completed",
      label: "Downloads completed",
      value: summary.downloads.completed,
      trendPct: pct(summary.downloads.completed, summary.previous?.downloadsCompleted),
    },
    {
      key: "downloads_failed",
      label: "Downloads failed",
      value: summary.downloads.failed,
      trendPct: pct(summary.downloads.failed, summary.previous?.downloadsFailed),
    },
    { key: "downloads_cancelled", label: "Downloads cancelled", value: summary.downloads.cancelled, trendPct: null },
    { key: "downloads_abandoned", label: "Downloads abandoned", value: summary.downloads.abandoned, trendPct: null },
    { key: "rewards_watched", label: "Reward ads watched", value: summary.rewardsWatched, trendPct: null },
    { key: "idle_interstitials", label: "Idle interstitials shown", value: idleImpressions, trendPct: null },
    {
      key: "signed_in_downloads",
      label: "Downloads by signed-in users",
      value: attribution.signedIn,
      trendPct: pct(attribution.signedIn, attribution.signedInPrev),
    },
    {
      key: "anonymous_downloads",
      label: "Downloads by anonymous visitors",
      value: attribution.anonymous,
      trendPct: pct(attribution.anonymous, attribution.anonymousPrev),
    },
    {
      key: "repeat_anonymous_visitors",
      label: "Anonymous visitors who downloaded repeatedly",
      value: repeat.visitors,
      trendPct: null,
    },
    { key: "repeat_anonymous_downloads", label: "Repeat downloads from those visitors", value: repeat.repeatDownloads, trendPct: null },
    {
      key: "new_signups",
      label: "New signed-up users",
      value: signups.current,
      trendPct: pct(signups.current, signups.previous),
    },
  ];

  const topPages = [...summary.engagement.pages]
    .sort((a, b) => b.views - a.views)
    .slice(0, 5)
    .map((p) => ({ label: p.label, views: p.views }));

  const warnings: string[] = [];
  if (!summary.rpcHealth.exactAggregates) {
    warnings.push(summary.rpcHealth.note || "Exact analytics aggregates are unavailable — a migration may be pending.");
  }
  if (repeat.capped) {
    warnings.push("The repeat-downloader count hit its read limit; the true figure may be higher.");
  }

  return {
    period,
    windowLabel: windowLabel(period),
    generatedAt: summary.generatedAt,
    metrics,
    topPages,
    chart: chartFromBuckets(summary),
    chartMetricLabel: "Downloads",
    warnings,
  };
}
