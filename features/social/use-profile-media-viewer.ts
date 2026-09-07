"use client";

import { useCallback, useState } from "react";

import type { FeedItem } from "@/lib/social/home-feed";
import type { PostCard } from "@/lib/social/posts";

/**
 * Opens profile media in the REAL feed viewers instead of a bespoke player.
 *
 * Owner, 2026-08-24: "This video and image view in profile look too empty and
 * too hard for users to engage, I want all engagement should be on the screen
 * like a reels without needing to click on open post... all engagement, post
 * menu and all should display, including the clear screen button... Every media
 * should go to the next when slide down or up. Double tap center should wow...
 * double tap right should fast forward, while left for backward, and press hold
 * to full screen, tap once centre to pause."
 *
 * ── Every one of those already exists, in ReelsFeed ────────────────────────
 * The profile grid opened a bespoke `ProfileVideoPlayer` (deleted 2026-08-24) — a second, weaker player with
 * its own gesture handling, no engagement rail, and an "Open post" link
 * standing in for the interactions it could not offer. Meanwhile `ReelsFeed`
 * has the engagement rail, the wow burst, the comments sheet, the post menu,
 * clear-screen, vertical paging and the full double-tap/hold gesture model,
 * all of it already tuned over many rounds of this owner's feedback.
 *
 * So this does not reimplement any of that. It converts the tapped `PostCard`s
 * into `FeedItem`s — the shape the real viewers consume — and hands them over.
 * `components/social/post-grid.tsx` already does exactly this for Explore; the
 * profile was the one grid that never adopted it.
 *
 * ── Why the WHOLE set is fetched, not just the tapped item ─────────────────
 * "Every media should go to the next when slide down or up" is the requirement
 * that decides this. ReelsFeed pages through `initialItems`, so a single item
 * would open with full engagement but nothing to swipe to. The set is fetched
 * in parallel on an explicit tap and capped, so it is one bounded burst rather
 * than anything ambient.
 *
 * 🔴 The tapped item is resolved FIRST and separately. If it were part of the
 * same `Promise.all`, opening would wait for the slowest unrelated request in
 * the batch — a tap has to feel instant, and the neighbours are only needed by
 * the time someone swipes.
 */

/** Bounded so a profile with hundreds of posts cannot fan out on one tap. */
const MAX_PRELOAD = 24;

/**
 * The preload window is centred on the TAPPED tile, not on the start of the grid.
 *
 * Owner, 2026-09-03: "when I click on a media on the bottom in profile media
 * grid, it take me to the first one automatically and plays it."
 *
 * 🔴 That was this. The neighbour fetch was `posts.slice(0, MAX_PRELOAD)` — the
 * first 24 posts, from the top of the grid, whatever was tapped. On a profile
 * with more than 24 posts, tapping anything below the 24th produced an
 * `ordered` list that DID NOT CONTAIN THE TAPPED ITEM. Replacing `items` with
 * it left `startId` pointing at nothing, so the viewer fell back to the first
 * clip and played it — the wrong video, opened instantly, exactly as reported.
 *
 * It also meant those tiles had no neighbours to swipe to even when they did
 * open correctly, which is the other half of the same mistake.
 *
 * A window centred on the tap fixes both: the tapped item is in it by
 * construction, and there is something to swipe to in BOTH directions, which is
 * what "go to the next when slide down or up" actually asks for.
 */
function preloadWindow<T>(all: T[], tappedIndex: number): T[] {
  if (all.length <= MAX_PRELOAD) return all;
  const half = Math.floor(MAX_PRELOAD / 2);
  // Clamp so a tap near either end still gets a full window rather than a
  // truncated one — the last tile deserves as many neighbours as the middle.
  const start = Math.min(Math.max(0, tappedIndex - half), all.length - MAX_PRELOAD);
  return all.slice(start, start + MAX_PRELOAD);
}

async function toFeedItem(id: string): Promise<FeedItem | null> {
  try {
    const res = await fetch(`/api/posts/${id}/feed-item`);
    if (!res.ok) return null;
    const json = await res.json();
    return (json.item as FeedItem) ?? null;
  } catch {
    return null;
  }
}

export function useProfileMediaViewer(posts: PostCard[]) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [startId, setStartId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const open = useCallback(
    async (post: PostCard) => {
      if (loadingId) return;
      setLoadingId(post.id);
      try {
        const tapped = await toFeedItem(post.id);
        if (!tapped) {
          // Fall back to the real page rather than silently doing nothing —
          // the same recovery PostGrid uses.
          window.location.href = `/p/${post.id}`;
          return;
        }
        // Open immediately on the tapped item.
        setItems([tapped]);
        setStartId(post.id);

        /*
          Then fill in the neighbours so swiping has somewhere to go. Ordered
          exactly as the grid is, so "next" means the next tile — a viewer whose
          order disagrees with the grid it was opened from is disorienting.
          Replacing `items` here does NOT remount ReelsFeed (its key is stable),
          and `startId` keeps the tapped clip pinned where it already is.
        */
        const tappedIndex = Math.max(0, posts.findIndex((p) => p.id === post.id));
        // NOT named `window` — that shadows the global, and the failure path
        // above calls `window.location.href`.
        const preloadSet = preloadWindow(posts, tappedIndex);
        const neighbours = preloadSet.filter((p) => p.id !== post.id);
        const resolved = await Promise.all(neighbours.map((p) => toFeedItem(p.id)));
        const byId = new Map<string, FeedItem>([[tapped.id, tapped]]);
        resolved.forEach((it) => {
          if (it) byId.set(it.id, it);
        });
        const ordered = preloadSet
          .map((p) => byId.get(p.id))
          .filter((it): it is FeedItem => !!it);
        /*
          Never swap in a list that has lost the tapped item. `startId` is what
          pins the viewer to what was actually tapped, so a list without it
          silently reopens on something else — the bug this window fixes, and
          the guard that stops any future version of it reaching the screen.
        */
        if (ordered.length > 1 && ordered.some((it) => it.id === tapped.id)) setItems(ordered);
      } finally {
        setLoadingId(null);
      }
    },
    [loadingId, posts],
  );

  const close = useCallback(() => {
    setItems(null);
    setStartId(null);
  }, []);

  const current = items && startId ? items.find((i) => i.id === startId) : null;

  return {
    items,
    startId,
    loadingId,
    open,
    close,
    /** True when the tapped media is a video — decides which viewer opens. */
    isVideo: !!current && current.mediaKind === "video",
    /** Albums and single photos both belong in the image viewer. */
    isImage:
      !!current &&
      current.mediaKind !== "video" &&
      ((current.mediaItems?.length ?? 0) > 1 || current.mediaKind === "image"),
  };
}
