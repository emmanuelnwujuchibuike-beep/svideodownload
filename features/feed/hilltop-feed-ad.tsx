"use client";

import { useEffect, useRef, useState } from "react";

import { HilltopSlot } from "@/features/monetization/hilltop-slot";

/**
 * A HilltopAds banner inside the scrolling feed.
 *
 * Owner's brief §3B: "Ads must visually fit the existing feed. Do not make ads
 * look like normal user posts in a deceptive way. Clearly distinguish
 * sponsored/ad content … Lazy-load the ad only when it approaches the viewport."
 *
 * ── Labelled, and not disguised ───────────────────────────────────────────────
 *
 * 🔴 The "Sponsored" label is not decoration and is not optional. An in-feed
 * unit styled to sit among posts, WITHOUT it, is an ad disguised as editorial
 * content — a dark pattern, and specifically an AdSense policy violation on a
 * site that has already been refused three times. `AdSurface` supplies this for
 * the existing `feed_inline` zone; a raw Hilltop script has no such wrapper, so
 * the label is supplied here.
 *
 * ── Lazy, and one-way ─────────────────────────────────────────────────────────
 *
 * Nothing is requested until the slot is within a screen of the viewport, and
 * the latch never flips back: scrolling away and returning must not tear the
 * unit down and re-ask, which would spend a second impression on one reader and
 * re-run the loader mid-scroll. Same rule as `FeedAdSlot` and `LazyExoClickSlot`.
 *
 * ── It reserves no height ─────────────────────────────────────────────────────
 *
 * A zone with no demand collapses to nothing rather than leaving a hole in the
 * timeline. The label renders only once the slot has decided to mount, so an
 * unconfigured or switched-off Hilltop leaves the feed byte-for-byte as it was.
 */
export function HilltopFeedAd() {
  const host = useRef<HTMLDivElement | null>(null);
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    if (eligible) return;
    const el = host.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setEligible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setEligible(true);
        obs.disconnect();
      },
      // One screen of lead time, the same as every other lazy slot here.
      { rootMargin: "600px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [eligible]);

  return (
    <div ref={host} className="my-4 first:mt-0">
      {eligible ? (
        <>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
            Sponsored
          </p>
          <HilltopSlot slot="feed" />
        </>
      ) : (
        // Inert and effectively zero-height, but a real node so the box can be
        // measured. No shimmer: an animated skeleton for a slot that may never
        // fill is a compositor job bought for nothing, on the surface where
        // scrolling performance matters most.
        <div aria-hidden className="h-px w-full" />
      )}
    </div>
  );
}
