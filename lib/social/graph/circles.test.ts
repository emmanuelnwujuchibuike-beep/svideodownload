import { describe, expect, it } from "vitest";

import {
  CIRCLE_AUDIENCE_PREFIX,
  CIRCLE_COLORS,
  CIRCLE_PERMISSIONS,
  circleAudience,
  circleAudienceId,
  circleColorClasses,
  circlePermission,
  isCircleAudience,
  isCircleColor,
  liveCirclePermissions,
  MAX_CIRCLE_NAME_LENGTH,
  SUGGESTED_CIRCLES,
  validateCircleName,
} from "@/lib/social/graph/circles";

const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

describe("circle permissions", () => {
  it("has no duplicate keys", () => {
    const keys = CIRCLE_PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every planned permission states its blocker", () => {
    for (const p of CIRCLE_PERMISSIONS.filter((x) => !x.live)) {
      expect(p.needs, `${p.key} is planned without a reason`).toBeTruthy();
      expect(p.needs!.length).toBeGreaterThan(20);
    }
  });

  it("live permissions carry no `needs`", () => {
    for (const p of liveCirclePermissions()) expect(p.needs).toBeUndefined();
  });

  // The failure this guards: a composer audience picker that silently
  // publishes to followers.
  it("does NOT claim post or story audiences are live", () => {
    expect(circlePermission("post_audience")!.live).toBe(false);
    expect(circlePermission("story_audience")!.live).toBe(false);
  });

  it("does claim the profile-module audience, which the engine enforces", () => {
    expect(circlePermission("profile_modules")!.live).toBe(true);
  });
});

describe("circle colours", () => {
  it("accepts only palette keys", () => {
    for (const c of CIRCLE_COLORS) expect(isCircleColor(c)).toBe(true);
    expect(isCircleColor("#ff0000")).toBe(false);
    expect(isCircleColor("red; background:url(x)")).toBe(false);
    expect(isCircleColor(null)).toBe(false);
    expect(isCircleColor(123)).toBe(false);
  });

  it("falls back to the default rather than emitting attacker-controlled CSS", () => {
    const injected = circleColorClasses("blue;}body{display:none");
    expect(injected).toEqual(circleColorClasses("blue"));
    expect(JSON.stringify(injected)).not.toContain("display:none");
  });

  it("every palette key maps to classes", () => {
    for (const c of CIRCLE_COLORS) {
      const cls = circleColorClasses(c);
      expect(cls.chip).toBeTruthy();
      expect(cls.dot).toBeTruthy();
      expect(cls.ring).toBeTruthy();
    }
  });

  it("every suggested circle uses a palette colour", () => {
    for (const s of SUGGESTED_CIRCLES) expect(isCircleColor(s.color), s.name).toBe(true);
  });
});

describe("circle names", () => {
  it("accepts and tidies an ordinary name", () => {
    expect(validateCircleName("  Study   Group ")).toEqual({ ok: true, value: "Study Group" });
  });

  it("rejects an empty name", () => {
    expect(validateCircleName("").ok).toBe(false);
    expect(validateCircleName("   ").ok).toBe(false);
  });

  it("enforces the length cap", () => {
    expect(validateCircleName("x".repeat(MAX_CIRCLE_NAME_LENGTH)).ok).toBe(true);
    expect(validateCircleName("x".repeat(MAX_CIRCLE_NAME_LENGTH + 1)).ok).toBe(false);
  });

  it("rejects a duplicate regardless of case or padding", () => {
    expect(validateCircleName("family", ["Family"]).ok).toBe(false);
    expect(validateCircleName("Family", ["  family  "]).ok).toBe(false);
    expect(validateCircleName("Family", ["Work"]).ok).toBe(true);
  });
});

describe("circle audiences", () => {
  it("round-trips a uuid", () => {
    const audience = circleAudience(UUID);
    expect(audience).toBe(`${CIRCLE_AUDIENCE_PREFIX}${UUID}`);
    expect(circleAudienceId(audience)).toBe(UUID);
  });

  it("recognises the shape", () => {
    expect(isCircleAudience(circleAudience(UUID))).toBe(true);
    expect(isCircleAudience("friend")).toBe(false);
    expect(isCircleAudience(null)).toBe(false);
  });

  // A malformed audience must hide the module, never expose it.
  it("fails closed on anything that is not a uuid", () => {
    expect(circleAudienceId("circle:")).toBeNull();
    expect(circleAudienceId("circle:not-a-uuid")).toBeNull();
    expect(circleAudienceId("circle:' or 1=1 --")).toBeNull();
    expect(circleAudienceId("circle:3f2504e0-4f89-11d3-9a0c")).toBeNull();
    expect(circleAudienceId("public")).toBeNull();
    expect(circleAudienceId(null)).toBeNull();
  });
});
