import { describe, expect, it } from "vitest";

import { FOLLOWS_PER_DAY, FOLLOWS_PER_DAY_NEW, FOLLOWS_PER_HOUR, followAllowance, followDecision, followerFlow, sourceBreakdown } from "./follow-policy";

const stranger = { isFriend: false, mutualFriends: 0, verified: false };

describe("who may follow you (Feature 19 · Part 3)", () => {
  it("everyone (the default, today's behaviour) and an unknown value both mean follow", () => {
    expect(followDecision("everyone", stranger)).toBe("follow");
    expect(followDecision(undefined, stranger)).toBe("follow");
    expect(followDecision("weird", stranger)).toBe("follow");
  });
  it("approval turns a stranger's follow into a request; a friend follows straight away", () => {
    expect(followDecision("approval", stranger)).toBe("request");
    expect(followDecision("approval", { ...stranger, isFriend: true })).toBe("follow");
  });
  it("teeth: the narrow policies refuse exactly who they exclude, and nobody means nobody", () => {
    expect(followDecision("friends", stranger)).toBe("refuse");
    expect(followDecision("verified", stranger)).toBe("refuse");
    expect(followDecision("verified", { ...stranger, verified: true })).toBe("follow");
    expect(followDecision("friends_of_friends", stranger)).toBe("refuse");
    expect(followDecision("friends_of_friends", { ...stranger, mutualFriends: 2 })).toBe("follow");
    expect(followDecision("nobody", { isFriend: true, mutualFriends: 9, verified: true })).toBe("refuse");
  });
});

describe("anti-automation", () => {
  it("ordinary following passes; bursts and mass-following stop", () => {
    expect(followAllowance({ accountAgeDays: 100, followsLastHour: 5, followsLastDay: 30 })).toEqual({ ok: true });
    expect(followAllowance({ accountAgeDays: 100, followsLastHour: FOLLOWS_PER_HOUR, followsLastDay: 60 })).toEqual({ ok: false, reason: "hourly" });
    expect(followAllowance({ accountAgeDays: 100, followsLastHour: 0, followsLastDay: FOLLOWS_PER_DAY })).toEqual({ ok: false, reason: "daily" });
  });
  it("teeth: a brand-new account gets the smaller daily allowance", () => {
    expect(followAllowance({ accountAgeDays: 2, followsLastHour: 0, followsLastDay: FOLLOWS_PER_DAY_NEW })).toEqual({ ok: false, reason: "daily" });
    expect(followAllowance({ accountAgeDays: 30, followsLastHour: 0, followsLastDay: FOLLOWS_PER_DAY_NEW })).toEqual({ ok: true });
  });
});

describe("Audience Intelligence: counts, never who", () => {
  it("follower flow sums the window and nets out", () => {
    const rows = [
      { day: "2026-10-10", gained: 5, lost: 1 },
      { day: "2026-10-05", gained: 3, lost: 2 },
      { day: "2026-09-01", gained: 100, lost: 0 },
    ];
    expect(followerFlow(rows, 7, "2026-10-10")).toEqual({ gained: 8, lost: 3, net: 5 });
    expect(followerFlow(rows, 1, "2026-10-10")).toEqual({ gained: 5, lost: 1, net: 4 });
  });
  it("teeth: a source too small to be anonymous is not shown on its own", () => {
    const b = sourceBreakdown({ profile: 40, search: 10, qr: 2, junk: 50 });
    expect(b.map((x) => x.source)).toEqual(["profile", "search"]);
    expect(b[0]!.share).toBeCloseTo(40 / 102);
    expect(sourceBreakdown({})).toEqual([]);
  });
});
