import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseSampleRate } from "@/lib/perf/sample-rate";

/**
 * Both client measurement beacons cost an invocation AND a log event per send.
 * Observability Events was the largest line on the 2026-10-05 bill, so both are
 * OFF unless an operator sets the switch — never a hard-coded standing rate.
 */
const read = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("measurement beacons are off unless switched on", () => {
  it("the parser is off for unset, empty, malformed and out-of-range values", () => {
    for (const raw of [undefined, "", "x", "0", "-1", "1.01", "NaN", "Infinity"]) expect(parseSampleRate(raw), String(raw)).toBe(0);
    expect(parseSampleRate("0.1")).toBe(0.1);
    expect(parseSampleRate("1")).toBe(1);
  });

  it("playback metrics read the switch, and a zero rate can never sample", () => {
    const src = read("features/media/use-adaptive-source.ts");
    expect(src).toMatch(/const METRICS_SAMPLE = parseSampleRate\(process\.env\.NEXT_PUBLIC_PLAYBACK_METRICS_SAMPLE\);/);
    expect(src).toMatch(/const sampled = METRICS_SAMPLE > 0 && Math\.random\(\) < METRICS_SAMPLE;/);
    // No hard-coded rate left behind.
    expect(src).not.toMatch(/METRICS_SAMPLE = 0?\.\d+/);
  });

  it("web vitals read their switch through the same parser", () => {
    const src = read("features/perf/web-vitals.tsx");
    expect(src).toMatch(/return parseSampleRate\(raw\);/);
    expect(src).toMatch(/vitalsSampleRate\(process\.env\.NEXT_PUBLIC_VITALS_SAMPLE\)/);
  });
});
