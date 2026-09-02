/**
 * The time windows the admin analytics measures — the PURE half.
 *
 * 🔴 No Supabase, no `server-only`, no I/O. `queries.ts` reaches the database
 * and therefore cannot be imported by a test; this module exists so the window
 * arithmetic — which is where a real reporting bug lived — can be asserted
 * directly.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 THE HEADLINE WINDOW AND THE CHART'S BUCKETS ARE ONE WINDOW.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-02: "the stats in admin dashboard percentage drop doesnt match
 * with the actual daily figure."
 *
 * It could not have matched, because the two were measuring different ranges:
 *
 *   · the cards used a ROLLING window — `Date.now() - days * 86400000` — so a
 *     7-day card started mid-afternoon seven days ago;
 *   · `buildBuckets` draws CALENDAR-ALIGNED bars: it snaps to midnight (or the
 *     top of the hour for 24h) and walks back.
 *
 * So the chart's first bar covered a day the headline only partly counted, and
 * adding the bars up could never reproduce the number printed above them. The
 * percentage was computed over a window the chart never displayed.
 *
 * The window is now DERIVED from the buckets, so the number, the chart and the
 * change are three views of one range instead of three different ranges.
 */

export type Range = "24h" | "7d" | "30d" | "90d";

const RANGE_DAYS: Record<Range, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };

export function rangeDays(range: Range): number {
  return RANGE_DAYS[range];
}

/** Ordered, gap-free bucket keys from the start of the range to now. */
export function buildBuckets(range: Range): { granularity: "hour" | "day"; keys: string[]; step: number } {
  const granularity: "hour" | "day" = range === "24h" ? "hour" : "day";
  const count = range === "24h" ? 24 : rangeDays(range);
  const step = granularity === "hour" ? 3_600_000 : 86_400_000;
  const base = new Date();
  if (granularity === "hour") base.setMinutes(0, 0, 0);
  else base.setHours(0, 0, 0, 0);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) keys.push(new Date(base.getTime() - i * step).toISOString());
  return { granularity, keys, step };
}

export function bucketStartMs(iso: string, granularity: "hour" | "day"): number {
  const d = new Date(iso);
  if (granularity === "hour") d.setMinutes(0, 0, 0);
  else d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The start of the chart's first bucket — and therefore of the headline. */
function windowStartMs(range: Range): number {
  const first = buildBuckets(range).keys[0];
  return first ? new Date(first).getTime() : Date.now() - rangeDays(range) * 86_400_000;
}

export function sinceIso(range: Range): string {
  return new Date(windowStartMs(range)).toISOString();
}

/**
 * The comparable preceding window.
 *
 * Shifted back by exactly one range length rather than being "the previous
 * calendar period", which keeps the comparison like-for-like in BOTH duration
 * and phase-of-day. That matters because the current window's last bucket is
 * today so far: at 10am it holds four hours, so comparing it against a complete
 * day would manufacture a large fake drop every single morning. Shifting the
 * whole window back means the previous one is truncated at the same point in
 * its final day, and the percentage reflects a real change rather than the time
 * of day somebody happened to open the dashboard.
 */
export function priorWindow(range: Range): { from: string; to: string } {
  const shift = rangeDays(range) * 86_400_000;
  const start = windowStartMs(range);
  return {
    from: new Date(start - shift).toISOString(),
    to: new Date(Date.now() - shift).toISOString(),
  };
}

/**
 * The windows the dashboard is measuring, exposed so the alignment above can be
 * asserted rather than trusted.
 *
 * The bug this guards against is invisible in the UI — both numbers look
 * plausible on their own, and it only surfaces when somebody adds the bars up.
 */
export function analyticsWindows(range: Range): {
  since: string;
  firstBucket: string;
  prior: { from: string; to: string };
} {
  return { since: sinceIso(range), firstBucket: buildBuckets(range).keys[0]!, prior: priorWindow(range) };
}
