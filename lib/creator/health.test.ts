import { describe, expect, it } from "vitest";

import {
  computeCreatorHealth,
  creatorBand,
  CREATOR_BAND_LABEL,
  type CreatorHealthSignals,
  type CreatorPillarKey,
} from "@/lib/creator/health";

/** An established creator doing well on every axis. */
const HEALTHY: CreatorHealthSignals = {
  weeklyPosts: [3, 3, 2, 3, 3, 2, 3, 3],
  recentEngagementRate: 0.06,
  lifetimeEngagementRate: 0.05,
  replyRate: 0.8,
  commentsReceived: 120,
  followersNow: 1200,
  followers30dAgo: 1000,
  categoriesUsed: 4,
  categoriesAvailable: 14,
  totalPosts: 80,
};

/** A brand-new account with nothing to measure. */
const NEW: CreatorHealthSignals = {
  weeklyPosts: [],
  recentEngagementRate: 0,
  lifetimeEngagementRate: 0,
  replyRate: 0,
  commentsReceived: 0,
  followersNow: 0,
  followers30dAgo: null,
  categoriesUsed: 0,
  categoriesAvailable: 14,
  totalPosts: 0,
};

const pillar = (s: CreatorHealthSignals, key: CreatorPillarKey) =>
  computeCreatorHealth(s).pillars.find((p) => p.key === key)!;

describe("computeCreatorHealth", () => {
  it("scores a healthy creator well and suggests nothing", () => {
    const h = computeCreatorHealth(HEALTHY);
    expect(h.score).not.toBeNull();
    expect(h.score!).toBeGreaterThanOrEqual(70);
    expect(h.suggestions).toEqual([]);
  });

  it("always returns every pillar, scored or not", () => {
    expect(computeCreatorHealth(NEW).pillars).toHaveLength(6);
  });

  it("scores nothing at all for a brand-new account rather than scoring it zero", () => {
    const h = computeCreatorHealth(NEW);
    // A new creator is not an unhealthy creator. Every pillar must abstain.
    expect(h.pillars.every((p) => p.score === null)).toBe(true);
    expect(h.score).toBeNull();
    expect(h.band).toBeNull();
    expect(h.suggestions).toEqual([]);
  });

  it("excludes unscorable pillars from the average instead of counting them as 0", () => {
    // Consistency is perfect; everything else abstains for want of data.
    const s: CreatorHealthSignals = { ...NEW, weeklyPosts: [1, 1, 1] };
    const h = computeCreatorHealth(s);
    expect(pillar(s, "consistency").score).toBe(100);
    expect(h.score).toBe(100);
  });

  describe("consistency", () => {
    it("rewards showing up rather than volume", () => {
      const steady = { ...HEALTHY, weeklyPosts: [1, 1, 1, 1, 1, 1, 1, 1] };
      const bursty = { ...HEALTHY, weeklyPosts: [8, 0, 0, 0, 0, 0, 0, 0] };
      expect(pillar(steady, "consistency").score).toBe(100);
      expect(pillar(bursty, "consistency").score!).toBeLessThan(20);
    });
  });

  describe("satisfaction", () => {
    it("compares a creator against their own baseline, not a global one", () => {
      const holding = { ...HEALTHY, recentEngagementRate: 0.05, lifetimeEngagementRate: 0.05 };
      expect(pillar(holding, "satisfaction").score).toBe(70);
    });

    it("scores a big creator with a low absolute rate above a slipping one", () => {
      const improvingSmallRate = { ...HEALTHY, recentEngagementRate: 0.02, lifetimeEngagementRate: 0.01 };
      const slippingBigRate = { ...HEALTHY, recentEngagementRate: 0.09, lifetimeEngagementRate: 0.2 };
      expect(pillar(improvingSmallRate, "satisfaction").score!).toBeGreaterThan(
        pillar(slippingBigRate, "satisfaction").score!,
      );
    });

    it("abstains until there are enough posts for a baseline", () => {
      expect(pillar({ ...HEALTHY, totalPosts: 2 }, "satisfaction").score).toBeNull();
    });
  });

  describe("community", () => {
    it("abstains below the comment floor, where a reply rate means nothing", () => {
      expect(pillar({ ...HEALTHY, commentsReceived: 2, replyRate: 1 }, "community").score).toBeNull();
    });

    it("scores the reply rate once there are enough comments", () => {
      expect(pillar({ ...HEALTHY, commentsReceived: 40, replyRate: 0.5 }, "community").score).toBe(50);
    });
  });

  describe("growth", () => {
    it("abstains with no history, rather than reporting no growth", () => {
      const p = pillar({ ...HEALTHY, followers30dAgo: null }, "growth");
      expect(p.score).toBeNull();
      expect(p.detail).toMatch(/readings/i);
    });

    it("scores flat as neutral, not as failure", () => {
      expect(pillar({ ...HEALTHY, followersNow: 500, followers30dAgo: 500 }, "growth").score).toBe(50);
    });

    it("scores on rate, so a small creator is not ranked beneath a large one", () => {
      const small = { ...HEALTHY, followersNow: 15, followers30dAgo: 10 };
      const large = { ...HEALTHY, followersNow: 100_010, followers30dAgo: 100_000 };
      expect(pillar(small, "growth").score!).toBeGreaterThan(pillar(large, "growth").score!);
    });

    it("handles the first-ever follower without dividing by zero", () => {
      const p = pillar({ ...HEALTHY, followersNow: 3, followers30dAgo: 0 }, "growth");
      expect(Number.isFinite(p.score!)).toBe(true);
      expect(p.score!).toBeGreaterThan(50);
    });

    it("scores a decline below neutral", () => {
      expect(pillar({ ...HEALTHY, followersNow: 900, followers30dAgo: 1000 }, "growth").score!).toBeLessThan(50);
    });
  });

  describe("diversity", () => {
    it("tops out at four categories rather than rewarding all fourteen", () => {
      expect(pillar({ ...HEALTHY, categoriesUsed: 4 }, "diversity").score).toBe(100);
      expect(pillar({ ...HEALTHY, categoriesUsed: 12 }, "diversity").score).toBe(100);
    });

    it("marks a single-category creator down", () => {
      expect(pillar({ ...HEALTHY, categoriesUsed: 1 }, "diversity").score).toBe(25);
    });
  });

  describe("burnout — the pillar that can say 'do less'", () => {
    it("reads a sustainable pace as healthy", () => {
      expect(pillar(HEALTHY, "burnout").score).toBe(100);
    });

    it("penalises posting much more for much less response", () => {
      const strained: CreatorHealthSignals = {
        ...HEALTHY,
        weeklyPosts: [9, 8, 2, 2, 2, 2, 1, 2],
        recentEngagementRate: 0.02,
        lifetimeEngagementRate: 0.05,
      };
      const p = pillar(strained, "burnout");
      expect(p.score!).toBeLessThan(60);
      expect(p.detail).toMatch(/more for less/i);
    });

    it("does NOT penalise a busy spell that is still landing", () => {
      const busyAndWorking: CreatorHealthSignals = {
        ...HEALTHY,
        weeklyPosts: [6, 6, 3, 3, 3, 3, 3, 3],
        recentEngagementRate: 0.07,
        lifetimeEngagementRate: 0.05,
      };
      // Output doubled, but engagement rose — that is a good week, not burnout.
      expect(pillar(busyAndWorking, "burnout").score!).toBeGreaterThanOrEqual(75);
    });

    it("does NOT penalise a soft patch at a steady pace", () => {
      const softPatch: CreatorHealthSignals = {
        ...HEALTHY,
        weeklyPosts: [3, 3, 3, 3, 3, 3, 3, 3],
        recentEngagementRate: 0.02,
        lifetimeEngagementRate: 0.05,
      };
      expect(pillar(softPatch, "burnout").score).toBe(100);
    });

    it("tells a strained creator to slow down, and says so in those words", () => {
      const strained: CreatorHealthSignals = {
        ...HEALTHY,
        weeklyPosts: [10, 9, 2, 2, 2, 2, 2, 2],
        recentEngagementRate: 0.015,
        lifetimeEngagementRate: 0.05,
      };
      const suggestion = computeCreatorHealth(strained).suggestions.find((s) => s.pillar === "burnout");
      expect(suggestion).toBeDefined();
      expect(suggestion!.body).toMatch(/slow down|fewer/i);
    });

    it("abstains before there is a month of history", () => {
      expect(pillar({ ...HEALTHY, weeklyPosts: [3, 3] }, "burnout").score).toBeNull();
    });
  });

  describe("suggestions", () => {
    it("orders them worst pillar first", () => {
      const struggling: CreatorHealthSignals = {
        ...HEALTHY,
        weeklyPosts: [1, 0, 0, 0, 0, 0, 0, 0], // consistency ~13
        replyRate: 0.4, // community 40
        categoriesUsed: 2, // diversity 50
      };
      const s = computeCreatorHealth(struggling).suggestions;
      expect(s.length).toBeGreaterThanOrEqual(3);
      expect(s[0]!.pillar).toBe("consistency");
      expect(s.map((x) => x.pillar)).toContain("community");
    });

    it("never suggests anything for a pillar that abstained", () => {
      const h = computeCreatorHealth({ ...NEW, weeklyPosts: [0, 0, 0] });
      expect(h.suggestions.every((s) => s.pillar === "consistency")).toBe(true);
    });
  });
});

describe("creatorBand", () => {
  it("maps the range in ascending order", () => {
    expect(creatorBand(10)).toBe("at-risk");
    expect(creatorBand(40)).toBe("building");
    expect(creatorBand(60)).toBe("steady");
    expect(creatorBand(80)).toBe("strong");
    expect(creatorBand(95)).toBe("thriving");
  });

  it("labels every band", () => {
    for (const score of [0, 30, 50, 70, 85, 100]) {
      expect(CREATOR_BAND_LABEL[creatorBand(score)]).toBeTruthy();
    }
  });
});
