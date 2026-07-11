import { describe, expect, it } from "vitest";

import { isStorageHealthy } from "./diagnostics";

describe("isStorageHealthy", () => {
  it("treats a zero quota (no usable reading) as healthy", () => {
    expect(isStorageHealthy(0, 0)).toBe(true);
  });

  it("is healthy comfortably under 90% usage", () => {
    expect(isStorageHealthy(50, 100)).toBe(true);
  });

  it("flags unhealthy once usage crosses 90% of quota", () => {
    expect(isStorageHealthy(91, 100)).toBe(false);
  });

  it("treats exactly 90% as already unhealthy (strictly less-than 90%)", () => {
    expect(isStorageHealthy(90, 100)).toBe(false);
  });
});
