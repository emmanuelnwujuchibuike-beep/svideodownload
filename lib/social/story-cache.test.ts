import { beforeEach, describe, expect, it, vi } from "vitest";

import { readCachedStories, writeCachedStories } from "./story-cache";
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

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
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
    store.set("frenz-stories-v1", "{not json");
    expect(readCachedStories()).toBeUndefined();
  });

  it("ignores a story with an unparseable timestamp", () => {
    const g = group("weird", 1);
    g.stories[0]!.createdAt = "not-a-date";
    writeCachedStories([g]);
    expect(readCachedStories()).toBeUndefined();
  });
});
