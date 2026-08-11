import { describe, expect, it } from "vitest";

import {
  canSeeRepost,
  isPubliclyCounted,
  LIVE_DESTINATIONS,
  parseAudience,
  REPOST_AUDIENCES,
  REPOST_DESTINATIONS,
  type RepostAudience,
  type ViewerRelation,
} from "@/lib/social/repost/audience";

const stranger: ViewerRelation = { isSelf: false, follows: false, isFriend: false, isCloseFriend: false };
const rel = (over: Partial<ViewerRelation> = {}): ViewerRelation => ({ ...stranger, ...over });

const ALL: RepostAudience[] = ["public", "followers", "friends", "close_friends", "private"];

describe("canSeeRepost", () => {
  it("always shows a member their own repost, including a private one", () => {
    for (const a of ALL) expect(canSeeRepost(a, rel({ isSelf: true }))).toBe(true);
  });

  it("🔴 never leaks a non-public repost to a stranger", () => {
    // The assertion this whole module exists for. A regression here publishes
    // something a member deliberately restricted.
    for (const a of ALL) {
      expect(canSeeRepost(a, stranger)).toBe(a === "public");
    }
  });

  it("🔴 a close-friends repost is invisible to a follower AND to an ordinary friend", () => {
    expect(canSeeRepost("close_friends", rel({ follows: true }))).toBe(false);
    expect(canSeeRepost("close_friends", rel({ isFriend: true }))).toBe(false);
    expect(canSeeRepost("close_friends", rel({ isFriend: true, isCloseFriend: true }))).toBe(true);
  });

  it("a private repost reaches nobody but its author", () => {
    expect(canSeeRepost("private", rel({ follows: true, isFriend: true, isCloseFriend: true }))).toBe(false);
  });

  it("counts a friend as reaching the followers audience even without a follow", () => {
    // Friendship is the stronger, mutually-agreed relationship; excluding a
    // friend who never pressed Follow would read as a bug to both people.
    expect(canSeeRepost("followers", rel({ isFriend: true }))).toBe(true);
    expect(canSeeRepost("followers", rel({ follows: true }))).toBe(true);
  });

  it("🔴 treats an unrecognised audience as the narrowest, not the widest", () => {
    // A newer client writing an audience this build has never heard of must not
    // cause it to be published.
    expect(canSeeRepost("circle:12345" as RepostAudience, rel({ isFriend: true, follows: true }))).toBe(false);
  });
});

describe("parseAudience", () => {
  it("accepts only known values", () => {
    expect(parseAudience("friends")).toBe("friends");
    expect(parseAudience("everyone")).toBeNull();
    expect(parseAudience(null)).toBeNull();
    expect(parseAudience(7)).toBeNull();
    expect(parseAudience({ audience: "public" })).toBeNull();
  });
});

describe("isPubliclyCounted", () => {
  it("only a public repost bumps the public count", () => {
    // The count is the leak: a private repost that incremented a visible total
    // would announce its own existence.
    for (const a of ALL) expect(isPubliclyCounted(a)).toBe(a === "public");
  });
});

describe("the audience table itself", () => {
  it("has a spec for every audience the type allows", () => {
    expect(REPOST_AUDIENCES.map((a) => a.key).sort()).toEqual([...ALL].sort());
  });

  it("every audience carries a badge, so reach is never a mystery on your own repost", () => {
    for (const a of REPOST_AUDIENCES) expect(a.badge.length).toBeGreaterThan(0);
  });
});

describe("destinations", () => {
  it("only renders rows that reach a real destination", () => {
    expect(LIVE_DESTINATIONS.every((d) => d.live)).toBe(true);
    expect(LIVE_DESTINATIONS.length).toBeLessThan(REPOST_DESTINATIONS.length);
  });

  it("🔴 every non-live destination records its concrete blocker", () => {
    // A dead row kept without a reason becomes a mystery, then gets shipped by
    // someone who assumes it was an oversight.
    for (const d of REPOST_DESTINATIONS.filter((x) => !x.live)) {
      expect(d.needs, `${d.key} must say what it needs`).toBeTruthy();
    }
  });
});
