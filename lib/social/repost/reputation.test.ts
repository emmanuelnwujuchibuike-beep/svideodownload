import { describe, expect, it } from "vitest";

import { bandLabel, recommendationReputation, type ReputationInput } from "@/lib/social/repost/reputation";

const input = (over: Partial<ReputationInput> = {}): ReputationInput => ({
  reposts: 20,
  impressions: 1000,
  opens: 100,
  positiveEngagements: 20,
  chainReposts: 2,
  creatorFollows: 1,
  distinctCreators: 10,
  ...over,
});

describe("recommendationReputation", () => {
  it("🔴 returns a NEUTRAL score below the confidence floor, never a bad one", () => {
    // Two reposts is not evidence. Telling a new member they are a weak
    // recommender on that basis is the app inventing a verdict.
    const r = recommendationReputation(input({ reposts: 2, impressions: 5 }));
    expect(r.band).toBe("new");
    expect(r.confident).toBe(false);
    expect(r.score).toBe(50); // maps to ~1.0× in ranking — not a penalty
  });

  it("🔴 rewards quality per recommendation, not volume", () => {
    // The headline rule. A score that rewarded totals would be a leaderboard
    // for exactly the behaviour antispam.ts exists to suppress.
    const careful = recommendationReputation(
      input({ reposts: 10, impressions: 500, opens: 120, positiveEngagements: 50, chainReposts: 3, distinctCreators: 8 }),
    );
    const prolific = recommendationReputation(
      input({ reposts: 500, impressions: 25_000, opens: 400, positiveEngagements: 40, chainReposts: 5, distinctCreators: 8 }),
    );
    expect(careful.score).toBeGreaterThan(prolific.score);
  });

  it("stays within 0–100 at both extremes", () => {
    const zero = recommendationReputation(
      input({ opens: 0, positiveEngagements: 0, chainReposts: 0, creatorFollows: 0, distinctCreators: 1 }),
    );
    const max = recommendationReputation(
      input({ reposts: 50, impressions: 100, opens: 100, positiveEngagements: 100, chainReposts: 50, creatorFollows: 50, distinctCreators: 50 }),
    );
    expect(zero.score).toBeGreaterThanOrEqual(0);
    expect(max.score).toBeLessThanOrEqual(100);
    expect(max.band).toBe("exceptional");
  });

  it("🔴 does not reward recommending one creator over and over", () => {
    // Loyalty is not discovery, and the breadth term is what stops the score
    // treating them as the same thing.
    const narrow = recommendationReputation(input({ distinctCreators: 1 }));
    const broad = recommendationReputation(input({ distinctCreators: 20 }));
    expect(broad.score).toBeGreaterThan(narrow.score);
  });

  it("counts an onward repost more than an open", () => {
    const opened = recommendationReputation(input({ opens: 150, chainReposts: 0 }));
    const travelled = recommendationReputation(input({ opens: 100, chainReposts: 6 }));
    expect(travelled.score).toBeGreaterThan(opened.score);
  });

  it("never returns an empty explanation", () => {
    for (const r of [
      recommendationReputation(input()),
      recommendationReputation(input({ opens: 0, positiveEngagements: 0, chainReposts: 0, creatorFollows: 0, distinctCreators: 1 })),
      recommendationReputation(input({ reposts: 1, impressions: 1 })),
    ]) {
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });

  it("labels every band", () => {
    for (const b of ["new", "emerging", "trusted", "exceptional"] as const) {
      expect(bandLabel(b).length).toBeGreaterThan(0);
    }
  });
});
