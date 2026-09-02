/**
 * Group a daily series into weeks or months — the PURE half.
 *
 * 🔴 No React, no I/O. Accuracy is the whole requirement here (owner,
 * 2026-09-02: "put a daily , weekly and monthly trend and button in the page
 * view chart , they must be very accurate"), so the arithmetic lives where it
 * can be asserted rather than eyeballed on a chart.
 *
 * ── The three ways a rollup like this is usually wrong ───────────────────
 *
 * 1. DOUBLE COUNTING or DROPPING at the boundary. Every input day must land in
 *    exactly one output bucket. The tests assert that as a property: the sum of
 *    the grouped values equals the sum of the input, always.
 *
 * 2. Silently plotting a PARTIAL period next to complete ones. The current week
 *    is two days old on a Tuesday; drawn beside seven-day weeks it looks like
 *    traffic collapsed. Each bucket therefore reports `complete`, and the chart
 *    says so rather than letting the shape lie.
 *
 * 3. Weeks that drift. Bucketing by "every 7th row from the end" produces weeks
 *    that start on a different weekday depending on when you look, so the same
 *    data yields different charts on different days. These are real ISO weeks,
 *    Monday to Sunday, and real calendar months.
 *
 * Dates are handled as plain `YYYY-MM-DD` strings in LOCAL terms — the series
 * comes from calendar-aligned buckets built with `setHours(0,0,0,0)`, so
 * reparsing them as UTC would shift every boundary by the viewer's offset.
 */

export type Grouping = "daily" | "weekly" | "monthly";

export interface DayPoint {
  /** `YYYY-MM-DD`. */
  date: string;
  value: number;
}

export interface GroupedPoint {
  /** Terse axis tick. */
  label: string;
  /** Unambiguous tooltip form, including the range for a rollup. */
  fullLabel: string;
  value: number;
  /** First day in the bucket, `YYYY-MM-DD`. */
  start: string;
  /** Last day PRESENT in the bucket — not the last day the period could hold. */
  end: string;
  /** False when the period is not finished, or the data does not cover it. */
  complete: boolean;
  /** How many days of data this bucket actually contains. */
  days: number;
}

/** Parse `YYYY-MM-DD` as a LOCAL date, never UTC. */
function parse(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function iso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The Monday on or before `d`. ISO weeks start Monday. */
function mondayOf(d: Date): Date {
  const out = new Date(d);
  // getDay(): 0 = Sunday. Shift so Monday is 0.
  const shift = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - shift);
  out.setHours(0, 0, 0, 0);
  return out;
}

function shortDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Group a daily series.
 *
 * @param points Daily values, any order — sorted internally so a caller cannot
 *   produce a scrambled chart by handing them over backwards.
 * @param grouping daily | weekly | monthly
 * @param today The day "now" falls in, `YYYY-MM-DD`. Injected rather than read
 *   from the clock so completeness is testable and so a chart rendered either
 *   side of midnight cannot disagree with itself.
 */
export function groupSeries(points: DayPoint[], grouping: Grouping, today: string): GroupedPoint[] {
  const sorted = [...points].filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date)).sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return [];

  if (grouping === "daily") {
    return sorted.map((p) => {
      const d = parse(p.date);
      return {
        label: shortDate(d),
        fullLabel: d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
        value: p.value,
        start: p.date,
        end: p.date,
        // A day is complete once it is not today.
        complete: p.date < today,
        days: 1,
      };
    });
  }

  const buckets = new Map<string, { start: Date; days: DayPoint[] }>();
  for (const p of sorted) {
    const d = parse(p.date);
    const start = grouping === "weekly" ? mondayOf(d) : new Date(d.getFullYear(), d.getMonth(), 1);
    const key = iso(start);
    const b = buckets.get(key);
    if (b) b.days.push(p);
    else buckets.set(key, { start, days: [p] });
  }

  const todayDate = parse(today);

  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, b]) => {
      const value = b.days.reduce((sum, d) => sum + d.value, 0);
      const end = b.days[b.days.length - 1]!.date;

      /*
        The last day this period COULD hold — not the last it does. A period is
        complete only when that day has fully passed AND every day in it is
        present, so a gap in the data cannot masquerade as a finished week.
      */
      const periodEnd =
        grouping === "weekly"
          ? new Date(b.start.getFullYear(), b.start.getMonth(), b.start.getDate() + 6)
          : new Date(b.start.getFullYear(), b.start.getMonth() + 1, 0);
      const expected =
        grouping === "weekly"
          ? 7
          : new Date(b.start.getFullYear(), b.start.getMonth() + 1, 0).getDate();

      const complete = periodEnd < todayDate && b.days.length === expected;

      if (grouping === "weekly") {
        return {
          label: shortDate(b.start),
          fullLabel: `${b.start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${periodEnd.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}${complete ? "" : " (partial)"}`,
          value,
          start: key,
          end,
          complete,
          days: b.days.length,
        };
      }

      return {
        label: `${MONTHS[b.start.getMonth()]}`,
        fullLabel: `${MONTHS[b.start.getMonth()]} ${b.start.getFullYear()}${complete ? "" : " (partial)"}`,
        value,
        start: key,
        end,
        complete,
        days: b.days.length,
      };
    });
}
