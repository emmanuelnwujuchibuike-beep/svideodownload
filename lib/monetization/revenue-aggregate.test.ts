import { describe, expect, it } from "vitest";

import {
  aggregateRevenue,
  axisLabelIndices,
  axisScale,
  dayKeyToLocalDate,
  localDayKey,
  startOfWeek,
  type DailyPoint,
} from "./revenue-aggregate";

/** A gap-free grid of `n` days from `from`, each worth `value` (or a ramp). */
function grid(from: string, n: number, value: (i: number) => number = () => 1): DailyPoint[] {
  const start = dayKeyToLocalDate(from);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { date: localDayKey(d), value: value(i) };
  });
}

const sum = (points: { value: number }[]) => points.reduce((n, p) => n + p.value, 0);

describe("🔴 a date-only key is parsed in LOCAL time, never UTC", () => {
  /*
    §14: "do NOT allow UTC conversion to accidentally move revenue from one
    calendar day into another". `new Date("2026-08-20")` is spec'd to parse as
    UTC midnight, so anywhere behind Greenwich it resolves to Aug 19 and every
    bucket edge shifts by a day. This is the single easiest way to silently
    corrupt the whole chart.
  */
  it("keeps the calendar day it was given", () => {
    const d = dayKeyToLocalDate("2026-08-20");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7); // August
    expect(d.getDate()).toBe(20);
  });

  it("round-trips through localDayKey", () => {
    // 2028-02-29 is a REAL leap day. 2026 has none — asking for it rolls to
    // Mar 1, which is correct Date behaviour and not something to assert on.
    for (const key of ["2026-01-01", "2028-02-29", "2026-08-20", "2026-12-31"]) {
      expect(localDayKey(dayKeyToLocalDate(key))).toBe(key);
    }
  });
});

describe("weeks start on Monday, consistently", () => {
  it("maps every day of one week to the same Monday", () => {
    // 2026-08-17 is a Monday.
    const monday = "2026-08-17";
    for (let i = 0; i < 7; i++) {
      const d = new Date(2026, 7, 17 + i);
      expect(localDayKey(startOfWeek(d)), `offset ${i}`).toBe(monday);
    }
    // The next day starts a NEW week.
    expect(localDayKey(startOfWeek(new Date(2026, 7, 24)))).toBe("2026-08-24");
  });

  it("treats Sunday as the END of its week, not the start", () => {
    // The classic off-by-one: getDay() === 0 for Sunday.
    expect(localDayKey(startOfWeek(new Date(2026, 7, 23)))).toBe("2026-08-17");
  });
});

describe("daily aggregation", () => {
  it("is one point per day, in order, with values untouched", () => {
    const out = aggregateRevenue(grid("2026-08-01", 5, (i) => i), "daily");
    expect(out).toHaveLength(5);
    expect(out.map((p) => p.value)).toEqual([0, 1, 2, 3, 4]);
    expect(out[0]!.label).toBe("Aug 1");
    expect(out[0]!.fullLabel).toBe("Aug 1, 2026");
  });

  it("keeps a zero day as a zero, not a gap", () => {
    // §25 — a missing point would let the line interpolate across it and
    // invent revenue that never existed.
    const out = aggregateRevenue(grid("2026-08-01", 3, (i) => (i === 1 ? 0 : 10)), "daily");
    expect(out.map((p) => p.value)).toEqual([10, 0, 10]);
  });
});

describe("weekly aggregation", () => {
  it("sums into calendar weeks and conserves the total", () => {
    const days = grid("2026-08-03", 14, () => 10); // Mon Aug 3 → Sun Aug 16
    const out = aggregateRevenue(days, "weekly");
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.value)).toEqual([70, 70]);
    expect(sum(out)).toBe(sum(days));
  });

  it("labels a whole week as a range within one month", () => {
    const out = aggregateRevenue(grid("2026-08-03", 7), "weekly");
    expect(out[0]!.label).toBe("Aug 3–9");
    expect(out[0]!.fullLabel).toBe("Aug 3–9, 2026");
  });

  it("labels a week that SPANS two months with both", () => {
    // Mon Aug 31 2026 → Sun Sep 6.
    const out = aggregateRevenue(grid("2026-08-31", 7), "weekly");
    expect(out).toHaveLength(1);
    expect(out[0]!.label).toBe("Aug 31–Sep 6");
  });

  it("labels a week that spans two YEARS with both years", () => {
    // Mon Dec 28 2026 → Sun Jan 3 2027. A single year in the label would be
    // ambiguous about which end it applied to.
    const out = aggregateRevenue(grid("2026-12-28", 7), "weekly");
    expect(out).toHaveLength(1);
    expect(out[0]!.fullLabel).toContain("2026");
    expect(out[0]!.fullLabel).toContain("2027");
  });

  it("does not claim days the window never covered", () => {
    /*
      A 30-day window almost always starts mid-week. Labelling that first
      bucket from the Monday BEFORE the window began would attribute revenue to
      days that were never queried.
    */
    const out = aggregateRevenue(grid("2026-08-05", 10), "weekly"); // Wed
    expect(out[0]!.start).toBe("2026-08-05");
    expect(out[0]!.label).toBe("Aug 5–9");
    expect(out[0]!.days).toBe(5); // Wed..Sun, not 7
  });

  it("conserves the total across a partial window", () => {
    const days = grid("2026-08-05", 23, (i) => i + 1);
    expect(sum(aggregateRevenue(days, "weekly"))).toBe(sum(days));
  });
});

describe("monthly aggregation", () => {
  it("sums into calendar months and conserves the total", () => {
    const days = grid("2026-06-01", 92, () => 5); // Jun + Jul + Aug
    const out = aggregateRevenue(days, "monthly");
    expect(out.map((p) => p.label)).toEqual(["Jun", "Jul", "Aug"]);
    expect(out.map((p) => p.value)).toEqual([150, 155, 155]);
    expect(sum(out)).toBe(sum(days));
  });

  it("stays chronological across a year boundary", () => {
    // Insertion order, not a string sort — "Jan" must not sort before "Dec".
    const out = aggregateRevenue(grid("2026-12-15", 40), "monthly");
    expect(out.map((p) => p.label)).toEqual(["Dec", "Jan"]);
    expect(out.map((p) => p.fullLabel)).toEqual(["December 2026", "January 2027"]);
  });

  it("handles a leap day", () => {
    const days = grid("2028-02-01", 29, () => 1); // 2028 is a leap year
    const out = aggregateRevenue(days, "monthly");
    expect(out).toHaveLength(1);
    expect(out[0]!.value).toBe(29);
  });
});

describe("edge cases (§25)", () => {
  it("returns nothing for an empty dataset", () => {
    for (const g of ["daily", "weekly", "monthly"] as const) {
      expect(aggregateRevenue([], g)).toEqual([]);
    }
  });

  it("handles a one-day dataset at every granularity", () => {
    const one = grid("2026-08-20", 1, () => 42);
    for (const g of ["daily", "weekly", "monthly"] as const) {
      const out = aggregateRevenue(one, g);
      expect(out, g).toHaveLength(1);
      expect(out[0]!.value, g).toBe(42);
    }
  });

  it("never loses or invents revenue, whatever the granularity", () => {
    const days = grid("2026-07-14", 75, (i) => (i % 5) * 13.37);
    const total = sum(days);
    for (const g of ["daily", "weekly", "monthly"] as const) {
      expect(sum(aggregateRevenue(days, g)), g).toBeCloseTo(total, 6);
    }
  });
});

describe("X-axis label thinning (§5)", () => {
  it("labels everything when it all fits", () => {
    expect(axisLabelIndices(5, 7)).toEqual(new Set([0, 1, 2, 3, 4]));
  });

  it("thins to at most the requested count", () => {
    const out = axisLabelIndices(30, 7);
    expect(out.size).toBeLessThanOrEqual(7);
  });

  it("always labels the first and last point", () => {
    // An axis whose ends are unlabelled does not say what range you are seeing.
    const out = axisLabelIndices(30, 7);
    expect(out.has(0)).toBe(true);
    expect(out.has(29)).toBe(true);
  });

  it("copes with a single point", () => {
    expect(axisLabelIndices(1, 7)).toEqual(new Set([0]));
    expect(axisLabelIndices(0, 7)).toEqual(new Set());
  });
});

describe("Y-axis scale (§6)", () => {
  it("snaps to clean 1/2/5 steps rather than raw fractions", () => {
    // The spec's own counter-example: 1,337.482 / 2,674.964 / 4,012.446.
    const { top, ticks } = axisScale([1337.482, 900, 120]);
    expect(top).toBe(1500);
    expect(ticks).toEqual([0, 500, 1000, 1500]);
  });

  it("always starts at zero", () => {
    // An area chart off a non-zero baseline exaggerates every change.
    expect(axisScale([980, 1000])!.ticks[0]).toBe(0);
  });

  it("covers the peak without clipping it", () => {
    for (const peak of [1, 7, 99, 1234, 98765, 0.42]) {
      const { top } = axisScale([peak]);
      expect(top, String(peak)).toBeGreaterThanOrEqual(peak);
    }
  });

  it("gives an all-zero window a readable axis", () => {
    expect(axisScale([0, 0, 0])).toEqual({ top: 1, ticks: [0, 1] });
  });

  it("handles very small and very large values", () => {
    expect(axisScale([0.004]).top).toBeGreaterThanOrEqual(0.004);
    expect(axisScale([9_400_000]).top).toBeGreaterThanOrEqual(9_400_000);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE SEARCH CONSOLE AXIS FORMAT (owner, 2026-08-25)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The owner compared our chart against two Google Search Console screenshots
 * and asked for "exactly the measurement, button style, design and calculation
 * from the image … days should show on one line, with week showing weekly not
 * daily".
 *
 * The BUCKETING already matched (Monday weeks, calendar months). What did not
 * was the axis: ours printed "Aug 3–9", which is three times the width of
 * Search Console's "8/3" and is why only the first and last tick ever fitted.
 */
describe("Search Console axis labels (§5)", () => {
  it("prints a DAY as M/D, unpadded", () => {
    const out = aggregateRevenue([{ date: "2026-08-03", value: 1 }], "daily");
    expect(out[0]!.axisLabel).toBe("8/3");
    // The verbose form survives for the tooltip — "8/3" alone cannot say
    // whether it means one day or the seven starting on it.
    expect(out[0]!.label).toBe("Aug 3");
    expect(out[0]!.fullLabel).toBe("Aug 3, 2026");
  });

  it("prints a WEEK as its START date, not a range", () => {
    // Mon 3 Aug 2026 → Sun 9 Aug.
    const days = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-08-0${3 + i}`,
      value: 1,
    }));
    const out = aggregateRevenue(days, "weekly");
    expect(out).toHaveLength(1);
    expect(out[0]!.axisLabel).toBe("8/3");
    expect(out[0]!.label).toBe("Aug 3–9");
  });

  it("🔴 a WEEKLY chart emits one point per WEEK, never one per day", () => {
    /*
      The owner's actual complaint — "with week showing weekly not daily".
      28 days must become 4 points with labels 7 days apart, which is what makes
      the weekly line read as the smooth curve in the reference rather than the
      jagged daily one.
    */
    const days = Array.from({ length: 28 }, (_, i) => ({
      date: `2026-08-${String(3 + i).padStart(2, "0")}`,
      value: 1,
    }));
    const weekly = aggregateRevenue(days, "weekly");
    expect(weekly).toHaveLength(4);
    expect(weekly.map((p) => p.axisLabel)).toEqual(["8/3", "8/10", "8/17", "8/24"]);
    // Every bucket is a FULL week, and the total is conserved.
    expect(weekly.every((p) => p.days === 7)).toBe(true);
    expect(weekly.reduce((n, p) => n + p.value, 0)).toBe(28);
  });

  it("a MONTHLY chart emits one point per month", () => {
    const days = [
      ...Array.from({ length: 31 }, (_, i) => ({ date: `2026-07-${String(i + 1).padStart(2, "0")}`, value: 1 })),
      ...Array.from({ length: 31 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, "0")}`, value: 2 })),
    ];
    const monthly = aggregateRevenue(days, "monthly");
    expect(monthly).toHaveLength(2);
    expect(monthly.map((p) => p.axisLabel)).toEqual(["Jul", "Aug"]);
    expect(monthly.map((p) => p.value)).toEqual([31, 62]);
  });

  it("keeps the axis label SHORTER than the verbose one for days and weeks", () => {
    // The whole reason the separate field exists: axis width.
    const days = Array.from({ length: 7 }, (_, i) => ({ date: `2026-08-0${3 + i}`, value: 1 }));
    const weekly = aggregateRevenue(days, "weekly")[0]!;
    expect(weekly.axisLabel.length).toBeLessThan(weekly.label.length);
  });
});
