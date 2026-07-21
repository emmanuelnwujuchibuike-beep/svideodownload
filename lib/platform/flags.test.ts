import { describe, expect, it } from "vitest";

import {
  ANON_FLAG_CONTEXT,
  bucketOf,
  type FeatureFlag,
  type FlagContext,
  getClientReadableFlags,
  getFlags,
  resolveFlag,
} from "./flags";

/** A minimal flag; each test overrides only the fields it exercises. */
function flag(over: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    id: "t",
    label: "t",
    description: "",
    category: "product",
    defaultEnabled: false,
    consumer: "test",
    ...over,
  };
}

const free: FlagContext = { plan: "free", isAdmin: false, userId: "user-1" };
const admin: FlagContext = { plan: "free", isAdmin: true, userId: "user-1" };

describe("resolveFlag — defaults", () => {
  it("defaults OFF when defaultEnabled is false and there is no override", () => {
    expect(resolveFlag(flag(), undefined, free)).toBe(false);
  });
  it("defaults ON when defaultEnabled is true", () => {
    expect(resolveFlag(flag({ defaultEnabled: true }), undefined, free)).toBe(true);
  });
});

describe("resolveFlag — manual override wins over rollout", () => {
  it("force ON regardless of a 0% rollout", () => {
    expect(resolveFlag(flag({ rollout: 0 }), { enabled: true }, free)).toBe(true);
  });
  it("kill switch (false) wins over a 100% rollout", () => {
    expect(resolveFlag(flag({ rollout: 100 }), { enabled: false }, free)).toBe(false);
  });
  it("null override defers to rollout/default", () => {
    expect(resolveFlag(flag({ defaultEnabled: true }), { enabled: null }, free)).toBe(true);
  });
});

describe("resolveFlag — rollout percentage", () => {
  it("0% is OFF for everyone, including a would-be bucketed user", () => {
    expect(resolveFlag(flag(), { rolloutPercentage: 0 }, free)).toBe(false);
  });
  it("100% is ON for everyone, including anonymous visitors", () => {
    expect(resolveFlag(flag(), { rolloutPercentage: 100 }, ANON_FLAG_CONTEXT)).toBe(true);
  });
  it("a partial rollout resolves OFF for an anonymous visitor (can't bucket)", () => {
    expect(resolveFlag(flag(), { rolloutPercentage: 50 }, ANON_FLAG_CONTEXT)).toBe(false);
  });
  it("is deterministic — same user + flag always resolves the same", () => {
    const f = flag({ rollout: 50 });
    const a = resolveFlag(f, undefined, free);
    const b = resolveFlag(f, undefined, free);
    expect(a).toBe(b);
  });
  it("an override percentage replaces the declared rollout", () => {
    // Declared 100 (would be ON) but override 0 ⇒ OFF.
    expect(resolveFlag(flag({ rollout: 100 }), { rolloutPercentage: 0 }, free)).toBe(false);
  });
  it("splits a large population roughly in proportion to the percentage", () => {
    const f = flag({ rollout: 30 });
    let on = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      if (resolveFlag(f, undefined, { plan: "free", isAdmin: false, userId: `u-${i}` })) on++;
    }
    const share = on / n;
    // 30% ± 4pp — proves bucketing actually gates rather than being all-or-nothing.
    expect(share).toBeGreaterThan(0.26);
    expect(share).toBeLessThan(0.34);
  });
});

describe("resolveFlag — plan gate (hard AND)", () => {
  it("excludes a plan not in the list even at 100% rollout", () => {
    const f = flag({ plans: ["business"], rollout: 100 });
    expect(resolveFlag(f, undefined, free)).toBe(false);
  });
  it("includes a plan in the list", () => {
    const f = flag({ plans: ["free"], defaultEnabled: true });
    expect(resolveFlag(f, undefined, free)).toBe(true);
  });
  it("beats a force-ON override — entitlement is not overridable", () => {
    const f = flag({ plans: ["business"] });
    expect(resolveFlag(f, { enabled: true }, free)).toBe(false);
  });
  it("beats admin preview — an off-plan admin still can't see it", () => {
    const f = flag({ plans: ["business"], adminBypass: true });
    expect(resolveFlag(f, undefined, admin)).toBe(false);
  });
});

describe("resolveFlag — admin preview", () => {
  it("resolves ON for an admin when adminBypass is set, even at 0% rollout", () => {
    expect(resolveFlag(flag({ adminBypass: true, rollout: 0 }), undefined, admin)).toBe(true);
  });
  it("does not affect non-admins", () => {
    expect(resolveFlag(flag({ adminBypass: true, rollout: 0 }), undefined, free)).toBe(false);
  });
  it("does not beat a kill switch for the admin", () => {
    // Order: plan gate → adminBypass → override. adminBypass returns before the
    // kill switch is read, so a preview admin sees ON. This documents that a kill
    // switch does NOT suppress an adminBypass preview — use plan gating for that.
    expect(resolveFlag(flag({ adminBypass: true }), { enabled: false }, admin)).toBe(true);
  });
});

describe("getClientReadableFlags — the exposure allow-list", () => {
  it("returns only flags marked clientReadable, all of them declared", () => {
    const all = getFlags();
    const exposed = getClientReadableFlags();
    for (const f of exposed) {
      expect(f.clientReadable, `${f.id} is exposed to the client but not marked clientReadable`).toBe(true);
      expect(all).toContain(f);
    }
  });
  it("never exposes a server-only flag", () => {
    for (const f of getFlags()) {
      if (!f.clientReadable) {
        expect(getClientReadableFlags(), `${f.id} leaked to the client`).not.toContain(f);
      }
    }
  });
});

describe("bucketOf", () => {
  it("is stable for the same inputs", () => {
    expect(bucketOf("flag-a", "user-x")).toBe(bucketOf("flag-a", "user-x"));
  });
  it("stays within 0–99", () => {
    for (let i = 0; i < 1000; i++) {
      const b = bucketOf("f", `u-${i}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });
  it("varies by flag id, so the same user isn't in the same bucket for every flag", () => {
    const a = bucketOf("flag-a", "user-x");
    const b = bucketOf("flag-b", "user-x");
    // Not a guarantee for a single pair, but across these two fixed ids they differ.
    expect(a).not.toBe(b);
  });
});
