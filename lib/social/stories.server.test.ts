import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Stories Part 2 (2026-10-26) — the REAL lib/social/stories.ts over an in-memory database (only `server-only` and the
 * client are replaced). Pinned: B1 who sees whose story on every surface (Home `all`, the Friends page's `friends` and
 * `following`, and the in-chat strip), B2 a tied author is never crowded out by 200+ newer strangers, B3 the order,
 * and that a failed block read shows nobody's stories but your own.
 */
let db: FakeDb;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sb.test");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test");
const { getActiveStories, getActiveStoryForUser } = await import("./stories");

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = U(1);
const FRIEND = U(2); // public, a friend
const FOLLOWED = U(3); // followers-only, I follow them
const NOTFOLLOWED = U(4); // followers-only, I don't follow them
const PRIVATE_FRIEND = U(5); // private, a friend, no chat
const PRIVATE_CHAT = U(6); // private, we share a direct chat
const BLOCKER = U(7); // public, blocked me
const STRANGER = U(8); // public, no tie
const pair = (a: string, b: string) => (a < b ? [a, b] : [b, a]) as [string, string];

const future = (h = 20) => new Date(Date.now() + h * 3_600_000).toISOString();
const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
let sid = 0;
const story = (user_id: string, createdMinutesAgo: number) => ({ id: `s${++sid}`, user_id, media_url: `https://media.test/${user_id}/${sid}.jpg`, media_kind: "image", caption: null, created_at: ago(createdMinutesAgo), expires_at: future(), allow_reshare: true, thumbnail_url: null });
const profile = (id: string, handle: string, visibility = "public", extra: Record<string, unknown> = {}) => ({ id, handle, display_name: handle, avatar_url: null, is_verified: false, visibility, is_suspended: false, is_hidden: false, ...extra });

beforeEach(() => {
  sid = 0;
  const [f1, f2] = pair(ME, FRIEND);
  const [p1, p2] = pair(ME, PRIVATE_FRIEND);
  const [c1, c2] = pair(ME, PRIVATE_CHAT);
  db = fakeDb({
    profiles: [
      profile(ME, "me", "private"),
      profile(FRIEND, "friend"),
      profile(FOLLOWED, "followed", "followers"),
      profile(NOTFOLLOWED, "notfollowed", "followers"),
      profile(PRIVATE_FRIEND, "privatefriend", "private"),
      profile(PRIVATE_CHAT, "privatechat", "private"),
      profile(BLOCKER, "blocker"),
      profile(STRANGER, "stranger"),
    ],
    friendships: [{ user_low: f1, user_high: f2 }, { user_low: p1, user_high: p2 }],
    follows: [{ follower_id: ME, following_id: FOLLOWED }],
    conversations: [{ id: "c1", type: "direct", user_low: c1, user_high: c2 }],
    blocks: [{ blocker_id: BLOCKER, blocked_id: ME }],
    user_restrictions: [],
    story_views: [],
    stories: [story(ME, 5), story(FRIEND, 30), story(FOLLOWED, 40), story(NOTFOLLOWED, 10), story(PRIVATE_FRIEND, 10), story(PRIVATE_CHAT, 50), story(BLOCKER, 1), story(STRANGER, 2)],
  });
});

const handles = (gs: { handle: string }[]) => gs.map((g) => g.handle);

describe("B1 · who sees whose story", () => {
  it("Home: you, your friend, the followers-only person you follow, the private person you chat with, and a public stranger", async () => {
    const hs = handles(await getActiveStories(ME, 50, "all"));
    expect(hs).toEqual(expect.arrayContaining(["me", "friend", "followed", "privatechat", "stranger"]));
    expect(hs).not.toContain("notfollowed"); // followers-only, not followed
    expect(hs).not.toContain("privatefriend"); // private: a friendship alone opens nothing (canSeePost)
    expect(hs).not.toContain("blocker"); // blocked
  });

  it("Friends tab: friends only — still by the same rule", async () => {
    expect(handles(await getActiveStories(ME, 100, "friends")).sort()).toEqual(["friend", "me"]);
  });

  it("Following tab: the followers-only author you follow now appears (before: nobody saw them)", async () => {
    expect(handles(await getActiveStories(ME, 100, "following")).sort()).toEqual(["followed", "me"]);
  });

  it("the author always sees their own active story — even with a private profile", async () => {
    expect(handles(await getActiveStories(ME, 50, "all"))[0]).toBe("me");
  });

  it("signed out: public stories only", async () => {
    expect(handles(await getActiveStories(null, 50, "all")).sort()).toEqual(["blocker", "friend", "stranger"]);
  });

  it("a suspended author disappears for everyone, a hidden author stays for friends only", async () => {
    db.tables.profiles = db.tables.profiles!.map((p) => (p.id === STRANGER ? { ...p, is_suspended: true } : p.id === FRIEND ? { ...p, is_hidden: true } : p));
    const hs = handles(await getActiveStories(ME, 50, "all"));
    expect(hs).not.toContain("stranger");
    expect(hs).toContain("friend");
    expect(handles(await getActiveStories(null, 50, "all"))).not.toContain("friend");
  });

  it("🔴 a status restriction hides a story both ways", async () => {
    db.tables.user_restrictions = [{ restrictor_id: FRIEND, restricted_id: ME, scope: "status" }];
    expect(handles(await getActiveStories(ME, 50, "all"))).not.toContain("friend");
  });

  it("🔴 the block list cannot be read: nobody's stories but your own (fails closed)", async () => {
    db.failOn.blocks = "relation unavailable";
    expect(handles(await getActiveStories(ME, 50, "all"))).toEqual(["me"]);
  });
});

describe("B1 · the in-chat strip answers by the same rule", () => {
  it("a private member you chat with: their stories", async () => {
    expect((await getActiveStoryForUser(PRIVATE_CHAT, ME))?.handle).toBe("privatechat");
  });
  it("🔴 a private friend with no chat, a followers-only non-follow, a blocker: nothing", async () => {
    expect(await getActiveStoryForUser(PRIVATE_FRIEND, ME)).toBeNull();
    expect(await getActiveStoryForUser(NOTFOLLOWED, ME)).toBeNull();
    expect(await getActiveStoryForUser(BLOCKER, ME)).toBeNull();
  });
  it("🔴 the block list cannot be read: nothing", async () => {
    db.failOn.blocks = "relation unavailable";
    expect(await getActiveStoryForUser(FRIEND, ME)).toBeNull();
  });
});

describe("B2 · a tied author is never crowded out", () => {
  it("your friend's story is returned with 250 newer stories from 250 strangers", async () => {
    for (let i = 0; i < 250; i++) {
      const id = `9${String(i).padStart(7, "0")}-0000-4000-8000-000000000000`;
      db.tables.profiles!.push(profile(id, `s${i}`));
      db.tables.stories!.push(story(id, 0));
    }
    db.tables.stories = db.tables.stories!.map((s) => (s.user_id === FRIEND ? { ...s, created_at: ago(600) } : s));
    const hs = handles(await getActiveStories(ME, 50, "all"));
    expect(hs.slice(0, 2)).toEqual(["me", "friend"]);
    expect(hs).toContain("followed");
    expect(hs).toContain("privatechat");
    expect(hs).toHaveLength(50); // the limit is reached by discovery AFTER everyone you know
  });

  it("an expired story is never returned", async () => {
    db.tables.stories = db.tables.stories!.map((s) => (s.user_id === FRIEND ? { ...s, expires_at: ago(1) } : s));
    expect(handles(await getActiveStories(ME, 50, "all"))).not.toContain("friend");
  });
});

describe("B3 · order, one ring per author", () => {
  it("you, then friends, then follows/chats, then strangers — even when a stranger is newest", async () => {
    expect(handles(await getActiveStories(ME, 50, "all"))).toEqual(["me", "friend", "followed", "privatechat", "stranger"]);
  });

  it("within a tier, an unwatched ring comes before a watched one", async () => {
    // FOLLOWED is newer than PRIVATE_CHAT (40 vs 50 min); once watched, it drops behind it
    const watched = db.tables.stories!.find((s) => s.user_id === FOLLOWED)!.id;
    db.tables.story_views = [{ story_id: watched, viewer_id: ME }];
    expect(handles(await getActiveStories(ME, 50, "all"))).toEqual(["me", "friend", "privatechat", "followed", "stranger"]);
  });

  it("several stories by one author are ONE ring, newest first", async () => {
    db.tables.stories!.push(story(FRIEND, 3), story(FRIEND, 90));
    const groups = await getActiveStories(ME, 50, "all");
    const friend = groups.filter((g) => g.handle === "friend");
    expect(friend).toHaveLength(1);
    const times = friend[0]!.stories.map((s) => s.createdAt);
    expect(times).toEqual([...times].sort().reverse());
    expect(friend[0]!.stories).toHaveLength(3);
  });

  it("nothing active: an empty list, not an error", async () => {
    db.tables.stories = [];
    expect(await getActiveStories(ME, 50, "all")).toEqual([]);
  });

  it("the limit is respected", async () => {
    expect(await getActiveStories(ME, 2, "all")).toHaveLength(2);
  });
});

describe("Part 3 · each story carries the viewer's OWN seen state, from story_views", () => {
  it("a watched story is seen, the same author's other stories are not", async () => {
    db.tables.stories!.push(story(FRIEND, 3));
    const watched = db.tables.stories!.find((s) => s.user_id === FRIEND)!.id;
    db.tables.story_views = [{ story_id: watched, viewer_id: ME }];
    const friend = (await getActiveStories(ME, 50, "all")).find((g) => g.handle === "friend")!;
    expect(friend.stories.map((s) => [s.id, s.seen])).toEqual(expect.arrayContaining([[watched, true]]));
    expect(friend.stories.filter((s) => s.seen)).toHaveLength(1);
  });

  it("🔴 another member's view never reads as mine", async () => {
    const id = db.tables.stories!.find((s) => s.user_id === FRIEND)!.id;
    db.tables.story_views = [{ story_id: id, viewer_id: STRANGER }];
    const friend = (await getActiveStories(ME, 50, "all")).find((g) => g.handle === "friend")!;
    expect(friend.stories.every((s) => s.seen === false)).toBe(true);
  });

  it("signed out: nothing is seen, and story_views is never read", async () => {
    db.tables.story_views = [{ story_id: db.tables.stories![0]!.id, viewer_id: ME }];
    const groups = await getActiveStories(null, 50, "all");
    expect(groups.flatMap((g) => g.stories).every((s) => s.seen === false)).toBe(true);
  });

  it("the chat strip carries it too, and each story its own end time", async () => {
    const id = db.tables.stories!.find((s) => s.user_id === PRIVATE_CHAT)!.id;
    db.tables.story_views = [{ story_id: id, viewer_id: ME }];
    const g = await getActiveStoryForUser(PRIVATE_CHAT, ME);
    expect(g?.stories[0]?.seen).toBe(true);
    expect(g?.stories[0]?.expiresAt).toEqual(expect.any(String));
  });

  it("a failed story_views read is 'not seen' — never an error, never fewer rings", async () => {
    db.failOn.story_views = "down";
    const hs = handles(await getActiveStories(ME, 50, "all"));
    expect(hs).toEqual(["me", "friend", "followed", "privatechat", "stranger"]);
  });
});

describe("the Story viewer design's settings", () => {
  it("each story carries its 'Allow replies' (0288); absent = on", async () => {
    db.tables.stories = db.tables.stories!.map((s) => (s.user_id === FRIEND ? { ...s, allow_replies: false } : s));
    const groups = await getActiveStories(ME, 50, "all");
    expect(groups.find((g) => g.handle === "friend")!.stories[0]!.allowReplies).toBe(false);
    expect(groups.find((g) => g.handle === "stranger")!.stories[0]!.allowReplies).toBe(true);
  });

  it("'Who can see this' rides on YOUR ring only — never on anyone else's", async () => {
    const groups = await getActiveStories(ME, 50, "all");
    expect(groups.find((g) => g.handle === "me")!.audience).toBe("private");
    expect(groups.filter((g) => g.handle !== "me").every((g) => g.audience === undefined)).toBe(true);
  });
});

describe("regression · nothing about an unauthorized author leaves the function", () => {
  it("no hidden author's media URL is in the payload", async () => {
    const json = JSON.stringify(await getActiveStories(ME, 50, "all"));
    for (const hidden of [NOTFOLLOWED, PRIVATE_FRIEND, BLOCKER]) expect(json).not.toContain(hidden);
  });
});
