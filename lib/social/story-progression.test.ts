import { describe, expect, it } from "vitest";

import { isStoryLive, nextPosition, positionAfterRemoval, startIndex, withoutStories, type IsSeen, type Position } from "./story-progression";
import type { StoryGroup, StoryItem } from "./stories";

/**
 * Stories Part 3 (2026-10-26) — where the viewer opens and goes next. Part 2's ring order and each ring's
 * story order are kept as delivered; this only decides the position.
 */
const NOW = Date.parse("2026-10-26T12:00:00Z");
const item = (id: string, seen = false, extra: Partial<StoryItem> = {}): StoryItem => ({
  id, mediaUrl: `https://media.test/${id}.jpg`, mediaKind: "image", caption: null, createdAt: new Date(NOW - 3_600_000).toISOString(), allowReshare: true, thumbnailUrl: null, seen, ...extra,
});
const ring = (userId: string, ...stories: StoryItem[]): StoryGroup => ({ userId, handle: userId, displayName: userId, avatarUrl: null, isVerified: false, stories });
const seen: IsSeen = (s) => s.seen === true;

/** Plays from a ring's opening to the end, returning the story ids shown. */
function playAll(groups: StoryGroup[], from: Position): string[] {
  const shown: string[] = [];
  let at: Position | null = from;
  while (at) {
    shown.push(groups[at.gi]!.stories[at.si]!.id);
    at = nextPosition(groups, at, seen);
  }
  return shown;
}

describe("opening a ring", () => {
  it("starts at the first story not yet watched", () => {
    expect(startIndex(ring("a", item("a1", true), item("a2", true), item("a3"), item("a4")), seen)).toBe(2);
  });
  it("all watched: replays from the first — predictably", () => {
    expect(startIndex(ring("a", item("a1", true), item("a2", true)), seen)).toBe(0);
  });
  it("none watched: the first", () => {
    expect(startIndex(ring("a", item("a1"), item("a2")), seen)).toBe(0);
  });
});

describe("advancing", () => {
  const groups = [ring("a", item("a1", true), item("a2"), item("a3")), ring("b", item("b1", true), item("b2")), ring("c", item("c1"))];

  it("through every unwatched story in order — none jumped over — then the next ring at ITS first unwatched", () => {
    expect(playAll(groups, { gi: 0, si: startIndex(groups[0], seen) })).toEqual(["a2", "a3", "b2", "c1"]);
  });

  it("crossing into the next ring is flagged (the paid card may show there, never inside a ring)", () => {
    expect(nextPosition(groups, { gi: 0, si: 2 }, seen)).toEqual({ gi: 1, si: 1, changedGroup: true });
    expect(nextPosition(groups, { gi: 0, si: 1 }, seen)).toEqual({ gi: 0, si: 2, changedGroup: false });
  });

  it("the end closes", () => {
    expect(nextPosition(groups, { gi: 2, si: 0 }, seen)).toBeNull();
  });

  it("🔴 moving never marks anything: the stories passed over keep their state", () => {
    const before = JSON.stringify(groups);
    playAll(groups, { gi: 0, si: 1 });
    expect(JSON.stringify(groups)).toBe(before);
  });
});

describe("a story leaves while the viewer is open — ended, deleted, or no longer allowed", () => {
  const groups = () => [ring("a", item("a1"), item("a2"), item("a3")), ring("b", item("b1", true), item("b2")), ring("c", item("c1"))];

  it("the next story in the ring slides into place", () => {
    const g = groups();
    const to = positionAfterRemoval(g, { gi: 0, si: 1 }, new Set(["a2"]), seen);
    expect(withoutStories(g, new Set(["a2"]))[to!.gi]!.stories[to!.si]!.id).toBe("a3");
  });

  it("the ring's last story left: its previous one (as deleting your own last story always did)", () => {
    const g = groups();
    const to = positionAfterRemoval(g, { gi: 0, si: 2 }, new Set(["a3"]), seen);
    expect(withoutStories(g, new Set(["a3"]))[to!.gi]!.stories[to!.si]!.id).toBe("a2");
  });

  it("a ring emptied: the next ring, at its first unwatched story", () => {
    const g = groups();
    const gone = new Set(["a1", "a2", "a3"]);
    const to = positionAfterRemoval(g, { gi: 0, si: 0 }, gone, seen);
    expect(withoutStories(g, gone)[to!.gi]!.stories[to!.si]!.id).toBe("b2");
  });

  it("a story elsewhere leaving keeps the one on screen on screen (indices re-found)", () => {
    const g = groups();
    const gone = new Set(["a1", "a2", "a3"]);
    const to = positionAfterRemoval(g, { gi: 1, si: 1 }, gone, seen);
    expect(withoutStories(g, gone)[to!.gi]!.stories[to!.si]!.id).toBe("b2");
  });

  it("nothing left: close", () => {
    expect(positionAfterRemoval([ring("a", item("a1"))], { gi: 0, si: 0 }, new Set(["a1"]), seen)).toBeNull();
  });

  it("🔴 a story removed is never reachable again — not by advancing, not by going back", () => {
    const g = withoutStories(groups(), new Set(["a2", "b2"]));
    expect(playAll(g, { gi: 0, si: 0 })).toEqual(["a1", "a3", "b1", "c1"]); // ring b keeps only b1 (watched → replayed)
    expect(g.flatMap((x) => x.stories.map((s) => s.id))).not.toContain("a2");
  });
});

describe("ended stories", () => {
  it("live until its own end time", () => {
    expect(isStoryLive(item("x", false, { expiresAt: new Date(NOW + 1000).toISOString() }), NOW)).toBe(true);
    expect(isStoryLive(item("x", false, { expiresAt: new Date(NOW - 1000).toISOString() }), NOW)).toBe(false);
  });
  it("no end time sent: 24 h from posting", () => {
    expect(isStoryLive(item("x", false, { createdAt: new Date(NOW - 23 * 3_600_000).toISOString() }), NOW)).toBe(true);
    expect(isStoryLive(item("x", false, { createdAt: new Date(NOW - 25 * 3_600_000).toISOString() }), NOW)).toBe(false);
  });
  it("an unreadable time is not live (fails closed)", () => {
    expect(isStoryLive(item("x", false, { createdAt: "nope" }), NOW)).toBe(false);
  });
});
