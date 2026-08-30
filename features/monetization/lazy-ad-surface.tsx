"use client";

import { useEffect, useRef, useState } from "react";

import type { AdZone } from "@/lib/monetization/types";
import { cn } from "@/lib/utils";

import { AdSurface } from "./ad-surface";
import { useShowAds } from "./use-show-ads";

/**
 * `AdSurface`, but it does not exist until the reader is nearly looking at it.
 *
 * ── Why the landing page needed this ──────────────────────────────────────────
 *
 * The section-break placement renders at up to EIGHT positions on the marketing
 * landing page — the one route in this project with a hard cold-entry budget
 * (1.6s, 275 kB gzipped) and a CLS history that was once measured at 0.684. A
 * plain `AdSurface` at each break would request ad data for all eight on every
 * cold visit, including the seven below a fold most visitors never pass, and
 * then let eight third-party creatives land during the LCP window.
 *
 * This is the same division of responsibility `FeedAdSlot` already proved for
 * the social feed — the page decides WHERE, the browser decides WHEN, the
 * network decides WHAT — generalised so any zone can use it. `FeedAdSlot` keeps
 * its own file because it also owns the feed's reserved-height/CLS contract and
 * its own slot-id analytics.
 *
 * ── It reserves NO height ─────────────────────────────────────────────────────
 *
 * Deliberately unlike `FeedAdSlot`. A reserved box is right inside an infinite
 * scroll, where an ad arriving mid-scroll would shove posts the reader is
 * looking at. Between two static landing sections there is nothing below to
 * shove that the reader has already read, and a permanent 250px hole at every
 * section break on an unfilled zone is far worse than the alternative — it is
 * the "band of dead space" this page has been reported for twice.
 */
export function LazyAdSurface({
  zone,
  className,
  maxWidth,
  /** Passed straight through — see `AdSurface`. */
  fullBleed,
  /**
   * How far ahead of the viewport to start loading.
   *
   * One screen of lead time on a phone: enough for the round trip to finish
   * before the slot is actually looked at, without fetching for content the
   * reader may never reach.
   */
  rootMargin = "600px 0px",
}: {
  zone: AdZone;
  className?: string;
  maxWidth?: string;
  fullBleed?: boolean;
  rootMargin?: string;
}) {
  const { showAds, ready } = useShowAds();
  const host = useRef<HTMLDivElement | null>(null);
  /**
   * One-way latch: false → true, never back. Scrolling away and returning must
   * not re-request the ad, which is what would make a long page re-initialise
   * every unit the reader scrolls past twice.
   */
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    if (eligible || !ready || !showAds) return;
    const el = host.current;
    if (!el) return;

    // No IntersectionObserver (very old browsers): load immediately rather than
    // never. A missing ad is worse than an early one.
    if (typeof IntersectionObserver === "undefined") {
      setEligible(true);
      return;
    }

    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setEligible(true);
        // This observer's whole job is done. Leaving eight of them attached
        // across a long scroll is exactly the accumulated per-item work that
        // shows up as jank on a phone.
        obs.disconnect();
      },
      { rootMargin },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [eligible, ready, showAds, rootMargin]);

  // Premium members and an unresolved plan render nothing at all — `ready`
  // matters, since rendering early would flash an ad-shaped gap at a subscriber.
  if (!ready || !showAds) return null;

  return (
    /*
      🔴 NO `empty:hidden` ON THE OBSERVED ELEMENT, and a placeholder child
      while waiting (fixed 2026-08-30).

      This was `className="empty:hidden"` with a `null` child until eligible —
      which is a deadlock, and it silently disabled every section-break slot on
      the landing page:

        no child yet  ->  `:empty` matches  ->  display:none
          ->  the element measures 0x0
            ->  the IntersectionObserver never reports it visible
              ->  `eligible` never flips
                ->  it never gets a child

      Verified live: the landing page filled 2 ad slots and none of them were
      section breaks, on a 12,031px page that was scrolled end to end four
      times. `FeedAdSlot` never had this bug because it always renders an inert
      placeholder — the same reason it is done here now.

      Collapsing when the zone turns out to be empty is `AdSurface`'s job, and it
      already does it by rendering nothing at all, so nothing is lost.
    */
    <div ref={host} className={className}>
      {eligible ? (
        <AdSurface zone={zone} maxWidth={maxWidth} fullBleed={fullBleed} />
      ) : (
        // Inert and zero-height, but a real node — it exists so the box can be
        // measured. No shimmer: an animated skeleton at every section break
        // would run a compositor job for slots that may never fill.
        <div aria-hidden className="h-px w-full" />
      )}
    </div>
  );
}
