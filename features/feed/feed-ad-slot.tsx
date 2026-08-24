"use client";

import { useEffect, useRef, useState } from "react";

import { AdSurface } from "@/features/monetization/ad-surface";
import { useShowAds } from "@/features/monetization/use-show-ads";
import { FEED_AD_ROOT_MARGIN } from "@/lib/feed/ad-slots";
import { cn } from "@/lib/utils";

/**
 * One in-feed advertisement slot.
 *
 * Owner, 2026-08-24: the feed ad system, "one of most important part in
 * frenzsave cause this is where more revenue comes when users scroll" — and
 * the constraint attached to it: "it shouldnt break the performance, and
 * professionallism."
 *
 * ── What this component IS, and what it deliberately is not ────────────────
 * It is the WHEN, and only the WHEN. The server decides where slots exist
 * (lib/feed/ad-slots.ts); the existing zone stack decides what fills them
 * (features/monetization/ad-slot.tsx, which already handles AdSense units,
 * script blobs, display creatives and impression/click tracking for every
 * network the admin has configured). This file adds the one thing neither of
 * those provides: a slot that costs nothing until the reader is nearly at it.
 *
 * Building a parallel ad stack here would have meant a second script loader, a
 * second impression pipeline and a second place for a network to be wired —
 * see the note on `zone` below for why reusing the existing one is also what
 * makes "criteo and all adnetwork" a configuration change rather than a code
 * change.
 *
 * ── Isolation from the feed's other systems ────────────────────────────────
 * It touches none of them, by construction:
 *
 *   • VIDEO — it owns no `<video>` and never calls into
 *     `lib/media/video-coordinator.ts`, so it cannot enter the
 *     largest-visible-video calculation, cannot claim playback, and cannot
 *     cause a clip to pause, buffer or remount. Its observer is its own; it is
 *     deliberately NOT merged with the video observers.
 *   • SCROLL-REVEAL — no scroll listener of any kind, on this element or the
 *     page. One IntersectionObserver, which the browser evaluates off the main
 *     thread, so fast scrolling costs no JavaScript here at all.
 *   • PAGINATION — it renders no sentinel and reports nothing upward. The
 *     cursor is computed from posts only (see `countPosts`).
 *   • RENDER — after the first intersection it stops observing and never sets
 *     state again, so it cannot re-render the feed.
 */

/**
 * Reserved height, before anything is known about the ad.
 *
 * 🔴 THIS IS THE LAYOUT-SHIFT FIX (§8). Without a reserved box, an ad arriving
 * mid-scroll shoves every post below it downward — the single most damaging
 * thing an in-feed ad can do, and the reason CLS regressions get blamed on
 * monetisation. The value is a compromise: tall enough that a typical
 * responsive unit lands inside it, short enough that a slot which never fills
 * is not a screenful of nothing.
 *
 * Once the slot resolves, the box takes its real height — collapsing entirely
 * when there is no ad, which is the "do not create excessive blank space if an
 * ad fails to load" half of the same requirement.
 */
const RESERVED_MIN_HEIGHT = "min-h-[250px] sm:min-h-[280px]";

export function FeedAdSlot({
  slotId,
  className,
}: {
  /** Ordinal id (`feed-ad-1`) — analytics and debugging only; see ad-slots.ts. */
  slotId: string;
  className?: string;
}) {
  const { showAds, ready } = useShowAds();
  const host = useRef<HTMLDivElement | null>(null);
  /**
   * 🔴 ONE-WAY LATCH (§10: "An ad slot must only initialize once").
   *
   * State, not a ref, because it has to trigger the single render that mounts
   * the ad — but it only ever goes false → true. Scrolling back up, a feed
   * state change, a tab switch, a video changing playback state and an
   * unrelated prop change all leave it true, so the ad is never re-requested.
   */
  const [eligible, setEligible] = useState(false);
  /** Whether the zone actually produced an ad. Null until it answers. */
  const [filled, setFilled] = useState<boolean | null>(null);

  useEffect(() => {
    // Nothing to watch for once eligible — and disconnecting is what guarantees
    // the observer cannot fire a second time on the way back up.
    if (eligible || !ready || !showAds) return;
    const el = host.current;
    if (!el) return;

    // No IntersectionObserver (very old browsers): load immediately rather than
    // never. A missing ad is worse than an early one, and this path is rare
    // enough that the eager fetch costs nothing in aggregate.
    if (typeof IntersectionObserver === "undefined") {
      setEligible(true);
      return;
    }

    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setEligible(true);
        // Stop immediately: this observer's whole job is done, and leaving it
        // attached across a long scrolling session is exactly the kind of
        // accumulated per-item work that shows up as jank on a phone.
        obs.disconnect();
      },
      { rootMargin: FEED_AD_ROOT_MARGIN },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [eligible, ready, showAds]);

  // Premium members and an unresolved plan render NOTHING — not even the
  // reserved box. `ready` matters: rendering before the plan resolves would
  // flash an ad-shaped hole at a paying subscriber on every feed load.
  if (!ready || !showAds) return null;

  return (
    <div
      ref={host}
      data-feed-ad-slot={slotId}
      className={cn(
        "my-4 first:mt-0",
        /*
          The reserved box applies only while the outcome is unknown. Once the
          zone reports back, an unfilled slot collapses to nothing (no label, no
          border, no gap) and a filled one is sized by its own creative — so the
          reservation prevents the shift without leaving a permanent hole when
          there is no demand, no configured row, or an ad blocker.
        */
        filled === null && RESERVED_MIN_HEIGHT,
        className,
      )}
    >
      {eligible ? (
        /*
          `zone="feed_inline"` is the seam that makes future networks a
          configuration change (owner: "make it be set for adsense, criteo and
          all adnetwork that are potentially to work with in future so it wont
          be difficult to make addition to any future feed ad network").

          An admin row for this zone can be an AdSense unit, an arbitrary script
          tag — which is the shape Criteo, Taboola, Outbrain and essentially
          every header-bidding/native network ship, and which the slot already
          renders inside a sandboxed iframe — or a hosted creative. Adding a
          network means adding a row in the admin, not touching the feed.

          🔴 `AdSurface`, not a bare `AdSlot`. The surface supplies the
          "Sponsored" label, and a native in-feed unit styled to match the posts
          around it is, WITHOUT that label, an ad disguised as editorial
          content — a dark pattern, and specifically an AdSense policy
          violation on a site that has already been rejected twice. It also
          means this placement inherits the same card treatment as every other
          one instead of inventing a second look.
        */
        <AdSurface zone="feed_inline" maxWidth="max-w-2xl" onResolved={setFilled} />
      ) : (
        /*
          The placeholder is deliberately inert — no shimmer, no animation, no
          "Advertisement" label. An animated skeleton here would run a compositor
          job for every upcoming slot in a long feed, and labelling a box that
          may never fill advertises an absence. AdSurface/AdSlot label the real
          thing once it exists.
        */
        <div aria-hidden className="h-full w-full" />
      )}
    </div>
  );
}
