import { createAdminClient } from "@/lib/supabase/admin";
import { paginatedSelect } from "@/lib/supabase/paginate";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DAILY SERIES FOR THE REVENUE DASHBOARD
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-08-11: area charts for "subscription revenue, ad revenue, ad
 * impression, ad clicks, visitors".
 *
 * ── 🔴 What has history, and what does not ────────────────────────────────
 *
 * Two of those five have no data behind them, and this file exists partly to
 * say so in the one place a future reader will look:
 *
 *  • AD REVENUE does not exist anywhere in this system. Networks report earnings
 *    in their own dashboards and we never receive them. `revenue-overview.tsx`
 *    already refuses to print an ad-revenue NUMBER for that reason; a TREND
 *    would be worse, because a line is more persuasive than a figure. Nothing
 *    here fabricates one.
 *
 *  • SUBSCRIPTION REVENUE is computed live from current subscriber counts times
 *    current prices. It is a snapshot, not a ledger — there is no per-day
 *    history to plot, and back-filling one would mean applying today's prices
 *    to the past, which invents the exact number it claims to report.
 *
 * What IS counted, exactly, with a timestamp on every row: ad impressions, ad
 * clicks, and (through the analytics RPC elsewhere) visitors. Those are charted.
 *
 * ── Why this groups in JS rather than adding an RPC ───────────────────────
 *
 * A `date_trunc` RPC would be the better query. It would also be a MIGRATION,
 * and unapplied migrations are a standing problem on this project — a dashboard
 * that renders empty until someone runs SQL is worse than one that does a little
 * more work in Node. Both tables are indexed on `created_at`, only that one
 * column is selected, and the read is bounded (see `ROW_CAP`), so the cost is a
 * narrow index scan.
 *
 * 🔴 The cap is REPORTED, never silently applied. A truncated series that looks
 * complete is a lie about the business; `capped` lets the UI say the window is
 * partial instead of drawing a cliff and calling it a trend.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Most rows either table may contribute before the answer is declared partial. */
const ROW_CAP = 50_000;

export interface DayPoint {
  /** ISO date, `YYYY-MM-DD`, in UTC — the same basis every other admin stat uses. */
  date: string;
  impressions: number;
  clicks: number;
  /** Completed downloads (owner, 2026-08-16: "make a download chart in
   *  revenue just like visitors, ad clicks and impression chart"). */
  downloads: number;
  /**
   * PWA installs actually COMPLETED (owner, 2026-08-23: "how many installs were
   * made that day, week, month like download, visitors").
   *
   * Counts `pwa_installed` only — the browser's own `appinstalled` event, which
   * fires on real success and nothing else. Deliberately NOT
   * `pwa_install_accepted`: that records the moment somebody taps "Install" in
   * our sheet, and an install can still fail or be cancelled by the OS after
   * that point. Counting the tap would inflate the number with intentions.
   *
   * Honest limit, worth knowing before reading the chart: iOS fires no
   * equivalent event at all — Apple gives web pages no visibility into
   * Add-to-Home-Screen — so this line is Chromium (Android + desktop) installs.
   * It undercounts total installs rather than guessing at the iOS share.
   */
  installs: number;
  /**
   * Rewarded ads STARTED — a visitor chose to watch one to unlock a download
   * (owner, 2026-08-23: "add reward ad activity in the revenue, the chart and
   * information like how other revenue information there are").
   */
  rewardsStarted: number;
  /**
   * Rewarded ads that were VERIFIED and unlocked the download.
   *
   * Both halves are charted because the gap between them is the only number
   * that says whether rewarded ads actually work. Charting completions alone
   * would look like a flawless funnel by construction — every reward that
   * exists completed — and hide every abandoned or failed watch, which is the
   * figure worth acting on. See the note in lib/platform/events-registry.ts.
   */
  rewardsGranted: number;
  /**
   * Multi-Link batches that actually STARTED downloading (owner, 2026-08-25:
   * "and also a chart in revenue").
   *
   * `batch_started` rather than `batch_authorized`: authorization happens
   * before the ad and before the allowance is spent, so charting it would
   * count batches nobody completed. This line is "batches that ran", which is
   * the one that corresponds to ad impressions and downloads.
   */
  multilinkBatches: number;
  /**
   * Batches a server-side limit REFUSED.
   *
   * Charted beside the line above for the same reason `rewardsStarted` is
   * charted beside `rewardsGranted`: a success-only series makes a limit that
   * is turning people away look like an absence of demand. The gap is the
   * number worth acting on — it is unmet intent, and it is the upgrade case.
   */
  multilinkRefused: number;
}

export interface RevenueSeries {
  days: DayPoint[];
  /** True when either table hit ROW_CAP, so the UI can label the window partial. */
  capped: boolean;
  /**
   * The window immediately BEFORE `days`, same length — the comparison
   * baseline the charts overlay. Empty when the scan was capped (see the note
   * where it is built) or when there is no data that far back.
   */
  previousDays: DayPoint[];
  /** Whole days covered, inclusive. */
  rangeDays: number;
  /**
   * True when the read FAILED and this grid is zeros standing in for unknown
   * numbers — as opposed to a real window in which nothing happened.
   *
   * 🔴 The distinction is the whole point. Both render as a flat line at zero,
   * but one means "fix the database" and the other means "traffic was quiet".
   * Optional so every existing construction site stays valid and simply reads
   * as not-failed, which is what they all are.
   */
  failed?: boolean;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * A gap-free row per day, oldest first.
 *
 * 🔴 Gap-free is the point. Grouping observed rows alone produces a series with
 * missing days, and a line chart joins whatever points it is given — so a
 * quiet Sunday silently becomes a straight line from Saturday to Monday and the
 * dip disappears. Every day in the window is emitted, with zeros where nothing
 * happened, because a zero is a fact and an absent point is a fabrication.
 */
export async function getRevenueSeries(rangeDays = 30): Promise<RevenueSeries> {
  const days = Math.min(90, Math.max(7, Math.floor(rangeDays)));
  /*
    ── TWO WINDOWS ARE FETCHED, ONE IS RETURNED AS THE COMPARISON ────────────

    Owner (08-26 open queue, item 2): the charts lost their period-comparison
    overlay when the range picker was dropped, because the window became the
    whole fetched series and there was no earlier slice left to compare against.
    Restoring it needs the PRECEDING window on the server, so the grid spans
    `days * 2` and is split at the end.

    Affordable, measured rather than assumed (2026-08-26, live): over 180 days
    ad_impressions holds 2 513 rows, ad_clicks 0, completed analytics_downloads
    7 741 and events 3 749 — all far inside ROW_CAP, and `capped` covers the
    day that stops being true.
  */
  const span = days * 2;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (span - 1));

  // The gap-free grid, built before any data arrives. Insertion order is
  // oldest-first, which is what lets the split below be a plain slice.
  const grid = new Map<string, DayPoint>();
  for (let i = 0; i < span; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    grid.set(isoDay(d), { date: isoDay(d), impressions: 0, clicks: 0, downloads: 0, installs: 0, rewardsStarted: 0, rewardsGranted: 0, multilinkBatches: 0, multilinkRefused: 0 });
  }

  const empty: RevenueSeries = { days: [...grid.values()].slice(span - days), previousDays: [], capped: false, rangeDays: days };
  if (!hasSupabase) return empty;

  try {
    const db = createAdminClient();
    const since = start.toISOString();
    // PAGED via `.range()`, not a single `.limit(ROW_CAP)` — PostgREST silently
    // caps any one response at 1000 rows regardless of the requested `.limit()`,
    // so a single oversized limit under-reads on any day busy enough to exceed
    // it. See lib/supabase/paginate.ts for how this was found.
    const pull = async (table: "ad_impressions" | "ad_clicks") =>
      paginatedSelect<{ created_at: string }>(
        (from, to) => db.from(table).select("created_at").gte("created_at", since).order("created_at", { ascending: false }).range(from, to),
        ROW_CAP,
      );

    /*
      Downloads read `analytics_downloads`, NOT the legacy `downloads` table —
      deliberately the opposite of what `lib/admin-stats.ts`'s `fetchDownloadStats`
      does (owner, 2026-08-16: "stats in revenue and stats in traffic… shows
      different stat and information… check carefully which shows a false
      information"). `downloads` rows are written unconditionally as
      `status: "completed"` the instant a download is REQUESTED — every attempt,
      retry included, whether or not it ever finished — so a trend line built on
      it would not be a downloads chart, it would be a REQUESTS chart wearing the
      wrong label. `analytics_downloads` is the client-confirmed lifecycle table
      (`app/api/analytics/collect/route.ts`); filtering `status = "completed"`
      here is the one query in this file that answers the question the chart's
      own title asks.
    */
    const pullDownloads = async () =>
      paginatedSelect<{ created_at: string }>(
        (from, to) =>
          db
            .from("analytics_downloads")
            .select("created_at")
            .eq("status", "completed")
            .gte("created_at", since)
            .order("created_at", { ascending: false })
            .range(from, to),
        ROW_CAP,
      );

    /*
      Installs come from the unified `events` table, filtered to the one event
      that means an install really happened. Same paging discipline as the rest:
      PostgREST caps a response at 1000 rows whatever `.limit()` says.
    */
    /* Rewarded-ad lifecycle, from the same unified `events` table. One helper
       for both event types — they differ only by `type`, and two near-identical
       pagers would be two places to forget the row cap. */
    const pullEvent = async (type: string) =>
      paginatedSelect<{ created_at: string }>(
        (from, to) =>
          db
            .from("events")
            .select("created_at")
            .eq("type", type)
            .gte("created_at", since)
            .order("created_at", { ascending: false })
            .range(from, to),
        ROW_CAP,
      );

    const pullInstalls = async () =>
      paginatedSelect<{ created_at: string }>(
        (from, to) =>
          db
            .from("events")
            .select("created_at")
            .eq("type", "pwa_installed")
            .gte("created_at", since)
            .order("created_at", { ascending: false })
            .range(from, to),
        ROW_CAP,
      );

    const [impr, clicks, dl, inst, rewardStart, rewardGrant, batchRun, batchRefused] = await Promise.all([
      pull("ad_impressions"),
      pull("ad_clicks"),
      pullDownloads(),
      pullInstalls(),
      pullEvent("reward_started"),
      pullEvent("reward_granted"),
      // Multi-Link, through the same helper — they differ only by `type`.
      pullEvent("batch_started"),
      pullEvent("batch_refused"),
    ]);

    for (const r of impr.rows) {
      const cell = grid.get(r.created_at.slice(0, 10));
      if (cell) cell.impressions += 1;
    }
    for (const r of clicks.rows) {
      const cell = grid.get(r.created_at.slice(0, 10));
      if (cell) cell.clicks += 1;
    }
    for (const r of dl.rows) {
      const cell = grid.get(r.created_at.slice(0, 10));
      if (cell) cell.downloads += 1;
    }
    for (const r of inst.rows) {
      const cell = grid.get(r.created_at.slice(0, 10));
      if (cell) cell.installs += 1;
    }
    for (const r of rewardStart.rows) {
      const cell = grid.get(r.created_at.slice(0, 10));
      if (cell) cell.rewardsStarted += 1;
    }
    for (const r of rewardGrant.rows) {
      const cell = grid.get(r.created_at.slice(0, 10));
      if (cell) cell.rewardsGranted += 1;
    }
    for (const r of batchRun.rows) {
      const cell = grid.get(r.created_at.slice(0, 10));
      if (cell) cell.multilinkBatches += 1;
    }
    for (const r of batchRefused.rows) {
      const cell = grid.get(r.created_at.slice(0, 10));
      if (cell) cell.multilinkRefused += 1;
    }

    const all = [...grid.values()];
    const capped =
        impr.capped ||
        clicks.capped ||
        dl.capped ||
        inst.capped ||
        rewardStart.capped ||
        rewardGrant.capped ||
        batchRun.capped ||
        batchRefused.capped;

    return {
      days: all.slice(span - days),
      /*
        🔴 NO COMPARISON WHEN THE SCAN WAS CAPPED. Paging is newest-first, so a
        cap drops the OLDEST rows — which is precisely the previous window. A
        comparison drawn from a partially-read baseline would show a line that
        sags for a reason that has nothing to do with the business, which is
        worse than drawing no baseline at all.
      */
      previousDays: capped ? [] : all.slice(0, span - days),
      capped,
      rangeDays: days,
    };
  } catch {
    /*
      An unmigrated or unreachable table yields the ZERO grid rather than
      throwing: the dashboard still renders.

      🔴 But it renders FLAGGED. Returning a silent zero grid made a failed read
      pixel-identical to a genuinely quiet week, and those two call for opposite
      responses — one is an outage to fix, the other is a business fact. The
      panel reads `failed` and says which it is looking at, so nobody goes
      hunting for the cause of a traffic collapse that never happened.
    */
    return { ...empty, failed: true };
  }
}
