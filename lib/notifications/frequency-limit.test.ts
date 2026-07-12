import { describe, expect, it } from "vitest";

import { shouldThrottleFrequency } from "./frequency-limit";

describe("shouldThrottleFrequency", () => {
  it("does not throttle under the cap", () => {
    expect(shouldThrottleFrequency(5, 30)).toBe(false);
    expect(shouldThrottleFrequency(29, 30)).toBe(false);
  });

  it("throttles at and above the cap", () => {
    expect(shouldThrottleFrequency(30, 30)).toBe(true);
    expect(shouldThrottleFrequency(100, 30)).toBe(true);
  });

  it("never throttles at zero recent pushes", () => {
    expect(shouldThrottleFrequency(0, 30)).toBe(false);
  });

  it("uses the default generous cap (30/hour) when none is given", () => {
    expect(shouldThrottleFrequency(10)).toBe(false);
    expect(shouldThrottleFrequency(30)).toBe(true);
  });
});
