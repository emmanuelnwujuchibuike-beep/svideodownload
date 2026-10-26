import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NO_TIES, rankStoryGroups, storyTier, storyVisibleTo, type StoryTier, type ViewerTies } from "./story-audience";

/**
 * Stories Part 2 (2026-10-26) — the ONE rule every story surface uses. The case table is shared with
 * supabase/tests/0287_story_followers.pglite.mjs, which asks the SAME questions of story_view_access in
 * Postgres: a ring may never show a story whose view or reshare the database refuses, or the reverse.
 */
type Case = { label: string; author: { visibility: string; suspended?: boolean; hidden?: boolean; handle?: string | null }; ties: Record<string, boolean>; visible: boolean };
const { cases } = JSON.parse(readFileSync(join(process.cwd(), "supabase/tests/story-audience-cases.json"), "utf8")) as { cases: Case[] };

const AUTHOR = "a0000000-0000-4000-8000-000000000001";
const VIEWER = "b0000000-0000-4000-8000-000000000001";
const tiesOf = (t: Record<string, boolean>): ViewerTies => ({
  friend: !!t.friend,
  follows: !!t.follows,
  chat: !!t.chat,
  // lib/social/stories.ts folds blocks (both ways) and status restrictions into one "excluded"; a messaging-only restriction is not one
  excluded: !!(t.blockedBy || t.blocks || t.restricted),
});

describe("storyVisibleTo — the shared case table (the same answers story_view_access gives)", () => {
  it("covers the brief's cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });
  for (const c of cases) {
    it(c.label, () => {
      const author = { id: AUTHOR, handle: c.author.handle === null ? null : "author", visibility: c.author.visibility, isSuspended: !!c.author.suspended, isHidden: !!c.author.hidden };
      expect(storyVisibleTo(author, VIEWER, tiesOf(c.ties))).toBe(c.visible);
    });
  }
});

describe("storyVisibleTo — the author and the signed-out", () => {
  const me = { id: AUTHOR, handle: "me", visibility: "private", isSuspended: false, isHidden: false };
  it("the author always sees their own active story, whatever their privacy", () => {
    expect(storyVisibleTo(me, AUTHOR, NO_TIES)).toBe(true);
    expect(storyVisibleTo({ ...me, isHidden: true }, AUTHOR, NO_TIES)).toBe(true);
  });
  it("a suspended author sees nothing of their own either (account-visibility.ts: suspension outranks everything)", () => {
    expect(storyVisibleTo({ ...me, isSuspended: true }, AUTHOR, NO_TIES)).toBe(false);
  });
  it("signed out: public stories only", () => {
    expect(storyVisibleTo({ ...me, visibility: "public" }, null, NO_TIES)).toBe(true);
    expect(storyVisibleTo({ ...me, visibility: "followers" }, null, NO_TIES)).toBe(false);
    expect(storyVisibleTo({ ...me, visibility: "private" }, null, NO_TIES)).toBe(false);
    expect(storyVisibleTo({ ...me, visibility: "public", isHidden: true }, null, NO_TIES)).toBe(false);
  });
  it("an unknown visibility value is treated as private (fails closed)", () => {
    expect(storyVisibleTo({ ...me, visibility: "everyone" }, VIEWER, { ...NO_TIES, follows: true })).toBe(false);
  });
});

describe("ordering (B3): tier, then unwatched, then recency — relationship only", () => {
  it("tiers: you, friends, follows/chats, everyone else", () => {
    expect(storyTier(VIEWER, VIEWER, NO_TIES)).toBe(0);
    expect(storyTier(AUTHOR, VIEWER, { ...NO_TIES, friend: true, follows: true })).toBe(1);
    expect(storyTier(AUTHOR, VIEWER, { ...NO_TIES, follows: true })).toBe(2);
    expect(storyTier(AUTHOR, VIEWER, { ...NO_TIES, chat: true })).toBe(2);
    expect(storyTier(AUTHOR, VIEWER, NO_TIES)).toBe(3);
    expect(storyTier(AUTHOR, null, NO_TIES)).toBe(3);
  });
  const g = (id: string, tier: StoryTier, unwatched: boolean, newestAt: string) => ({ id, tier, unwatched, newestAt });
  it("a friend before a stranger even when the stranger is newer and unwatched", () => {
    expect(rankStoryGroups([g("stranger", 3, true, "2026-10-26T12:00"), g("friend", 1, false, "2026-10-26T01:00")]).map((x) => x.id)).toEqual(["friend", "stranger"]);
  });
  it("within a tier, unwatched before watched — then the most recent", () => {
    const out = rankStoryGroups([
      g("watched-new", 1, false, "2026-10-26T12:00"),
      g("unwatched-old", 1, true, "2026-10-26T01:00"),
      g("unwatched-new", 1, true, "2026-10-26T09:00"),
    ]).map((x) => x.id);
    expect(out).toEqual(["unwatched-new", "unwatched-old", "watched-new"]);
  });
  it("your own ring is first whatever you have watched", () => {
    expect(rankStoryGroups([g("friend", 1, true, "2026-10-26T12:00"), g("me", 0, false, "2026-10-26T00:00")])[0]!.id).toBe("me");
  });
  it("stable for equal keys, and never mutates its input", () => {
    const input = [g("a", 2, true, "x"), g("b", 2, true, "x")];
    const copy = JSON.stringify(input);
    expect(rankStoryGroups(input).map((x) => x.id)).toEqual(["a", "b"]);
    expect(JSON.stringify(input)).toBe(copy);
  });
});
