import { describe, expect, it } from "vitest";

import {
  canDesignate,
  liveTrustedCapabilities,
  MAX_TRUSTED_CONTACTS,
  TRUSTED_CAPABILITIES,
  TRUSTED_NO_ACCESS_NOTICE,
  trustedCapability,
} from "@/lib/social/graph/trusted";

describe("trusted capabilities", () => {
  it("has no duplicate keys", () => {
    const keys = TRUSTED_CAPABILITIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // The single most important assertion in Part 17: account recovery through a
  // trusted contact is an account-takeover path when it is half-built.
  it("does NOT offer account recovery", () => {
    expect(trustedCapability("recovery")!.live).toBe(false);
    expect(canDesignate("recovery")).toBe(false);
  });

  it("does not offer delegated access of any kind", () => {
    expect(canDesignate("business_delegate")).toBe(false);
    expect(canDesignate("creator_manager")).toBe(false);
  });

  it("offers only the record-keeping capabilities", () => {
    expect(liveTrustedCapabilities().map((c) => c.key).sort()).toEqual(["emergency", "legacy"]);
  });

  it("every live capability states plainly that it grants nothing", () => {
    for (const c of liveTrustedCapabilities()) {
      expect(c.grants.toLowerCase()).toContain("nothing");
    }
  });

  it("every unavailable capability states exactly what it would need", () => {
    for (const c of TRUSTED_CAPABILITIES.filter((x) => !x.live)) {
      expect(c.needs, `${c.key} is unavailable without a reason`).toBeTruthy();
      expect(c.needs!.length).toBeGreaterThan(40);
    }
  });

  it("refuses anything it does not recognise", () => {
    expect(canDesignate("admin")).toBe(false);
    expect(canDesignate("")).toBe(false);
    expect(trustedCapability("nope")).toBeUndefined();
  });

  it("keeps the list short enough to mean something", () => {
    expect(MAX_TRUSTED_CONTACTS).toBeGreaterThan(0);
    expect(MAX_TRUSTED_CONTACTS).toBeLessThanOrEqual(10);
  });

  it("exports the no-access notice so the copy cannot drift from the guarantee", () => {
    expect(TRUSTED_NO_ACCESS_NOTICE.toLowerCase()).toContain("no access");
  });
});
