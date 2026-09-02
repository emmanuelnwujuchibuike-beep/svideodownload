import { describe, expect, it } from "vitest";

import { groupSeries, type DayPoint } from "@/lib/analytics/group-series";

/** n consecutive days from `from`, each worth `value`. */
function days(from: string, n: number, value = 1): DayPoint[] {
  const [y, m, d] = from.split("-").map(Number);
  const out: DayPoint[] = [];
  for (let i = 0; i < n; i++) {
    const dt = new Date(y!, m! - 1, d! + i);
    const pad = (x: number) => String(x).padStart(2, "0");
    out.push({ date: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`, value });
  }
  return out;
}

const sum = (points: { value: number }[]) => points.reduce((s, p) => s + p.value, 0);

describe("🔴 grouping never loses or duplicates a value", () => {
  /*
    The property that matters most. A rollup that double-counts at the boundary
    or drops the edge day produces a chart that is confidently wrong, and the
    error is invisible — the shape still looks plausible.
  */
  const input = days("2026-01-01", 120, 3);

  it.each(["daily", "weekly", "monthly"] as const)("%s preserves the total", (grouping) => {
    const grouped = groupSeries(input, grouping, "2026-05-01");
    expect(sum(grouped)).toBe(sum(input));
  });

  it("every input day lands in exactly one bucket", () => {
    for (const grouping of ["weekly", "monthly"] as const) {
      const grouped = groupSeries(input, grouping, "2026-05-01");
      expect(grouped.reduce((n, b) => n + b.days, 0)).toBe(input.length);
    }
  });
});

describe("weekly — real ISO weeks, Monday to Sunday", () => {
  it("starts each bucket on a Monday", () => {
    // 2026-01-01 is a Thursday.
    const grouped = groupSeries(days("2026-01-01", 21), "weekly", "2026-03-01");
    for (const b of grouped) {
      const [y, m, d] = b.start.split("-").map(Number);
      expect(new Date(y!, m! - 1, d!).getDay(), b.start).toBe(1);
    }
  });

  it("🔴 does not drift when the window moves", () => {
    /*
      Bucketing "every 7th row from the end" gives weeks that start on a
      different weekday depending on when you look, so the same data draws a
      different chart tomorrow. Real Mondays cannot do that.
    */
    const a = groupSeries(days("2026-01-01", 30), "weekly", "2026-03-01");
    const b = groupSeries(days("2026-01-02", 29), "weekly", "2026-03-01");
    const shared = a.filter((x) => b.some((y) => y.start === x.start));
    expect(shared.length).toBeGreaterThan(2);
  });

  it("puts a Thursday and the following Sunday in the SAME week", () => {
    // 2026-01-01 Thu … 2026-01-04 Sun are one ISO week.
    const grouped = groupSeries(days("2026-01-01", 4), "weekly", "2026-03-01");
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.days).toBe(4);
  });

  it("splits across the Sunday/Monday boundary", () => {
    // 2026-01-04 is Sunday, 2026-01-05 Monday.
    const grouped = groupSeries(days("2026-01-04", 2), "weekly", "2026-03-01");
    expect(grouped).toHaveLength(2);
  });
});

describe("monthly — real calendar months", () => {
  it("splits January from February", () => {
    const grouped = groupSeries(days("2026-01-30", 3), "monthly", "2026-03-01");
    expect(grouped).toHaveLength(2);
    expect(grouped[0]!.days).toBe(2); // 30, 31
    expect(grouped[1]!.days).toBe(1); // Feb 1
  });

  it("handles a 28-day February as complete", () => {
    const grouped = groupSeries(days("2026-02-01", 28), "monthly", "2026-04-01");
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.complete).toBe(true);
  });
});

describe("🔴 a partial period is never presented as a whole one", () => {
  /*
    The current week is two days old on a Tuesday. Drawn beside seven-day weeks
    it reads as a collapse in traffic, and somebody acts on that.
  */
  it("marks the in-progress week incomplete", () => {
    // Week of Mon 2026-01-05; data through Tue 2026-01-06; today is that Tuesday.
    const grouped = groupSeries(days("2026-01-05", 2), "weekly", "2026-01-06");
    expect(grouped[0]!.complete).toBe(false);
    expect(grouped[0]!.fullLabel).toContain("partial");
  });

  it("marks a FINISHED week complete", () => {
    const grouped = groupSeries(days("2026-01-05", 7), "weekly", "2026-01-20");
    expect(grouped[0]!.complete).toBe(true);
    expect(grouped[0]!.fullLabel).not.toContain("partial");
  });

  it("🔴 marks a week with a GAP incomplete even after it has passed", () => {
    // Six of seven days present. The period is over, the data is not whole —
    // reporting it as complete would present a hole as a decline.
    const partial = days("2026-01-05", 7).filter((_, i) => i !== 3);
    const grouped = groupSeries(partial, "weekly", "2026-02-01");
    expect(grouped[0]!.days).toBe(6);
    expect(grouped[0]!.complete).toBe(false);
  });

  it("marks today's daily point incomplete and yesterday's complete", () => {
    const grouped = groupSeries(days("2026-01-05", 2), "daily", "2026-01-06");
    expect(grouped[0]!.complete).toBe(true);
    expect(grouped[1]!.complete).toBe(false);
  });
});

describe("input handling", () => {
  it("sorts scrambled input rather than drawing it scrambled", () => {
    const shuffled = [...days("2026-01-01", 5)].reverse();
    const grouped = groupSeries(shuffled, "daily", "2026-02-01");
    expect(grouped.map((g) => g.start)).toEqual(days("2026-01-01", 5).map((d) => d.date));
  });

  it("ignores malformed dates instead of producing an Invalid Date bucket", () => {
    const grouped = groupSeries([{ date: "not-a-date", value: 9 }, ...days("2026-01-01", 2)], "daily", "2026-02-01");
    expect(grouped).toHaveLength(2);
  });

  it("returns nothing for an empty series", () => {
    expect(groupSeries([], "weekly", "2026-01-01")).toEqual([]);
  });

  it("crosses a year boundary without collapsing December into January", () => {
    const grouped = groupSeries(days("2025-12-30", 4), "monthly", "2026-03-01");
    expect(grouped).toHaveLength(2);
    expect(grouped[0]!.fullLabel).toContain("2025");
    expect(grouped[1]!.fullLabel).toContain("2026");
  });
});
