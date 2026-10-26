import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearStoryCaches, confirmedSeenIds, readCachedStories, rememberConfirmedView, writeCachedStories } from "./story-cache";
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
  clearStoryCaches(); // the confirmed views live in memory between tests
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

  it("sign-out clears the rings, the confirmed views AND the old seen marks — and nothing else", () => {
    writeCachedStories([group("ada", 1)]);
    rememberConfirmedView("s-ada");
    store.set("frenz-stories-v1", "[]");
    store.set("frenz:stories-seen", "{}");
    store.set("frenz:stories-seen-v2", "{}");
    store.set("unrelated", "keep");
    clearStoryCaches();
    expect([...store.keys()].sort()).toEqual(["frenz-identity", "unrelated"]);
    expect(confirmedSeenIds().size).toBe(0);
  });

  /* Stories Part 3: a confirmed view belongs to the account that made it */
  it("confirmed views belong to the account that made them — another account on the same phone sees none", () => {
    rememberConfirmedView("s-ada");
    expect([...confirmedSeenIds()]).toEqual(["s-ada"]);
    signIn("someone-else");
    expect(confirmedSeenIds().size).toBe(0);
    rememberConfirmedView("s-bob");
    signIn("me");
    expect([...confirmedSeenIds()]).toEqual([]); // the newer account's set replaced it — nothing crosses over
  });

  it("a confirmed view patches the disk copy, so a cold start paints the ring watched", () => {
    writeCachedStories([group("ada", 1)]);
    rememberConfirmedView("s-ada");
    expect(readCachedStories()?.[0]?.stories[0]?.seen).toBe(true);
  });

  it("signed out, a view is never remembered", () => {
    signIn(null);
    rememberConfirmedView("s-ada");
    expect(confirmedSeenIds().size).toBe(0);
  });

  it("the old device-local seen marks are never read again, and are removed on the next ring write", () => {
    store.set("frenz:stories-seen", JSON.stringify({ ada: "2026-10-26T00:00:00.000Z" }));
    store.set("frenz:stories-seen-v2", JSON.stringify({ owner: "me", marks: { ada: "2026-10-26T00:00:00.000Z" } }));
    writeCachedStories([group("ada", 1)]);
    expect(store.has("frenz:stories-seen")).toBe(false);
    expect(store.has("frenz:stories-seen-v2")).toBe(false);
  });

  it("a story ended early (its own end time passed) is dropped from the disk copy", () => {
    const g = group("ended", 1);
    g.stories[0]!.expiresAt = new Date(Date.now() - 1000).toISOString();
    writeCachedStories([g]);
    expect(readCachedStories()).toBeUndefined();
  });

  it("lib/auth/sign-out.ts calls it", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("lib/auth/sign-out.ts", "utf8")).toContain("clearStoryCaches();");
  });
});
