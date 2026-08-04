import { describe, expect, it } from "vitest";

import {
  bandLabel,
  relationshipStrength,
  shouldSuggestReconnect,
  type StrengthInput,
} from "@/lib/social/graph/strength";

const base: StrengthInput = {
  isFriend: false,
  isFollowing: false,
  followsBack: false,
  isFavorite: false,
  sharedCircles: 0,
  mutualFriends: 0,
  daysSinceMessage: null,
  daysSinceViewerEngaged: null,
  daysKnown: null,
};

const input = (over: Partial<StrengthInput> = {}): StrengthInput => ({ ...base, ...over });

describe("relationshipStrength", () => {
  it("stays within 0–100", () => {
    const max = relationshipStrength(
      input({
        isFriend: true,
        isFollowing: true,
        followsBack: true,
        isFavorite: true,
        sharedCircles: 9,
        mutualFriends: 900,
        daysSinceMessage: 0,
        daysSinceViewerEngaged: 0,
        daysKnown: 4000,
      }),
    );
    expect(max.score).toBeLessThanOrEqual(100);
    expect(max.score).toBeGreaterThan(80);
    expect(relationshipStrength(base).score).toBeGreaterThanOrEqual(0);
  });

  // The whole discipline of this module, in one test.
  it("returns `unknown` — not `quiet` — when nothing has happened yet", () => {
    const fresh = relationshipStrength(input({ isFriend: true, daysKnown: 3 }));
    expect(fresh.band).toBe("unknown");
    expect(bandLabel(fresh.band)).toBe("New");
  });

  it("calls a long-silent friendship quiet", () => {
    const result = relationshipStrength(
      input({ isFriend: true, daysSinceMessage: 400, daysSinceViewerEngaged: null, daysKnown: 800 }),
    );
    expect(result.band).toBe("quiet");
  });

  it("ranks a talking friendship above a silent one", () => {
    const talking = relationshipStrength(input({ isFriend: true, daysSinceMessage: 2 }));
    const silent = relationshipStrength(input({ isFriend: true, daysSinceMessage: 300 }));
    expect(talking.score).toBeGreaterThan(silent.score);
    expect(talking.band).toBe("close");
  });

  it("weights a friendship far above a bare follow", () => {
    const friend = relationshipStrength(input({ isFriend: true, daysSinceMessage: 1 }));
    const follow = relationshipStrength(input({ isFollowing: true, daysSinceMessage: 1 }));
    expect(friend.score).toBeGreaterThan(follow.score);
  });

  it("saturates mutual friends so a popular account is not automatically close", () => {
    const five = relationshipStrength(input({ isFriend: true, mutualFriends: 5, daysSinceMessage: 1 }));
    const fiveHundred = relationshipStrength(input({ isFriend: true, mutualFriends: 500, daysSinceMessage: 1 }));
    expect(fiveHundred.score - five.score).toBeLessThanOrEqual(6);
  });

  it("decays with the age of the last contact", () => {
    const scores = [3, 30, 90, 400].map(
      (d) => relationshipStrength(input({ isFriend: true, daysSinceMessage: d })).score,
    );
    for (let i = 1; i < scores.length; i += 1) expect(scores[i]).toBeLessThan(scores[i - 1]!);
  });

  it("only reports reasons the viewer already knows", () => {
    const result = relationshipStrength(
      input({ isFriend: true, isFavorite: true, sharedCircles: 2, mutualFriends: 3, daysSinceMessage: 1 }),
    );
    expect(result.reasons).toContain("You're friends");
    expect(result.reasons).toContain("You marked them a favourite");
    expect(result.reasons).toContain("In 2 of your circles");
    expect(result.reasons).toContain("3 friends in common");
    // Nothing about what the other person did.
    for (const r of result.reasons) {
      expect(r.toLowerCase()).not.toContain("they viewed");
      expect(r.toLowerCase()).not.toContain("opened");
      expect(r.toLowerCase()).not.toContain("stopped");
    }
  });

  it("names years only after a full year", () => {
    expect(relationshipStrength(input({ isFriend: true, daysKnown: 200 })).reasons).not.toContain(
      "Connected for a year",
    );
    expect(relationshipStrength(input({ isFriend: true, daysKnown: 400 })).reasons).toContain("Connected for a year");
    expect(relationshipStrength(input({ isFriend: true, daysKnown: 1100 })).reasons).toContain("Connected for 3 years");
  });
});

describe("shouldSuggestReconnect", () => {
  const rec = (over: Partial<StrengthInput> & { isSuppressed?: boolean } = {}) => ({
    ...base,
    isSuppressed: false,
    ...over,
  });

  it("suggests reconnecting with a long-quiet friend you used to talk to", () => {
    expect(shouldSuggestReconnect(rec({ isFriend: true, daysSinceMessage: 300 }))).toBe(true);
  });

  it("never suggests it for someone you have never interacted with", () => {
    expect(shouldSuggestReconnect(rec({ isFriend: true }))).toBe(false);
  });

  it("never suggests it for a non-friend", () => {
    expect(shouldSuggestReconnect(rec({ isFollowing: true, daysSinceMessage: 300 }))).toBe(false);
  });

  it("never suggests it for someone you muted, restricted or blocked", () => {
    expect(shouldSuggestReconnect(rec({ isFriend: true, daysSinceMessage: 300, isSuppressed: true }))).toBe(false);
  });

  it("does not nag about someone you spoke to recently", () => {
    expect(shouldSuggestReconnect(rec({ isFriend: true, daysSinceMessage: 3 }))).toBe(false);
  });

  it("counts a recent like as contact, even with no messages", () => {
    expect(
      shouldSuggestReconnect(rec({ isFriend: true, daysSinceMessage: null, daysSinceViewerEngaged: 10 })),
    ).toBe(false);
  });
});
