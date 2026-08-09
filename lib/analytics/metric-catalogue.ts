import type { AnalyticsSummary } from "./queries";

/**
 * What every number on the analytics dashboard MEANS, how it is measured, and
 * which direction is good.
 *
 * ── Why a catalogue and not labels in the JSX (owner, 2026-08-09) ────────────
 * The brief asked that each metric carry a title, a description, a tooltip, a
 * trend and a status. Written inline, those drift from the query that produces
 * them the first time anyone changes a definition — and a stale description on a
 * correct number is worse than no description, because it is believed.
 *
 * Keeping the definition next to the direction and the thresholds also forces
 * the question the dashboard kept getting wrong: **which way is good?** Bounce
 * rate rising is bad, success rate rising is good, and a card that paints every
 * increase green is actively misleading. `higherIsBetter` is what the trend
 * colour is derived from, so that cannot be got wrong per-card.
 *
 * `measurement` is deliberately blunt about limits. Where a number is exact it
 * says so; where something is not counted (a bot, a sub-second dwell) it says
 * that too. An operator reading "why is this lower than Google Analytics?"
 * should find the answer in the tooltip rather than assume a bug.
 */

export type MetricFormat = "count" | "percent" | "seconds" | "bytes" | "currency";

export interface MetricSpec {
  id: string;
  /** Sentence case, no trailing colon — the stat-tile contract. */
  title: string;
  /** One line: what this counts. */
  description: string;
  /** The tooltip: how it is measured, and what it deliberately excludes. */
  measurement: string;
  format: MetricFormat;
  /**
   * Which direction is an improvement. `null` for a metric that is neither —
   * "sessions" going up is not automatically good or bad, it is just traffic.
   * A null here renders the change in neutral ink with no green/red claim.
   */
  higherIsBetter: boolean | null;
  /** Reads the current value out of a summary. */
  value: (s: AnalyticsSummary) => number;
  /** Reads the comparable previous-period value, or null when unknown. */
  previous: (s: AnalyticsSummary) => number | null;
  /**
   * Optional health call on the CURRENT value. Returns a status the card shows
   * as an icon plus a word — never colour alone (accessibility, and colour is
   * the first thing lost to a screenshot in a chat).
   */
  status?: (v: number, s: AnalyticsSummary) => MetricStatus | null;
}

export type MetricStatus = { level: "good" | "warning" | "critical"; label: string };

const p = (s: AnalyticsSummary) => s.previous;

export const TRAFFIC_METRICS: MetricSpec[] = [
  {
    id: "live",
    title: "Live visitors",
    description: "People active on the site in the last 5 minutes.",
    measurement:
      "Distinct visitor IDs with any event in the last 5 minutes, bots excluded. The window is longer than the 3s event-flush debounce so a reader never flickers out of the count, and short enough that 'live' means live — Google Analytics' realtime uses 30 minutes and so includes people who left long ago.",
    format: "count",
    higherIsBetter: null,
    value: (s) => s.liveVisitors,
    // A live count has no meaningful previous-period comparison — it is an
    // instantaneous reading, not a total over the range.
    previous: () => null,
  },
  {
    id: "unique",
    title: "Unique visitors",
    description: "Distinct people who visited in this period.",
    measurement:
      "Exact COUNT(DISTINCT visitor_id) in Postgres, bots excluded. A visitor ID is a random UUID in localStorage — so it counts DEVICES, not humans: one person on a phone and a laptop is two, and clearing site data resets it. No IP address is stored anywhere in this pipeline.",
    format: "count",
    higherIsBetter: true,
    value: (s) => s.uniqueVisitors,
    previous: (s) => p(s)?.uniqueVisitors ?? null,
  },
  {
    id: "returning",
    title: "Returning visitors",
    description: "Visitors who had been here before this period started.",
    measurement:
      "Exact: a visitor whose earliest-ever recorded event predates this period. Everyone else counts as new. Previously this was estimated from a 500-visitor sample and scaled up — it is now a real count.",
    format: "count",
    higherIsBetter: true,
    value: (s) => s.returningVisitors,
    previous: () => null,
  },
  {
    id: "sessions",
    title: "Sessions",
    description: "Visits, where a visit ends after 30 minutes of inactivity.",
    measurement:
      "Exact COUNT(DISTINCT session_id). 30 minutes is the industry-standard inactivity window (GA, Plausible, Adobe), chosen so this number is comparable to those tools. Counting distinct IDs rather than 'session started' events makes a two-tab race harmless.",
    format: "count",
    higherIsBetter: null,
    value: (s) => s.sessions,
    previous: (s) => p(s)?.sessions ?? null,
  },
  {
    id: "pageviews",
    title: "Page views",
    description: "Pages opened, including repeat views of the same page.",
    measurement:
      "One per page opened. A refresh is one view (correct — it is a new page load). A client-side navigation to the SAME path is not re-counted, and React re-renders and Strict Mode's double effects are guarded, so neither can inflate this.",
    format: "count",
    higherIsBetter: true,
    value: (s) => s.pageViews,
    previous: (s) => p(s)?.pageViews ?? null,
  },
  {
    id: "bounce",
    title: "Bounce rate",
    description: "Share of visits where only one page was opened.",
    measurement:
      "Sessions with exactly one page view, over all sessions. This is the classic definition, so it reads high for a tool site: someone who arrives, downloads their video and leaves has done exactly what they came for and still counts as a bounce. Read it alongside downloads, not on its own.",
    format: "percent",
    higherIsBetter: false,
    value: (s) => s.bounceRatePct,
    previous: (s) => p(s)?.bounceRatePct ?? null,
  },
  {
    id: "timeonpage",
    title: "Time on page",
    description: "Average time a page is actually looked at.",
    measurement:
      "Measured, not estimated: each page reports the time it was VISIBLE when it is left. Time in a background tab does not count, dwells under 1 second are dropped as bounce-throughs, and a single dwell is capped at 30 minutes so a sleeping device cannot skew the mean. Unlike the usual 'next event minus this event' estimate, the last page of a visit is included instead of counting as zero.",
    format: "seconds",
    higherIsBetter: true,
    value: (s) => s.avgTimeOnPageSec,
    previous: (s) => p(s)?.avgTimeOnPageSec ?? null,
  },
];

export const DOWNLOAD_METRICS: MetricSpec[] = [
  {
    id: "dl-completed",
    title: "Downloads completed",
    description: "Files successfully delivered to a device.",
    measurement:
      "Exact count of downloads in the 'completed' state. One row per download, keyed by a client-generated ID, so automatic retries of the same download never count twice — and a double-tap on the button is now collapsed into the one download it was meant to be.",
    format: "count",
    higherIsBetter: true,
    value: (s) => s.downloads.completed,
    previous: (s) => p(s)?.downloadsCompleted ?? null,
  },
  {
    id: "dl-failed",
    title: "Downloads failed",
    description: "Downloads that ran out of retries and gave up.",
    measurement:
      "Only counted once the automatic retry policy is exhausted — a transient 502 that succeeds on attempt two is a success, not a failure, which is why this is lower than the raw error count in the server logs.",
    format: "count",
    higherIsBetter: false,
    value: (s) => s.downloads.failed,
    previous: (s) => p(s)?.downloadsFailed ?? null,
    status: (v, s) =>
      s.downloads.attempted === 0
        ? null
        : v / s.downloads.attempted > 0.2
          ? { level: "critical", label: "Over 20% failing" }
          : v / s.downloads.attempted > 0.05
            ? { level: "warning", label: "Elevated" }
            : { level: "good", label: "Healthy" },
  },
  {
    id: "dl-cancelled",
    title: "Downloads cancelled",
    description: "Downloads a visitor stopped on purpose.",
    measurement:
      "A deliberate cancel — the X on the progress card. This was a permanent zero until 2026-08-09: the event type existed and had a column, but nothing ever emitted it. Cancels are excluded from the success rate, because a change of mind is not a delivery failure.",
    format: "count",
    higherIsBetter: null,
    value: (s) => s.downloads.cancelled,
    previous: () => null,
  },
  {
    id: "dl-abandoned",
    title: "Downloads abandoned",
    description: "Started, then never finished, failed or cancelled.",
    measurement:
      "Almost always a closed tab or a lost connection mid-transfer — the browser stops without telling us. These are excluded from the success rate for the same reason as cancels: nothing was reported to have gone wrong. A rising number here is worth investigating as a speed problem.",
    format: "count",
    higherIsBetter: false,
    value: (s) => s.downloads.abandoned,
    previous: () => null,
  },
  {
    id: "dl-success",
    title: "Download success rate",
    description: "Of downloads actually attempted, the share that completed.",
    measurement:
      "completed ÷ (completed + failed). Cancelled and abandoned downloads are NOT in the denominator — including them measured visitor intent as much as our reliability, and got worse whenever the site got busier. This is the number to judge extractor health by.",
    format: "percent",
    higherIsBetter: true,
    value: (s) => s.downloads.successRate,
    previous: (s) => p(s)?.successRate ?? null,
    status: (v, s) =>
      s.downloads.attempted === 0
        ? null
        : v >= 95
          ? { level: "good", label: "Healthy" }
          : v >= 80
            ? { level: "warning", label: "Degraded" }
            : { level: "critical", label: "Failing" },
  },
  {
    id: "dl-bytes",
    title: "Bandwidth delivered",
    description: "Total bytes streamed to visitors for completed downloads.",
    measurement:
      "Exact sum of the measured file size of every completed download — the real bytes we transferred, not an estimate from an average. Only completed downloads contribute, so a transfer abandoned halfway is not counted even though it did use bandwidth; treat this as a floor.",
    format: "bytes",
    higherIsBetter: null,
    value: (s) => s.downloads.bytesDelivered,
    previous: () => null,
  },
];

export const AD_METRICS: MetricSpec[] = [
  {
    id: "ad-impressions",
    title: "Ad impressions",
    description: "Ad slots actually seen by a visitor.",
    measurement:
      "Counted when a slot is at least 50% visible for one continuous second — the IAB Display standard, so this can be reconciled against what the ad network reports. Time in a background tab does not accrue. Before 2026-08-09 this counted every slot that LOADED, including ones below the fold nobody scrolled to, which inflated both this and every revenue figure derived from it.",
    format: "count",
    higherIsBetter: true,
    value: (s) => s.ads.impressions,
    previous: (s) => p(s)?.adImpressions ?? null,
  },
  {
    id: "ad-clicks",
    title: "Ad clicks",
    description: "Clicks on an ad we serve.",
    measurement:
      "Counted on the click itself. Rate-limited per IP to resist floods. Network-rendered ads inside the sandboxed frame report to the network, not to us, so this is our own house/native click count.",
    format: "count",
    higherIsBetter: true,
    value: (s) => s.ads.clicks,
    previous: (s) => p(s)?.adClicks ?? null,
  },
  {
    id: "ad-ctr",
    title: "Click-through rate",
    description: "Clicks as a share of viewable impressions.",
    measurement:
      "clicks ÷ impressions. Both sides now use the same viewability standard, so this is directly comparable to a network dashboard. It rose when viewability shipped — the clicks were always real, the denominator was not.",
    format: "percent",
    higherIsBetter: true,
    value: (s) => s.ads.ctr,
    previous: (s) => {
      const prev = p(s);
      if (!prev || prev.adImpressions === 0) return null;
      return Math.round((prev.adClicks / prev.adImpressions) * 1000) / 10;
    },
  },
  {
    id: "ad-rewards",
    title: "Reward ads watched",
    description: "Visitors who watched a rewarded ad and claimed the HD unlock.",
    measurement:
      "Counted when the unlock is CLAIMED, not when the timer runs out — an ad that finished playing in a tab nobody returned to is not a reward anyone watched. This had no source at all before 2026-08-09: the gate granted the reward but recorded nothing, so the metric could only ever have shown zero.",
    format: "count",
    higherIsBetter: true,
    value: (s) => s.rewardsWatched,
    previous: () => null,
  },
  {
    id: "ad-revenue",
    title: "Estimated ad revenue",
    description: "A projection, not money received.",
    measurement:
      "impressions ÷ 1000 × the CPM you set on this page. It is arithmetic on your own assumption — the real figure is whatever the ad network pays, and the two will differ. Shown so the CPM can be tuned until it tracks reality; never treat it as booked income.",
    format: "currency",
    higherIsBetter: true,
    value: (s) => s.ads.revenueUsd,
    previous: (s) => {
      const prev = p(s);
      if (!prev) return null;
      return Math.round((prev.adImpressions / 1000) * s.ads.cpmUsd * 100) / 100;
    },
  },
];

/** Percentage change against the previous period, or null when unknowable. */
export function changePct(current: number, previous: number | null): number | null {
  if (previous === null) return null;
  // A rise from zero is not "infinity percent" — it is a new thing happening,
  // and rendering ∞ or 100% would both be lies. The card shows "new" instead.
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
