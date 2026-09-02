import { describe, expect, it } from "vitest";

import {
  buildRetentionCurve,
  hourHistogram,
  MIN_DROPOFF_SAMPLE,
  peakHour,
  retentionPath,
  type WatchSample,
} from "@/lib/creator/retention";

/** n watches that each reached exactly `completion` of the video. */
function watches(n: number, completion: number, durationMs = 10_000): WatchSample[] {
  return Array.from({ length: n }, () => ({ watchMs: completion * durationMs, durationMs }));
}

describe("buildRetentionCurve", () => {
  it("returns an empty curve with no samples", () => {
    const c = buildRetentionCurve([]);
    expect(c.points).toEqual([]);
    expect(c.sampleSize).toBe(0);
    expect(c.dropOff).toBeNull();
  });

  it("counts a sample with no reported duration as unusable rather than 0%", () => {
    const c = buildRetentionCurve([
      { watchMs: 5_000, durationMs: 0 },
      { watchMs: 5_000, durationMs: 10_000 },
    ]);
    expect(c.unusable).toBe(1);
    expect(c.sampleSize).toBe(1);
    // The usable watch reached half, so average completion is 0.5 — NOT 0.25,
    // which is what averaging the dropped row in as a zero would produce.
    expect(c.averageCompletion).toBe(0.5);
  });

  it("anchors the curve at 1 — every watch reached the start", () => {
    const c = buildRetentionCurve(watches(30, 0.3));
    expect(c.points[0]).toEqual({ at: 0, reached: 1 });
    expect(c.points).toHaveLength(11);
  });

  it("is a survival function: the share reaching each decile never rises", () => {
    const c = buildRetentionCurve([
      ...watches(10, 0.15),
      ...watches(10, 0.55),
      ...watches(10, 1),
    ]);
    for (let i = 1; i < c.points.length; i += 1) {
      expect(c.points[i]!.reached).toBeLessThanOrEqual(c.points[i - 1]!.reached);
    }
  });

  it("measures the share reaching a given decile", () => {
    // 20 watches: 10 stopped at 20%, 10 watched to the end.
    const c = buildRetentionCurve([...watches(10, 0.2), ...watches(10, 1)]);
    expect(c.points.find((p) => p.at === 0.2)!.reached).toBe(1);
    expect(c.points.find((p) => p.at === 0.3)!.reached).toBe(0.5);
    expect(c.points.find((p) => p.at === 1)!.reached).toBe(0.5);
  });

  it("clamps a playhead that overshot the duration to a completed watch", () => {
    const c = buildRetentionCurve([{ watchMs: 13_000, durationMs: 10_000 }]);
    expect(c.averageCompletion).toBe(1);
    expect(c.completionRate).toBe(1);
  });

  it("treats 95% as finished, since a pause fires a hair before the last frame", () => {
    const c = buildRetentionCurve(watches(10, 0.96));
    expect(c.completionRate).toBe(1);
  });

  it("refuses to name a drop-off point below the minimum sample", () => {
    const small = buildRetentionCurve([
      ...watches(MIN_DROPOFF_SAMPLE - 6, 0.1),
      ...watches(5, 1),
    ]);
    expect(small.sampleSize).toBeLessThan(MIN_DROPOFF_SAMPLE);
    expect(small.dropOff).toBeNull();
  });

  it("names the steepest fall once the sample is big enough", () => {
    // 40 watches, 30 of which give up between 30% and 40%.
    const c = buildRetentionCurve([...watches(30, 0.35), ...watches(10, 1)]);
    expect(c.sampleSize).toBe(40);
    expect(c.dropOff).not.toBeNull();
    expect(c.dropOff!.at).toBe(0.4);
    expect(c.dropOff!.lost).toBeCloseTo(0.75, 5);
  });

  it("reports no drop-off when every viewer finishes", () => {
    const c = buildRetentionCurve(watches(40, 1));
    expect(c.completionRate).toBe(1);
    expect(c.dropOff).toBeNull();
  });
});

describe("retentionPath", () => {
  it("is empty for an empty curve", () => {
    expect(retentionPath(buildRetentionCurve([]), 100, 40)).toBe("");
  });

  it("starts top-left and runs the full width", () => {
    const path = retentionPath(buildRetentionCurve(watches(10, 1)), 100, 40);
    expect(path.startsWith("M0.00,0.00")).toBe(true);
    expect(path.endsWith("L100.00,0.00")).toBe(true);
  });

  it("puts a total drop-off at the bottom of the box", () => {
    // Everyone leaves immediately: reached is 0 from the first decile on.
    const path = retentionPath(buildRetentionCurve(watches(10, 0.01)), 100, 40);
    expect(path).toContain("L10.00,40.00");
  });
});

describe("hourHistogram / peakHour", () => {
  it("buckets by hour and ignores impossible values", () => {
    const b = hourHistogram([9, 9, 9, 14, 25, -1, 3.5]);
    expect(b).toHaveLength(24);
    expect(b[9]).toBe(3);
    expect(b[14]).toBe(1);
    expect(b.reduce((a, c) => a + c, 0)).toBe(4);
  });

  it("finds the busiest hour", () => {
    expect(peakHour(hourHistogram([1, 1, 1, 20, 20]))).toBe(1);
  });

  it("returns null when nothing has been watched", () => {
    expect(peakHour(hourHistogram([]))).toBeNull();
  });

  it("breaks ties toward the earlier hour, so a suggestion is stable", () => {
    expect(peakHour(hourHistogram([2, 2, 18, 18]))).toBe(2);
  });
});
