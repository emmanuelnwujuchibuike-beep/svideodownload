import { describe, expect, it } from "vitest";

import {
  BAND_LABEL,
  computeProfileHealth,
  PLANNED_INTELLIGENCE,
  scoreBand,
  type HealthSignals,
} from "@/lib/profile/health";

/** A brand-new account: nothing set up, nothing published. */
const EMPTY: HealthSignals = {
  hasHandle: false,
  hasDisplayName: false,
  hasAvatar: false,
  hasBio: false,
  hasBanner: false,
  hasLinks: false,
  profileTypeDeclared: false,
  hasHeadline: false,
  emailConfirmed: false,
  mfaEnabled: false,
  passkeyCount: 0,
  hasRecoveryCodes: false,
  hasPin: false,
  privacyReviewed: false,
  activityScoped: false,
  blockedOrMutedAnyone: false,
  posts: 0,
  collections: 0,
  filledModules: 0,
  friends: 0,
  following: 0,
  verified: false,
  trustIndex: 0,
  accountAgeDays: 0,
  suspended: false,
};

/** A well-run account: everything a member can control, done. */
const IDEAL: HealthSignals = {
  hasHandle: true,
  hasDisplayName: true,
  hasAvatar: true,
  hasBio: true,
  hasBanner: true,
  hasLinks: true,
  profileTypeDeclared: true,
  hasHeadline: true,
  emailConfirmed: true,
  mfaEnabled: true,
  passkeyCount: 2,
  hasRecoveryCodes: true,
  hasPin: true,
  privacyReviewed: true,
  activityScoped: true,
  blockedOrMutedAnyone: true,
  posts: 20,
  collections: 4,
  filledModules: 6,
  friends: 12,
  following: 30,
  verified: true,
  trustIndex: 95,
  accountAgeDays: 800,
  suspended: false,
};

describe("computeProfileHealth", () => {
  it("scores an empty account low and a well-run one high", () => {
    expect(computeProfileHealth(EMPTY).score).toBeLessThan(20);
    expect(computeProfileHealth(IDEAL).score).toBeGreaterThanOrEqual(95);
  });

  it("keeps the score inside 0–100 for both extremes", () => {
    for (const s of [EMPTY, IDEAL]) {
      const { score, pillars } = computeProfileHealth(s);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      for (const p of pillars) {
        expect(p.score, `${p.key} out of range`).toBeGreaterThanOrEqual(0);
        expect(p.score, `${p.key} out of range`).toBeLessThanOrEqual(100);
      }
    }
  });

  it("weights sum to 100, so the total is a real weighted average", () => {
    const total = computeProfileHealth(EMPTY).pillars.reduce((sum, p) => sum + p.weight, 0);
    expect(total).toBe(100);
  });

  it("is monotonic — doing something good never lowers the score", () => {
    const base = computeProfileHealth(EMPTY).score;
    const improvements: Partial<HealthSignals>[] = [
      { emailConfirmed: true },
      { mfaEnabled: true },
      { passkeyCount: 1 },
      { hasAvatar: true },
      { hasBio: true },
      { posts: 3 },
      { friends: 4 },
      { verified: true },
      { privacyReviewed: true },
    ];
    for (const change of improvements) {
      const after = computeProfileHealth({ ...EMPTY, ...change }).score;
      expect(after, `${JSON.stringify(change)} lowered the score`).toBeGreaterThanOrEqual(base);
    }
  });

  it("never scores reach — a big following can't buy a healthy profile", () => {
    // Followers and engagement are deliberately not signals at all; the closest
    // thing (community) is capped and small.
    const popular = computeProfileHealth({ ...EMPTY, following: 100000, friends: 100000 });
    expect(popular.score).toBeLessThan(30);
  });

  it("zeroes standing for a suspended account", () => {
    const health = computeProfileHealth({ ...IDEAL, suspended: true });
    expect(health.pillars.find((p) => p.key === "standing")!.score).toBe(0);
  });

  it("gives partial credit rather than all-or-nothing", () => {
    const half = computeProfileHealth({ ...EMPTY, hasHandle: true, hasDisplayName: true, hasAvatar: true });
    const identity = half.pillars.find((p) => p.key === "identity")!.score;
    expect(identity).toBeGreaterThan(0);
    expect(identity).toBeLessThan(100);
  });
});

describe("digital coach recommendations", () => {
  it("tells an empty account to secure itself before decorating it", () => {
    const recs = computeProfileHealth(EMPTY).recommendations;
    const ids = recs.map((r) => r.id);
    expect(ids).toContain("confirm-email");
    expect(ids).toContain("enable-mfa");
    // Security must outrank cosmetics.
    expect(ids.indexOf("enable-mfa")).toBeLessThan(ids.indexOf("add-banner"));
  });

  it("is sorted by priority, highest first", () => {
    const recs = computeProfileHealth(EMPTY).recommendations;
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i - 1]!.priority).toBeGreaterThanOrEqual(recs[i]!.priority);
    }
  });

  it("says nothing to an account that has already done everything", () => {
    expect(computeProfileHealth(IDEAL).recommendations).toHaveLength(0);
  });

  it("never repeats a recommendation id", () => {
    for (const s of [EMPTY, IDEAL, { ...EMPTY, mfaEnabled: true, posts: 5 }]) {
      const ids = computeProfileHealth(s).recommendations.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("only ever advises what is actually untrue of the profile", () => {
    const withAvatar = computeProfileHealth({ ...EMPTY, hasAvatar: true });
    expect(withAvatar.recommendations.map((r) => r.id)).not.toContain("add-avatar");
  });

  it("asks for recovery codes only once two-factor is actually on", () => {
    expect(computeProfileHealth(EMPTY).recommendations.map((r) => r.id)).not.toContain("recovery-codes");
    expect(
      computeProfileHealth({ ...EMPTY, mfaEnabled: true }).recommendations.map((r) => r.id),
    ).toContain("recovery-codes");
  });

  it("suggests verification only to an account that could plausibly get it", () => {
    expect(computeProfileHealth(EMPTY).recommendations.map((r) => r.id)).not.toContain("apply-verification");
    const eligible = computeProfileHealth({ ...EMPTY, trustIndex: 70, accountAgeDays: 60 });
    expect(eligible.recommendations.map((r) => r.id)).toContain("apply-verification");
  });

  it("every recommendation links somewhere real and explains itself", () => {
    for (const s of [EMPTY, { ...EMPTY, mfaEnabled: true, posts: 5, profileTypeDeclared: true }]) {
      for (const r of computeProfileHealth(s).recommendations) {
        expect(r.href.startsWith("/"), `${r.id} has a non-app link`).toBe(true);
        expect(r.detail.length, `${r.id} gives no reason`).toBeGreaterThan(20);
        expect(r.title.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("strengths", () => {
  it("credits an account that has done well, capped at three", () => {
    const strengths = computeProfileHealth(IDEAL).strengths;
    expect(strengths.length).toBeGreaterThan(0);
    expect(strengths.length).toBeLessThanOrEqual(3);
  });

  it("credits an empty account with nothing rather than inventing praise", () => {
    expect(computeProfileHealth(EMPTY).strengths).toHaveLength(0);
  });
});

describe("bands", () => {
  it("maps scores to bands in ascending order", () => {
    expect(scoreBand(0)).toBe("critical");
    expect(scoreBand(40)).toBe("needs-work");
    expect(scoreBand(60)).toBe("good");
    expect(scoreBand(80)).toBe("strong");
    expect(scoreBand(100)).toBe("excellent");
  });

  it("labels every band", () => {
    for (const score of [0, 40, 60, 80, 100]) {
      expect(BAND_LABEL[scoreBand(score)]).toBeTruthy();
    }
  });
});

describe("planned intelligence", () => {
  it("every declared-but-unbuilt item says what it needs", () => {
    expect(PLANNED_INTELLIGENCE.length).toBeGreaterThan(0);
    for (const p of PLANNED_INTELLIGENCE) {
      expect(p.title).toBeTruthy();
      expect(p.needs.length, `${p.title} doesn't say what it's waiting on`).toBeGreaterThan(10);
    }
  });
});
