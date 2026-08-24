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
        const neighbours = posts.slice(0, MAX_PRELOAD).filter((p) => p.id !== post.id);
        const resolved = await Promise.all(neighbours.map((p) => toFeedItem(p.id)));
        const byId = new Map<string, FeedItem>([[tapped.id, tapped]]);
        resolved.forEach((it) => {
          if (it) byId.set(it.id, it);
        });
        const ordered = posts
          .slice(0, MAX_PRELOAD)
          .map((p) => byId.get(p.id))
          .filter((it): it is FeedItem => !!it);
        if (ordered.length > 1) setItems(ordered);
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
