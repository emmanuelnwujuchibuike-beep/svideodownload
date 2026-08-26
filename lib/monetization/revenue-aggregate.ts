/**
 * Revenue time-series aggregation — the single source of truth for turning a
 * gap-free DAILY grid into daily / weekly / monthly points.
 *
 * ── Why this is its own pure module (§13, §24) ────────────────────────────
 * The brief asks for a real aggregation layer rather than "fewer visual points
 * over the same daily data", and for the calculation not to be duplicated
 * across UI components. Keeping it pure means the calendar edges that actually
 * break these things — a week spanning two months, a week spanning two YEARS,
 * a month boundary, a leap day — are unit-testable without rendering a chart.
 *
 * ── Local calendar, not UTC (owner, 2026-08-25: "my local time zone") ─────
 * Weeks and months are resolved through the runtime's own calendar, so a week
 * is the seven local days a person would point at, and a month ends where their
 * calendar says it does. `dayKeyToLocalDate` is the one place a `YYYY-MM-DD`
 * becomes a Date, and it deliberately parses the parts rather than passing the
 * string to `new Date()` — `new Date("2026-08-20")` is parsed as UTC midnight
 * by spec, which in any timezone behind UTC lands on the 19th and silently
 * shifts a day's revenue into the previous bucket. That is exactly the §14
 * failure ("do NOT allow UTC conversion to accidentally move revenue from one
 * calendar day into another"), and it is a one-character mistake to make.
 *
 * ⚠️ Known and stated, not hidden: the DAY totals arriving here are bucketed
 * server-side by UTC day (`lib/monetization/revenue-series.ts`). Weeks and
 * months are grouped in local time, but a single day's boundary is still UTC's.
 * Making that local too requires the server to know the viewer's timezone,
 * which is a separate change (a timezone cookie read by the admin page).
 */

export type Granularity = "daily" | "weekly" | "monthly";

/** One day of the source grid: an ISO `YYYY-MM-DD` and its total. */
export interface DailyPoint {
  date: string;
  value: number;
}

export interface AggregatedPoint {
  /** Stable key for React and for tooltip lookup. */
  key: string;
  /** Short label — "Aug 3", "Aug 3–9", "Aug". Used by the tooltip and table. */
  label: string;
  /**
   * The COMPACT x-axis label, in Search Console's own format.
   *
   * Owner, 2026-08-25, comparing our chart against two Search Console
   * screenshots: "use exactly the measurement, button style, design and
   * calculation from the image … days should show on one line".
   *
   * Search Console prints `M/D` — "8/3" — and for a WEEK it prints the week's
   * START date, not the range. That is why its axis fits a dozen dates on one
   * line where ours fits four: "Aug 3–9" is nine characters against three.
   *
   * 🔴 A SEPARATE FIELD, not a reformatted `label`. The tooltip and the table
   * still want the unambiguous form — "8/3" alone does not say whether you are
   * looking at one day or the seven that start on it, and that distinction is
   * the whole point of the granularity control. So the axis gets the terse
   * version and the tooltip keeps the explicit one.
   */
  axisLabel: string;
  /** Full tooltip label — "Aug 3, 2026", "Aug 3–9, 2026", "August 2026". */
  fullLabel: string;
  value: number;
  /** Inclusive bounds, for a tooltip that wants to say exactly what it covers. */
  start: string;
  end: string;
  /** How many source days this bucket actually covers — a partial leading or
   *  trailing week/month is real and should not be presented as a full one. */
  days: number;
}

/**
 * `YYYY-MM-DD` → a Date at LOCAL midnight.
 *
 * Never `new Date(key)`: that is spec'd to parse a date-only string as UTC, so
 * west of Greenwich it resolves to the previous day and every bucket edge moves.
 */
export function dayKeyToLocalDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/** Local `YYYY-MM-DD` for a Date, without going through UTC. */
export function localDayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The Monday that starts this date's week.
 *
 * Monday, consistently, everywhere — §3 asks for "a consistent week definition
 * throughout the application", and the alternative (the locale's own first day)
 * would silently regroup the same data differently for different viewers.
 */
export function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // getDay(): 0 = Sunday. Shift so Monday is 0.
  const shift = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - shift);
  return out;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function shortDay(d: Date): string {
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

/**
 * `M/D` — Search Console's axis format.
 *
 * Unpadded on purpose: "8/3", not "08/03". Search Console prints it unpadded,
 * and the padding is two wasted characters on the one axis that is short of
 * room. Month FIRST, matching the reference; this is an axis tick rather than
 * prose, so it is not run through the locale formatter — a locale that flipped
 * it to D/M would silently disagree with the screenshots this was built to.
 */
function numericDay(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * Aggregate a gap-free daily grid.
 *
 * The input is assumed complete (every day present, zeros included) — that is
 * what `getRevenueSeries` guarantees, and §25 requires a zero day to stay a
 * zero rather than becoming a gap the line interpolates across.
 */
export function aggregateRevenue(days: DailyPoint[], granularity: Granularity): AggregatedPoint[] {
  if (days.length === 0) return [];

  if (granularity === "daily") {
    return days.map((d) => {
      const date = dayKeyToLocalDate(d.date);
      return {
        key: d.date,
        label: shortDay(date),
        axisLabel: numericDay(date),
        fullLabel: `${shortDay(date)}, ${date.getFullYear()}`,
        value: d.value,
        start: d.date,
        end: d.date,
        days: 1,
      };
    });
  }

  /*
    One pass, bucketing by a computed key.

    A Map preserves insertion order, and the input is oldest-first, so the
    output is chronological without a sort — and without a sort there is no
    chance of a locale-dependent string comparison reordering "Aug" before
    "Jul", which is the classic way month buckets come out shuffled.
  */
  const buckets = new Map<string, { start: Date; end: Date; value: number; days: number }>();

  for (const d of days) {
    const date = dayKeyToLocalDate(d.date);
    const bucketStart = granularity === "weekly"
      ? startOfWeek(date)
      : new Date(date.getFullYear(), date.getMonth(), 1);
    const key = localDayKey(bucketStart);

    const existing = buckets.get(key);
    if (existing) {
      existing.value += d.value;
      existing.days += 1;
      if (date > existing.end) existing.end = date;
    } else {
      buckets.set(key, { start: bucketStart, end: date, value: d.value, days: 1 });
    }
  }

  return [...buckets.entries()].map(([key, b]) => {
    if (granularity === "monthly") {
      return {
        key,
        label: MONTHS_SHORT[b.start.getMonth()]!,
        // A month is already short enough to print whole — Search Console does
        // the same. Only days and weeks need the numeric form.
        axisLabel: MONTHS_SHORT[b.start.getMonth()]!,
        fullLabel: `${MONTHS_LONG[b.start.getMonth()]} ${b.start.getFullYear()}`,
        value: b.value,
        start: localDayKey(b.start),
        end: localDayKey(b.end),
        days: b.days,
      };
    }

    /*
      A week's label shows the range it actually COVERS, not the calendar week
      it belongs to. The first bucket of a 30-day window usually starts
      mid-week, and labelling it with the Monday before the window began would
      claim revenue for days the query never looked at.
    */
    const first = dayKeyToLocalDate(
      // The earliest day present in this bucket, which is the bucket start
      // except for a leading partial week.
      localDayKey(b.start) < days[0]!.date ? days[0]!.date : localDayKey(b.start),
    );
    const sameMonth = first.getMonth() === b.end.getMonth();
    const label = sameMonth
      ? `${shortDay(first)}–${b.end.getDate()}`
      : `${shortDay(first)}–${shortDay(b.end)}`;
    const sameYear = first.getFullYear() === b.end.getFullYear();
    const fullLabel = sameYear
      ? `${label}, ${b.end.getFullYear()}`
      : // A week spanning New Year needs both years or it is ambiguous.
        `${shortDay(first)}, ${first.getFullYear()} – ${shortDay(b.end)}, ${b.end.getFullYear()}`;

    return {
      key,
      label,
      /*
        The week's START, numerically — "8/3" for the week of Aug 3–9. Exactly
        what Search Console prints, and the reason its weekly axis reads as a
        clean run of dates seven days apart instead of a row of ranges.
      */
      axisLabel: numericDay(first),
      fullLabel,
      value: b.value,
      start: localDayKey(first),
      end: localDayKey(b.end),
      days: b.days,
    };
  });
}

/**
 * How many X-axis labels to show, and which (§5).
 *
 * Search Console does not print every date — it prints as many as fit and
 * leaves the rest to the tooltip. Returns the set of indices to LABEL; every
 * data point still exists and is still hoverable.
 *
 * Always includes the first and last, because an axis whose ends are unlabelled
 * doesn't say what range you are looking at.
 */
export function axisLabelIndices(count: number, maxLabels: number): Set<number> {
  if (count <= 0) return new Set();
  if (count <= maxLabels) return new Set(Array.from({ length: count }, (_, i) => i));

  const out = new Set<number>([0, count - 1]);
  // `maxLabels - 1` gaps between `maxLabels` labels, first and last pinned.
  const step = (count - 1) / (maxLabels - 1);
  for (let i = 1; i < maxLabels - 1; i++) out.add(Math.round(i * step));
  return out;
}

/**
 * A clean Y-axis ceiling and its ticks (§6).
 *
 * Snaps to 1/2/5 × a power of ten so the labels read as $500 / $1K / $1.5K
 * rather than $1,337.482. Returns the ceiling plus evenly-spaced tick VALUES;
 * formatting them is the caller's job, so the currency formatter stays in one
 * place (§15).
 */
export function axisScale(values: number[], ticks = 4): { top: number; ticks: number[] } {
  const peak = Math.max(0, ...values);
  if (peak <= 0) {
    // An all-zero window still needs a readable axis rather than a flat line
    // against an undefined scale.
    return { top: 1, ticks: [0, 1] };
  }

  const rough = peak / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const stepMul = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = stepMul * mag;
  const top = Math.ceil(peak / step) * step;

  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(Number(v.toFixed(6)));
  return { top, ticks: out };
}
