import { describe, expect, it } from "vitest";

import { shouldTreatAsSlowConnection } from "./use-network-status";

describe("shouldTreatAsSlowConnection", () => {
  it("treats no Network Information API support as not slow (no signal to act on)", () => {
    expect(shouldTreatAsSlowConnection(undefined)).toBe(false);
  });

  it("treats data saver as slow regardless of effectiveType", () => {
    expect(shouldTreatAsSlowConnection({ saveData: true, effectiveType: "4g" })).toBe(true);
  });

  it("treats slow-2g and 2g as slow", () => {
    expect(shouldTreatAsSlowConnection({ effectiveType: "slow-2g" })).toBe(true);
    expect(shouldTreatAsSlowConnection({ effectiveType: "2g" })).toBe(true);
  });

  it("treats 3g and 4g as not slow", () => {
    expect(shouldTreatAsSlowConnection({ effectiveType: "3g" })).toBe(false);
    expect(shouldTreatAsSlowConnection({ effectiveType: "4g" })).toBe(false);
  });

  it("treats an empty connection object as not slow", () => {
    expect(shouldTreatAsSlowConnection({})).toBe(false);
  });
});
