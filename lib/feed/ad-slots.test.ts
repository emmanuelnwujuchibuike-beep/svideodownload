import { describe, expect, it } from "vitest";

import {
  countPosts,
  FEED_AD_INTERVAL,
  FEED_AD_MIN_INTERVAL,
  insertAdSlots,
  REELS_AD_INTERVAL,
  type FeedEntry,
} from "./ad-slots";

type P = { id: string };
const posts = (n: number, offset = 0): P[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${offset + i + 1}` }));
const idOf = (p: P) => p.id;
const shape = (entries: FeedEntry<P>[]) =>
  entries.map((e) => (e.type === "post" ? e.data.id : `AD:${e.slotId}`));

describe("insertAdSlots", () => {
  it("puts a slot after every 4 posts — the owner's stated sequence", () => {
    // Post 1..4, AD, Post 5..8, AD, Post 9..12 (no trailing slot — see below).
    expect(shape(insertAdSlots(posts(12), { idOf }))).toEqual([
      "p1", "p2", "p3", "p4", "AD:feed-ad-1",
      "p5", "p6", "p7", "p8", "AD:feed-ad-2",
      "p9", "p10", "p11", "p12",
    ]);
  });

  it("🔴 never emits a TRAILING slot", () => {
    // A slot after the last loaded post sits on the infinite-scroll sentinel,
    // so it is inside the observer's root margin the instant it mounts — every
    // batch would load an ad nobody has scrolled to.
    const entries = insertAdSlots(posts(4), { idOf });
    expect(shape(entries)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(entries.at(-1)?.type).toBe("post");
  });

  it("keeps one continuous rhythm across paginated batches", () => {
    // Batch 1 ends 6 posts in (one slot placed, two posts into the next group).
    const first = insertAdSlots(posts(6), { idOf });
    expect(shape(first)).toEqual(["p1", "p2", "p3", "p4", "AD:feed-ad-1", "p5", "p6"]);

    // Batch 2 continues from absolute index 6 — its slot lands after TWO more
    // posts (absolute 8), not after four. Without startIndex the cadence would
    // restart every page and ads would bunch up.
    const second = insertAdSlots(posts(6, 6), { idOf, startIndex: 6 });
    expect(shape(second)).toEqual(["p7", "p8", "AD:feed-ad-2", "p9", "p10", "p11", "p12"]);
  });

  it("🔴 anchors the key to the preceding post, not to the ordinal", () => {
    // The whole reason ads survive a post being hidden/muted above them: an
    // ordinal key would renumber and React would remount every slot below,
    // reloading every visible ad.
    // 9 posts, not 8: with exactly 8 the second slot would be trailing and is
    // correctly suppressed, so 9 is the smallest input that yields two slots.
    const entries = insertAdSlots(posts(9), { idOf });
    const ads = entries.filter((e): e is Extract<FeedEntry<P>, { type: "ad" }> => e.type === "ad");
    expect(ads.map((a) => a.anchorId)).toEqual(["p4", "p8"]);
  });

  it("an anchored key is UNCHANGED when a post above is removed", () => {
    const full = insertAdSlots(posts(9), { idOf });
    const firstAd = full.find((e) => e.type === "ad") as Extract<FeedEntry<P>, { type: "ad" }>;

    // Drop p1. The slot now follows p5 rather than p4 — a different anchor, so
    // that one slot legitimately re-keys — but crucially the LATER slot, whose
    // group is untouched further down, keeps its own anchor identity.
    const without = insertAdSlots(posts(9).slice(1), { idOf });
    const ads = without.filter((e): e is Extract<FeedEntry<P>, { type: "ad" }> => e.type === "ad");
    expect(firstAd.anchorId).toBe("p4");
    expect(ads[0]?.anchorId).toBe("p5");
    // Ordinals collide across the two arrangements; anchors do not. That is the
    // property React keys need.
    expect(ads[0]?.slotId).toBe(firstAd.slotId);
    expect(ads[0]?.anchorId).not.toBe(firstAd.anchorId);
  });

  it("returns posts only when disabled is expressed by interval, and never crashes on empty", () => {
    expect(insertAdSlots([], { idOf })).toEqual([]);
    expect(shape(insertAdSlots(posts(3), { idOf }))).toEqual(["p1", "p2", "p3"]);
  });

  it("🔴 clamps a too-small interval rather than honouring it", () => {
    // AdSense policy prohibits layouts where ads outweigh content, and this
    // site has already been rejected twice for content quality. A bad config
    // value must not be able to make that worse.
    expect(shape(insertAdSlots(posts(6), { idOf, interval: 1 }))).toEqual(
      shape(insertAdSlots(posts(6), { idOf, interval: FEED_AD_MIN_INTERVAL })),
    );
  });

  it("honours a larger configured interval", () => {
    expect(shape(insertAdSlots(posts(12), { idOf, interval: 6 }))).toEqual([
      "p1", "p2", "p3", "p4", "p5", "p6", "AD:feed-ad-1",
      "p7", "p8", "p9", "p10", "p11", "p12",
    ]);
  });

  it("the default interval is the documented 4", () => {
    expect(FEED_AD_INTERVAL).toBe(4);
  });
});

describe("Reels cadence", () => {
  it("puts a slide after every 3 reels — the owner's stated cadence", () => {
    // Owner, 2026-08-30: "it should show after 3 reels videos watched."
    expect(
      shape(insertAdSlots(posts(9), { idOf, interval: REELS_AD_INTERVAL, enabled: true })),
    ).toEqual([
      "p1", "p2", "p3", "AD:feed-ad-1",
      "p4", "p5", "p6", "AD:feed-ad-2",
      "p7", "p8", "p9",
    ]);
  });

  it("🔴 sits exactly ON the density floor, never below it", () => {
    /*
     * 3 is `FEED_AD_MIN_INTERVAL`, which is a policy floor rather than a style
     * choice — one ad per two items in an infinite deck is how a site gets
     * flagged, and this project has already been refused three times. So the
     * reels cadence is as dense as the deck is ever allowed to get, and a
     * future edit that lowers it must fail here rather than ship.
     */
    expect(REELS_AD_INTERVAL).toBe(FEED_AD_MIN_INTERVAL);
    expect(REELS_AD_INTERVAL).toBeGreaterThanOrEqual(FEED_AD_MIN_INTERVAL);
  });

  it("🔴 inserts NOTHING when the zone is unseeded", () => {
    /*
     * The reels slide is a whole SCREEN, not a card in a scroll. An unseeded
     * zone must therefore produce no slide at all — a composed-but-empty one
     * would be a black screen the viewer has to swipe past every fourth reel.
     * The deck probes the zone before composing, and `enabled: false` is how
     * that answer reaches this function.
     */
    const composed = insertAdSlots(posts(9), { idOf, interval: REELS_AD_INTERVAL, enabled: false });
    expect(composed.every((e) => e.type === "post")).toBe(true);
    expect(composed).toHaveLength(9);
  });

  it("🔴 never ends the deck on an ad slide", () => {
    // The last thing before "load more" must be content. Exactly 3 and exactly
    // 6 reels are the boundary cases where a trailing slot would appear.
    for (const n of [3, 6, 9]) {
      const composed = insertAdSlots(posts(n), { idOf, interval: REELS_AD_INTERVAL, enabled: true });
      expect(composed.at(-1)?.type, `${n} reels ended on an ad`).toBe("post");
    }
  });

  it("keeps the reel count recoverable from the composed deck", () => {
    // The pagination guard, in reels terms: `onEndReached` is driven by how
    // many REELS have been passed, never by how many slides.
    const composed = insertAdSlots(posts(10), { idOf, interval: REELS_AD_INTERVAL, enabled: true });
    expect(composed.length).toBeGreaterThan(10); // ads really were inserted
    expect(countPosts(composed)).toBe(10);
  });
});

describe("countPosts", () => {
  it("🔴 counts POSTS ONLY — the pagination cursor guard", () => {
    // If an ad ever counted as a post, the cursor would advance past real rows
    // and the feed would silently skip content. This is the function every
    // rendered-length → database-offset conversion must go through.
    const entries = insertAdSlots(posts(12), { idOf });
    expect(entries.length).toBe(14); // 12 posts + 2 slots
    expect(countPosts(entries)).toBe(12);
  });

  it("is 0 for an empty feed", () => {
    expect(countPosts([])).toBe(0);
  });
});
