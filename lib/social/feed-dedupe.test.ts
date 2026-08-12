import { describe, expect, it } from "vitest";

import {
  acceptFeedItems,
  dedupeFeedItems,
  mediaIdentity,
  seenFromItems,
  type DedupableItem,
} from "@/lib/social/feed-dedupe";

const video = (p: Partial<DedupableItem> & { id: string }): DedupableItem => ({
  mediaKind: "video",
  ...p,
});

describe("mediaIdentity", () => {
  it("prefers the Stream uid — the strongest 'same bytes' handle", () => {
    const a = video({ id: "a", streamUid: "uid-1", mediaUrl: "https://x/1.mp4" });
    const b = video({ id: "b", streamUid: "uid-1", mediaUrl: "https://x/2.mp4" });
    expect(mediaIdentity(a)).toBe(mediaIdentity(b));
  });

  it("falls back to the stored file when there is no source", () => {
    const a = video({ id: "a", mediaUrl: "https://x/1.mp4" });
    const b = video({ id: "b", mediaUrl: "https://x/1.mp4" });
    expect(mediaIdentity(a)).toBe(mediaIdentity(b));
  });

  it("🔴 ranks sourceUrl ABOVE mediaUrl — reversing these defeats the feature", () => {
    // Same source, different stored copies → the same clip.
    const sameClip = [
      video({ id: "a", mediaUrl: "https://cdn/alice.mp4", sourceUrl: "https://tiktok/1" }),
      video({ id: "b", mediaUrl: "https://cdn/bob.mp4", sourceUrl: "https://tiktok/1" }),
    ];
    expect(mediaIdentity(sameClip[0]!)).toBe(mediaIdentity(sameClip[1]!));
    // Same stored copy is impossible across different sources, but if it ever
    // happened the source is still the authority — they are different posts.
    const different = [
      video({ id: "a", mediaUrl: "https://x/1.mp4", sourceUrl: "https://tiktok/1" }),
      video({ id: "b", mediaUrl: "https://x/1.mp4", sourceUrl: "https://tiktok/2" }),
    ];
    expect(mediaIdentity(different[0]!)).not.toBe(mediaIdentity(different[1]!));
  });

  it("🔴 collapses two people who downloaded the SAME source", () => {
    // The case this exists for: each uploaded their own copy, so the mediaUrls
    // differ and only the source says they are the same clip.
    const a = video({ id: "a", mediaUrl: "https://cdn/alice.mp4", sourceUrl: "https://tiktok/abc" });
    const b = video({ id: "b", mediaUrl: "https://cdn/bob.mp4", sourceUrl: "https://tiktok/abc" });
    expect(mediaIdentity(a)).toBe(mediaIdentity(b));
  });

  it("never collapses non-video posts, even on a shared source", () => {
    const a: DedupableItem = { id: "a", mediaKind: "image", sourceUrl: "https://s/1" };
    const b: DedupableItem = { id: "b", mediaKind: "image", sourceUrl: "https://s/1" };
    expect(mediaIdentity(a)).not.toBe(mediaIdentity(b));
  });

  it("cannot confuse a mediaUrl with an identical sourceUrl", () => {
    // The prefixes keep a media-keyed entry from matching a source-keyed one.
    const uploaded = video({ id: "a", mediaUrl: "https://x/1.mp4" });
    const downloaded = video({ id: "b", sourceUrl: "https://x/1.mp4" });
    expect(mediaIdentity(uploaded)).not.toBe(mediaIdentity(downloaded));
  });

  it("falls back to the post id when there is no media at all", () => {
    expect(mediaIdentity({ id: "text-1", mediaKind: "text" })).toBe("id:text-1");
  });

  it("treats blank strings as absent rather than as an identity", () => {
    const a = video({ id: "a", streamUid: "  ", sourceUrl: " ", mediaUrl: "https://x/1.mp4" });
    expect(mediaIdentity(a)).toBe("media:https://x/1.mp4");
  });
});

describe("acceptFeedItems", () => {
  it("drops a repeated post id", () => {
    const seen = seenFromItems([video({ id: "a", mediaUrl: "u1" })]);
    expect(acceptFeedItems([video({ id: "a", mediaUrl: "u1" })], seen)).toHaveLength(0);
  });

  it("drops a DIFFERENT post carrying the same video", () => {
    const seen = seenFromItems([video({ id: "a", sourceUrl: "https://tiktok/abc" })]);
    const page = [video({ id: "b", sourceUrl: "https://tiktok/abc" }), video({ id: "c", sourceUrl: "https://tiktok/xyz" })];
    expect(acceptFeedItems(page, seen).map((i) => i.id)).toEqual(["c"]);
  });

  it("de-duplicates WITHIN a single page too", () => {
    const page = [
      video({ id: "a", sourceUrl: "https://s/1" }),
      video({ id: "b", sourceUrl: "https://s/1" }),
      video({ id: "c", sourceUrl: "https://s/2" }),
    ];
    expect(dedupeFeedItems(page).map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("records what it accepted, so the next page sees it", () => {
    const seen = new Set<string>();
    acceptFeedItems([video({ id: "a", sourceUrl: "https://s/1" })], seen);
    expect(acceptFeedItems([video({ id: "b", sourceUrl: "https://s/1" })], seen)).toHaveLength(0);
  });

  it("keeps distinct text posts that share nothing", () => {
    const page: DedupableItem[] = [
      { id: "t1", mediaKind: "text" },
      { id: "t2", mediaKind: "text" },
    ];
    expect(dedupeFeedItems(page)).toHaveLength(2);
  });

  it("handles an absent page without throwing", () => {
    expect(acceptFeedItems(undefined, new Set())).toEqual([]);
  });

  it("preserves the server's order", () => {
    const page = [video({ id: "a" }), video({ id: "b" }), video({ id: "c" })];
    expect(dedupeFeedItems(page).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});
