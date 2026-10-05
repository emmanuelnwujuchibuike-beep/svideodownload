import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { vitalsSampleRate } from "@/features/perf/web-vitals";

/**
 * The vitals beacon is a per-pageview billing tap (an edge invocation plus a
 * `console.log` Observability event each). It must cost NOTHING unless an
 * operator turns it on, and when on it must be decided per page view — the
 * old code sampled per METRIC, ~5 per page, ≈0.75 beacons per page view.
 */
describe("web vitals beacon — off unless switched on", () => {
  it("is off when the switch is unset, empty, malformed or out of range", () => {
    for (const raw of [undefined, "", "abc", "0", "-0.1", "1.5", "NaN", "Infinity"]) {
      expect(vitalsSampleRate(raw), String(raw)).toBe(0);
    }
  });

  it("honours a valid share of page views", () => {
    expect(vitalsSampleRate("0.05")).toBe(0.05);
    expect(vitalsSampleRate("1")).toBe(1);
  });

  it("decides ONCE per document, and every send path checks that decision", () => {
    const src = readFileSync(join(process.cwd(), "features/perf/web-vitals.tsx"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // No per-call coin flip left anywhere in the reporter.
    expect(code.match(/Math\.random\(\)/g) ?? []).toHaveLength(1);
    expect(code).toMatch(/^const SAMPLED = SAMPLE_RATE > 0 && Math\.random\(\) < SAMPLE_RATE;$/m);
    // Both senders are gated: the metric callback and the launch beacon.
    expect(code).toMatch(/if \(!SAMPLED\) return;/);
    expect(code).toMatch(/&& SAMPLED\) beaconLaunchTiming\(\)/);
  });

});
