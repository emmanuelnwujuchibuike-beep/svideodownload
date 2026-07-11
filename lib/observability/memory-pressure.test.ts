import { describe, expect, it } from "vitest";

import { shouldFlagMemoryPressure } from "./memory-pressure";

describe("shouldFlagMemoryPressure", () => {
  it("returns false when the Memory API is unavailable", () => {
    expect(shouldFlagMemoryPressure(undefined)).toBe(false);
  });

  it("returns false when jsHeapSizeLimit is zero (malformed/unsupported reading)", () => {
    expect(shouldFlagMemoryPressure({ usedJSHeapSize: 100, jsHeapSizeLimit: 0 })).toBe(false);
  });

  it("returns false comfortably under the threshold", () => {
    expect(shouldFlagMemoryPressure({ usedJSHeapSize: 50, jsHeapSizeLimit: 100 })).toBe(false);
  });

  it("returns true once usage crosses 85% of the heap limit", () => {
    expect(shouldFlagMemoryPressure({ usedJSHeapSize: 86, jsHeapSizeLimit: 100 })).toBe(true);
  });

  it("treats exactly 85% as not yet under pressure (strictly greater-than)", () => {
    expect(shouldFlagMemoryPressure({ usedJSHeapSize: 85, jsHeapSizeLimit: 100 })).toBe(false);
  });
});
