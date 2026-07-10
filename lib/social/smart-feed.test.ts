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
