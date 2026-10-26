import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearStoryCaches, readCachedStories, writeCachedStories } from "./story-cache";
import { loadSeenMap, markGroupSeen } from "./story-seen";
import type { StoryGroup } from "./stories";

/**
 * The on-disk story cache exists to stop the inbox's stories row painting an
 * empty strip for seconds on a cold start. Its expiry is the load-bearing part:
 * stories are a 24h product, so a stale disk copy could paint a ring for
 * content that no longer exists — and "why is this story showing?" is a
 * confusion this app has already chased once, at length, against the real DB.
 * Fewer rings for a frame is fine; phantom rings are not.
 */

const store = new Map<string, string>();
/** Who is signed in on this device, as the identity cache records it. */
const signIn = (handle: string | null) =>
  handle ? store.set("frenz-identity", JSON.stringify({ handle, avatarUrl: null })) : store.delete("frenz-identity");

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  signIn("me");
});

function group(handle: string, ageHours: number): StoryGroup {
  return {
    userId: `u-${handle}`,
    handle,
    displayName: handle,
    avatarUrl: null,
    isVerified: false,
    stories: [
      {
        id: `s-${handle}`,
        mediaUrl: "https://example.test/a.jpg",
        mediaKind: "image",
        caption: null,
        createdAt: new Date(Date.now() - ageHours * 3600_000).toISOString(),
        allowReshare: true,
        thumbnailUrl: null,
      },
    ],
  };
}

describe("story disk cache", () => {
  it("returns fresh stories", () => {
    writeCachedStories([group("ada", 1)]);
    expect(readCachedStories()?.map((g) => g.handle)).toEqual(["ada"]);
  });

  it("drops stories past the 24h TTL rather than painting a phantom ring", () => {
    writeCachedStories([group("stale", 25)]);
    expect(readCachedStories()).toBeUndefined();
  });

  it("keeps fresh groups and drops expired ones from the same payload", () => {
    writeCachedStories([group("fresh", 2), group("stale", 30)]);
    expect(readCachedStories()?.map((g) => g.handle)).toEqual(["fresh"]);
  });

  it("drops a group whose every story expired, not just the story", () => {
    const g = group("gone", 48);
    g.stories.push({ ...g.stories[0]!, id: "s2" });
    writeCachedStories([g]);
    expect(readCachedStories()).toBeUndefined();
  });

  it("survives corrupt or absent storage without throwing", () => {
    expect(readCachedStories()).toBeUndefined();
    store.set("frenz-stories-v2", "{not json");
    expect(readCachedStories()).toBeUndefined();
  });

  it("ignores a story with an unparseable timestamp", () => {
    const g = group("weird", 1);
    g.stories[0]!.createdAt = "not-a-date";
    writeCachedStories([g]);
    expect(readCachedStories()).toBeUndefined();
  });
});

/*
  Stories Part 1 (2026-10-26, audit S5): whose rings a member sees, and which stories they watched,
  belong to that member. localStorage is per-origin, not per-account.
*/
describe("🔴 story state is per account", () => {
  it("another account signing in on the same phone never paints the last one's rings — even with no sign-out", () => {
    writeCachedStories([group("friend-of-me", 1)]);
    signIn("someone-else");
    expect(readCachedStories()).toBeUndefined();
    signIn("me");
    expect(readCachedStories()?.map((g) => g.handle)).toEqual(["friend-of-me"]);
  });

  it("with nobody signed in nothing is read, and nothing is written", () => {
    signIn(null);
    writeCachedStories([group("ada", 1)]);
    expect(store.has("frenz-stories-v2")).toBe(false);
    expect(readCachedStories()).toBeUndefined();
  });

  it("the old unowned copy is never read, and is removed on the next write", () => {
    store.set("frenz-stories-v1", JSON.stringify([group("old", 1)]));
    expect(readCachedStories()).toBeUndefined();
    writeCachedStories([group("ada", 1)]);
    expect(store.has("frenz-stories-v1")).toBe(false);
  });

  it("sign-out clears the rings AND the seen marks, old keys too — and nothing else", () => {
    writeCachedStories([group("ada", 1)]);
    markGroupSeen(group("ada", 1));
    store.set("frenz-stories-v1", "[]");
    store.set("frenz:stories-seen", "{}");
    store.set("unrelated", "keep");
    clearStoryCaches();
    expect([...store.keys()].sort()).toEqual(["frenz-identity", "unrelated"]);
  });

  it("seen marks belong to the account that made them", () => {
    markGroupSeen(group("ada", 1));
    expect(Object.keys(loadSeenMap())).toEqual(["ada"]);
    signIn("someone-else");
    expect(loadSeenMap()).toEqual({});
  });

  it("the old unowned seen marks are adopted ONCE by the account signed in, so no ring turns unseen on release", () => {
    store.set("frenz:stories-seen", JSON.stringify({ ada: "2026-10-26T00:00:00.000Z" }));
    expect(loadSeenMap()).toEqual({ ada: "2026-10-26T00:00:00.000Z" });
    expect(store.has("frenz:stories-seen")).toBe(false);
    signIn("someone-else");
    expect(loadSeenMap()).toEqual({});
  });

  it("lib/auth/sign-out.ts calls it", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("lib/auth/sign-out.ts", "utf8")).toContain("clearStoryCaches();");
  });
});
