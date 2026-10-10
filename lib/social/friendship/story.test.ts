import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { anniversariesReached, buildStory, friendshipHealth, friendshipInsights, HIDEABLE_KINDS, monthlyCounts, nextAnniversary, type StoryFacts } from "./story";

const NOW = new Date("2027-03-15T12:00:00Z");
const facts = (o: Partial<StoryFacts> = {}): StoryFacts => ({
  friendName: "Ada",
  friendsSince: "2026-01-31T10:00:00Z",
  request: { at: "2026-01-30T09:00:00Z", byViewer: true },
  youFollowedAt: null,
  theyFollowedAt: "2026-01-29T09:00:00Z",
  firstMessage: { at: "2026-02-01T08:00:00Z", byViewer: false },
  messageMarks: [{ n: 100, at: "2026-03-01T08:00:00Z" }],
  messageCount: 140,
  firstLikeGiven: null,
  firstLikeReceived: "2026-02-10T08:00:00Z",
  firstCommentGiven: null,
  firstCommentReceived: null,
  firstRepostGiven: null,
  firstRepostReceived: null,
  goalsDone: [{ title: "Visit Lagos", at: "2026-12-24T08:00:00Z", byViewer: false }],
  monthly: { "2027-03": 30, "2027-02": 20, "2027-01": 5, "2026-12": 4 },
  lastMessageAt: "2027-03-14T08:00:00Z",
  longestStreakDays: 12,
  ...o,
});

describe("Relationship Timeline (Part 7)", () => {
  it("tells real moments, newest first, from the viewer's side", () => {
    const ev = buildStory(facts(), NOW);
    expect(ev.map((e) => e.title)).toEqual([
      "1 year of friendship",
      "Ticked off: Visit Lagos",
      "6 months of friendship",
      "100 messages together",
      "1 month of friendship",
      "Ada first liked your post",
      "Your first conversation",
      "You became friends",
      "You sent Ada a friend request",
      "Ada followed you",
    ]);
    expect(ev.find((e) => e.kind === "first_message")?.detail).toBe("Ada said hello first");
    // a moment that never happened is absent, never guessed
    expect(ev.some((e) => e.kind === "first_comment_given" || e.kind === "you_followed")).toBe(false);
  });

  it("anniversaries clamp to the month's end (31 Jan + 1 month = 28 Feb) and the next one is the next real date", () => {
    const a = anniversariesReached("2026-01-31T10:00:00Z", NOW);
    expect(a.map((x) => x.at.slice(0, 10))).toEqual(["2026-02-28", "2026-07-31", "2027-01-31"]);
    expect(nextAnniversary("2026-01-31T10:00:00Z", NOW)?.label).toBe("2 years of friendship");
    expect(nextAnniversary("2027-03-01T00:00:00Z", NOW)).toMatchObject({ label: "1 month of friendship", at: "2027-04-01T00:00:00.000Z" });
  });

  it("a hidden kind leaves the viewer's story; the friendship itself and anniversaries cannot be hidden", () => {
    const ev = buildStory(facts(), NOW, new Set(["first_message", "request_sent", "friends_since", "anniversary"]));
    expect(ev.some((e) => e.kind === "first_message" || e.kind === "request_sent")).toBe(false);
    expect(ev.some((e) => e.kind === "friends_since")).toBe(true);
    expect(ev.some((e) => e.kind === "anniversary")).toBe(true);
    expect(HIDEABLE_KINDS).not.toContain("friends_since");
    expect(HIDEABLE_KINDS).not.toContain("anniversary");
  });

  it("Friendship Health is informational: several signals, never a score", () => {
    expect(friendshipHealth(facts(), NOW).sort()).toEqual(["growing", "long_time", "recently_active"]);
    const quiet = friendshipHealth(facts({ lastMessageAt: "2026-10-01T00:00:00Z", monthly: {} }), NOW);
    expect(quiet).toContain("dormant");
    expect(quiet).not.toContain("recently_active");
    expect(friendshipHealth(facts({ friendsSince: "2027-03-10T00:00:00Z", lastMessageAt: null, monthly: {} }), NOW)).toEqual(["new"]);
  });

  it("insights: the busiest month and the day count", () => {
    const i = friendshipInsights(facts(), NOW);
    expect(i).toMatchObject({ messages: 140, mostActiveMonth: "2027-03", mostActiveMonthMessages: 30, longestStreakDays: 12 });
    expect(i.daysAsFriends).toBe(408);
    expect(friendshipInsights(facts({ monthly: {} }), NOW).mostActiveMonth).toBeNull();
    expect(monthlyCounts(["2027-03-01T00:00:00Z", "2027-03-31T23:59:59Z", "2027-04-01T00:00:00Z", "nope"])).toEqual({ "2027-03": 2, "2027-04": 1 });
  });
});

describe("the Friend Profile keeps private things private", () => {
  const server = readFileSync(join(process.cwd(), "lib/social/friendship/server.ts"), "utf8");
  it("reads likes only (a friend's SAVE is private) and visible comments only", () => {
    expect(server).toContain(`firstOf("post_reactions", "user_id", friendId, viewerId, ["type", "like"])`);
    expect(server).toContain(`firstOf("post_comments", "author_id", friendId, viewerId, ["status", "visible"])`);
    expect(server).not.toMatch(/"save"/);
  });
  it("only friends get a page, sealed capsules leave without their message, mutuals only when public", () => {
    expect(server).toContain("if (!friendship) return null; // the page exists only for friends");
    expect(server).toContain("message: locked ? null : (c.message as string)");
    expect(server).toContain('const disclosed = ((privacy.data as Row | null)?.followers_visibility ?? "public") === "public";');
  });
});
