import { describe, expect, it } from "vitest";

import type { FeedItem } from "./home-feed";
import { balanceByKind, feedReason } from "./smart-feed";

function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    title: "post",
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
    publisher: { id: "p1", handle: "creator", displayName: "Creator", avatarUrl: null, isVerified: false, plan: "free" },
    viewerLiked: false,
    viewerSaved: false,
    isFollowing: false,
    isOwner: false,
    hasPoll: false,
    ...overrides,
  };
}

describe("feedReason", () => {
  it("prioritizes 'from someone you follow' above everything else", () => {
    const item = makeItem({ isFollowing: true, downloadsCount: 999 });
    expect(feedReason(item)?.tone).toBe("follow");
  });

  it("falls back to a trending-download reason at 25+ downloads", () => {
    const item = makeItem({ downloadsCount: 30 });
    expect(feedReason(item)?.tone).toBe("download");
  });

  it("falls back to a category reason when nothing else applies", () => {
    const item = makeItem({
      category: "tech",
      createdAt: new Date(Date.now() - 100 * 3_600_000).toISOString(), // old, not "fresh"
    });
    expect(feedReason(item)).toEqual({ tone: "interest", label: "Popular in tech" });
  });

  it("returns null when no signal applies at all", () => {
    const item = makeItem({ createdAt: new Date(Date.now() - 100 * 3_600_000).toISOString() });
    expect(feedReason(item)).toBeNull();
  });
});

describe("balanceByKind", () => {
  it("caps a run of the same media kind at maxRun", () => {
    const items = [
      makeItem({ id: "1", mediaKind: "video" }),
      makeItem({ id: "2", mediaKind: "video" }),
      makeItem({ id: "3", mediaKind: "video" }),
      makeItem({ id: "4", mediaKind: "video" }),
      makeItem({ id: "5", mediaKind: "image" }),
    ];
    const out = balanceByKind(items, 2);
    // The 4th video should be pulled to AFTER the image, breaking the run of 4.
    const kinds = out.map((i) => i.mediaKind);
    let run = 0;
    let last: string | null = null;
    for (const k of kinds) {
      run = k === last ? run + 1 : 1;
      last = k;
      expect(run).toBeLessThanOrEqual(2);
    }
  });

  it("is a no-op when nothing exceeds the cap", () => {
    const items = [makeItem({ id: "1", mediaKind: "video" }), makeItem({ id: "2", mediaKind: "image" }), makeItem({ id: "3", mediaKind: "video" })];
    expect(balanceByKind(items, 2).map((i) => i.id)).toEqual(["1", "2", "3"]);
  });

  it("preserves the total item count", () => {
    const items = Array.from({ length: 6 }, (_, i) => makeItem({ id: String(i), mediaKind: "video" }));
    expect(balanceByKind(items, 2)).toHaveLength(6);
  });
});

/**
 * The server pins brand-new posts to the top of "for_you" (rankForYou's
 * NEW_POST_WINDOW_MS) so the realtime "N new posts" pill is honest — tap it and
 * the promised post is visibly at position 0. But SmartFeed runs every returned
 * page through `balanceByKind` before rendering, which REORDERS items. If that
 * ever moved index 0, it would silently undo the pinning client-side and the
 * pill would refresh to... the new post somewhere down the list.
 *
 * It's safe today by construction (the first iteration has no `lastKind`, so it
 * always takes idx 0) — but that's incidental to balancing, not a stated
 * contract. This pins it as one.
 */
describe("balanceByKind — must never displace the pinned top post", () => {
  const item = (id: string, mediaKind: string) =>
    ({ id, mediaKind }) as unknown as Parameters<typeof balanceByKind>[0][number];

  it("keeps the first item first, even when it starts a same-kind run", () => {
    const items = [
      item("brand-new", "video"),
      item("old-1", "video"),
      item("old-2", "video"),
      item("old-3", "image"),
    ];
    expect(balanceByKind(items)[0]?.id).toBe("brand-new");
  });

  it("keeps the first item first regardless of the kind mix", () => {
    for (const kinds of [["image", "image", "image"], ["video", "image", "video"], ["image", "video", "video"]]) {
      const items = [item("brand-new", kinds[0]!), item("b", kinds[1]!), item("c", kinds[2]!)];
      expect(balanceByKind(items)[0]?.id).toBe("brand-new");
    }
  });

  it("never drops or duplicates while balancing", () => {
    const items = Array.from({ length: 12 }, (_, i) => item(`p${i}`, i % 3 === 0 ? "image" : "video"));
    const out = balanceByKind(items);
    expect(out).toHaveLength(12);
    expect(new Set(out.map((i) => i.id)).size).toBe(12);
  });
});
