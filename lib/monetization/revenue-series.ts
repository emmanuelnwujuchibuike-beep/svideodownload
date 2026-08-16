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
}

export interface RevenueSeries {
  days: DayPoint[];
  /** True when either table hit ROW_CAP, so the UI can label the window partial. */
  capped: boolean;
  /** Whole days covered, inclusive. */
  rangeDays: number;
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
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  // The gap-free grid, built before any data arrives.
  const grid = new Map<string, DayPoint>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    grid.set(isoDay(d), { date: isoDay(d), impressions: 0, clicks: 0, downloads: 0 });
  }

  const empty: RevenueSeries = { days: [...grid.values()], capped: false, rangeDays: days };
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
        (from, to) => db.from(table).select("created_at").gte("created_at", since).order("created_at", { ascending: true }).range(from, to),
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
            .order("created_at", { ascending: true })
            .range(from, to),
        ROW_CAP,
      );

    const [impr, clicks, dl] = await Promise.all([pull("ad_impressions"), pull("ad_clicks"), pullDownloads()]);

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

    return { days: [...grid.values()], capped: impr.capped || clicks.capped || dl.capped, rangeDays: days };
  } catch {
    // An unmigrated or unreachable table yields the ZERO grid, not an error
    // state: the dashboard still renders, and a flat zero line is honest about
    // what we can see.
    return empty;
  }
}
