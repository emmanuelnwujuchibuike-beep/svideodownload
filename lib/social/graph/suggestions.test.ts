import { describe, expect, it } from "vitest";

import {
  isEligible,
  rankSuggestions,
  reasonFor,
  scoreSuggestion,
  type SuggestionCandidate,
} from "@/lib/social/graph/suggestions";

const VIEWER = { viewerId: "viewer-1" };

const base: SuggestionCandidate = {
  id: "candidate-1",
  mutualFriends: 0,
  mutualsDisclosable: false,
  optedOut: false,
  isSuspended: false,
  isHidden: false,
  blockedEitherWay: false,
  suppressedByViewer: false,
  alreadyFriend: false,
  alreadyFollowing: false,
  requestPending: false,
  sameLocation: false,
  sharedCircles: 0,
  followers: 10,
  accountAgeDays: 400,
};

const cand = (over: Partial<SuggestionCandidate> = {}): SuggestionCandidate => ({ ...base, ...over });

describe("eligibility", () => {
  it("accepts an ordinary candidate", () => {
    expect(isEligible(cand(), VIEWER)).toBe(true);
  });

  it("never suggests the viewer to themselves", () => {
    expect(isEligible(cand({ id: "viewer-1" }), VIEWER)).toBe(false);
  });

  it.each([
    ["a block in either direction", { blockedEitherWay: true }],
    ["someone the viewer muted or restricted", { suppressedByViewer: true }],
    ["a suspended account", { isSuspended: true }],
    ["a hidden (friends-only) account", { isHidden: true }],
    ["someone who opted out of recommendations", { optedOut: true }],
    ["an existing friend", { alreadyFriend: true }],
    ["a pending request", { requestPending: true }],
  ])("refuses %s", (_label, over) => {
    expect(isEligible(cand(over), VIEWER)).toBe(false);
  });

  it("still suggests someone the viewer merely follows", () => {
    expect(isEligible(cand({ alreadyFollowing: true }), VIEWER)).toBe(true);
  });
});

describe("scoring", () => {
  it("rewards mutual friends most", () => {
    expect(scoreSuggestion(cand({ mutualFriends: 10 }))).toBeGreaterThan(scoreSuggestion(cand({ sameLocation: true })));
  });

  it("saturates so one huge overlap cannot dominate the list", () => {
    const ten = scoreSuggestion(cand({ mutualFriends: 10 }));
    const thousand = scoreSuggestion(cand({ mutualFriends: 1000 }));
    expect(thousand - ten).toBeLessThan(50);
  });

  it("caps popularity so the same big accounts are not shown to everyone", () => {
    const small = scoreSuggestion(cand({ followers: 10 }));
    const huge = scoreSuggestion(cand({ followers: 10_000_000 }));
    expect(huge - small).toBeLessThanOrEqual(8);
  });

  it("penalises brand-new accounts", () => {
    expect(scoreSuggestion(cand({ accountAgeDays: 1, mutualFriends: 3 }))).toBeLessThan(
      scoreSuggestion(cand({ accountAgeDays: 400, mutualFriends: 3 })),
    );
  });

  it("never goes negative", () => {
    expect(scoreSuggestion(cand({ accountAgeDays: 0, followers: 0 }))).toBeGreaterThanOrEqual(0);
  });
});

describe("reasons — the mutual-friend disclosure", () => {
  it("counts mutuals out loud only when that is permitted", () => {
    expect(reasonFor(cand({ mutualFriends: 4, mutualsDisclosable: true }))).toEqual({
      reason: "4 friends in common",
      disclosesMutual: true,
    });
  });

  it("never counts them when the mutual's own list is not public", () => {
    const result = reasonFor(cand({ mutualFriends: 4, mutualsDisclosable: false }));
    expect(result.disclosesMutual).toBe(false);
    expect(result.reason).not.toMatch(/\d/);
    expect(result.reason.toLowerCase()).not.toContain("common");
  });

  it("still ranks on mutuals even when it cannot say so", () => {
    const quiet = cand({ mutualFriends: 12, mutualsDisclosable: false });
    const none = cand({ mutualFriends: 0, mutualsDisclosable: true });
    expect(scoreSuggestion(quiet)).toBeGreaterThan(scoreSuggestion(none));
    expect(reasonFor(quiet).disclosesMutual).toBe(false);
  });

  it("falls back to reasons the viewer already knows", () => {
    expect(reasonFor(cand({ sharedCircles: 1 })).reason).toBe("Already in one of your circles");
    expect(reasonFor(cand({ alreadyFollowing: true })).reason).toBe("You follow them");
    expect(reasonFor(cand({ sameLocation: true })).reason).toBe("Near you");
    expect(reasonFor(cand()).reason).toBe("Suggested for you");
  });

  it("uses the singular for one mutual", () => {
    expect(reasonFor(cand({ mutualFriends: 1, mutualsDisclosable: true })).reason).toBe("1 friend in common");
  });
});

describe("rankSuggestions", () => {
  it("drops the ineligible, sorts by score and caps the list", () => {
    const ranked = rankSuggestions(
      [
        cand({ id: "a", mutualFriends: 1 }),
        cand({ id: "b", mutualFriends: 20 }),
        cand({ id: "blocked", mutualFriends: 99, blockedEitherWay: true }),
        cand({ id: "c", mutualFriends: 6 }),
      ],
      VIEWER,
      2,
    );
    expect(ranked.map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("is deterministic when scores tie", () => {
    const list = [cand({ id: "zeta" }), cand({ id: "alpha" })];
    expect(rankSuggestions(list, VIEWER).map((r) => r.id)).toEqual(["alpha", "zeta"]);
  });

  it("returns nothing for an empty or fully ineligible list", () => {
    expect(rankSuggestions([], VIEWER)).toEqual([]);
    expect(rankSuggestions([cand({ optedOut: true })], VIEWER)).toEqual([]);
  });
});
