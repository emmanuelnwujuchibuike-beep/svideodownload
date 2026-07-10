import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadFeedContinuity, saveFeedContinuity } from "./feed-continuity";
import type { FeedItem } from "./home-feed";

function makeItem(id: string): FeedItem {
  return {
    id,
    title: id,
    description: null,
    platform: "frenz",
    mediaKind: "video",
    thumbnailUrl: null,
    sourceUrl: "https://example.com/x",
    mediaUrl: null,
    streamUid: null,
    category: null,
    durationSec: null,
    viewsCount: 0,
    likesCount: 0,
    commentsCount: 0,
    sharesCount: 0,
    savesCount: 0,
    downloadsCount: 0,
    createdAt: new Date().toISOString(),
    publisher: { id: "p", handle: "p", displayName: "P", avatarUrl: null, isVerified: false, plan: "free" },
    viewerLiked: false,
    viewerSaved: false,
    isFollowing: false,
    isOwner: false,
    hasPoll: false,
  };
}

/** Minimal in-memory localStorage — vitest's default `node` environment has none. */
function installFakeLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
}

describe("feed continuity — keeps the MOST RECENT items, not the oldest", () => {
  beforeEach(() => installFakeLocalStorage());

  it("a real bug found in review: truncating a long tab kept the tab's oldest items (top-of-feed) instead of the most recent ones (near the viewer's actual scroll position)", () => {
    // Items accumulate oldest-first, exactly like smart-feed.tsx's
    // `entry.items = [...entry.items, ...balancedFresh]` — so item "0" is the
    // top of the feed and "99" is the most recently loaded page, nearest to
    // wherever the viewer actually scrolled to.
    const items = Array.from({ length: 100 }, (_, i) => makeItem(String(i)));

    saveFeedContinuity({ sort: "for_you", scrollY: 12000, tabs: { for_you: { items, nextOffset: 100 } } });
    const restored = loadFeedContinuity();

    const restoredItems = restored?.tabs.for_you?.items ?? [];
    expect(restoredItems).toHaveLength(60); // MAX_ITEMS_PER_TAB
    // Must be the LAST 60 (ids "40".."99"), not the first 60 ("0".."59").
    expect(restoredItems[0]?.id).toBe("40");
    expect(restoredItems[restoredItems.length - 1]?.id).toBe("99");
  });

  it("keeps every item verbatim when under the cap (no truncation needed)", () => {
    const items = Array.from({ length: 10 }, (_, i) => makeItem(String(i)));
    saveFeedContinuity({ sort: "for_you", scrollY: 500, tabs: { for_you: { items, nextOffset: null } } });
    const restored = loadFeedContinuity();
    expect(restored?.tabs.for_you?.items.map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it("returns null for a snapshot older than the 30-minute cutoff", () => {
    const items = [makeItem("a")];
    saveFeedContinuity({ sort: "for_you", scrollY: 0, tabs: { for_you: { items, nextOffset: null } } });
    const raw = localStorage.getItem("frenz:feed-continuity:v1")!;
    const stale = { ...JSON.parse(raw), savedAt: Date.now() - 31 * 60 * 1000 };
    localStorage.setItem("frenz:feed-continuity:v1", JSON.stringify(stale));
    expect(loadFeedContinuity()).toBeNull();
  });
});
