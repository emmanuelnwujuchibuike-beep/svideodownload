import { describe, expect, it } from "vitest";

import { LEVELS, relationshipReputation, type ReputationInput } from "./reputation";

const base: ReputationInput = { verified: false, accountAgeDays: 10, activity90: 0, friends: 0, collaborations: 0, recommendations: 0, endorsers: 0, helpfulReports: 0, moderatorOf: 0, communityMembers: 0, recognitions: 0, mentees: 0, profileType: "personal", upheldRecent: 0, upheldOlder: 0, overturnedAppeals: 0, restricted: false };
const veteran: ReputationInput = { ...base, verified: true, accountAgeDays: 1200, activity90: 30, friends: 40, collaborations: 6, recommendations: 4, endorsers: 3, moderatorOf: 1, communityMembers: 25, mentees: 3, profileType: "creator" };

describe("Relationship Reputation — trust, never popularity", () => {
  it("has no popularity input at all", () => {
    expect(Object.keys(base).some((k) => /follower|like|view|spend|money|viral|trend/i.test(k))).toBe(false);
  });
  it("never produces a number for display", () => {
    const r = relationshipReputation(veteran);
    expect(LEVELS).toContain(r.level);
    expect(JSON.stringify(r)).not.toMatch(/\b\d+\s*(xp|points|%)\b/i);
  });
  it("a new member is Emerging and is told how to grow", () => {
    const r = relationshipReputation(base);
    expect(r.level).toBe("Emerging");
    expect(r.improvements).toContain("Verify your account");
  });
  it("a long-standing, vouched-for, verified creator with roles reaches the top, with the badges explained", () => {
    const r = relationshipReputation(veteran);
    expect(r.level).toBe("Legacy");
    expect(r.badges.map((b) => b.key)).toEqual(expect.arrayContaining(["verified", "creator", "mentor", "moderator", "leader"]));
    for (const b of r.badges) expect(b.why.length).toBeGreaterThan(10);
  });
  it("an upheld report this year removes conduct badges; after twelve months it stops counting (recovery)", () => {
    const now = relationshipReputation({ ...veteran, upheldRecent: 1 });
    expect(now.badges.map((b) => b.key)).toEqual(["verified"]);
    expect(now.level).toBe("Established");
    const later = relationshipReputation({ ...veteran, upheldOlder: 1 });
    expect(later.level).toBe("Legacy");
    expect(later.recovery[0]).toContain("no longer counts");
  });
  it("a team restriction is explained and points to the Transparency Center", () => {
    const r = relationshipReputation({ ...veteran, restricted: true });
    expect(r.limited).toBe(true);
    expect(r.levelWhy).toContain("Transparency Center");
  });
});
