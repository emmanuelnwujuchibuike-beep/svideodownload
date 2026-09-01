"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import type { ExoClickInsSlot } from "./exoclick-sticky";
import { useShowAds } from "./use-show-ads";

/**
 * An ExoClick `<ins>` slot that does not exist until the reader is nearly
 * looking at it — and whose CODE is not in the page until then either.
 *
 * ── Why the landing page needed this ─────────────────────────────────────────
 *
 * Owner, 2026-09-01: "put a multi format slot in the landing page above the
 * storage card and below the explore feature and wallpaper button".
 *
 * `/` is the one route in this project with a hard cold-entry budget (1.6s,
 * and a gzipped ceiling the test in lib/perf/budget.test.ts enforces). Importing
 * `ExoClickSticky` directly into the landing tree would put the whole unit — its
 * config fetch, its observers, its provider loader — into the first-load bundle
 * for a placement most of the way down the page. So the component is
 * `next/dynamic`, and it is not even mounted until the slot approaches the
 * viewport.
 *
 * Same division of responsibility `LazyAdSurface` already proved beside it: the
 * page decides WHERE, the browser decides WHEN, the network decides WHAT. It is
 * a separate file because `LazyAdSurface` wraps an AD ZONE and this wraps an
 * ExoClick snippet slot — two different config systems that deliberately do not
 * share a placement (see the note in top-banner-ad.tsx).
 *
 * ── It reserves NO height ────────────────────────────────────────────────────
 *
 * The same rule as `LazyAdSurface`: a permanent hole between two static landing
 * sections on a zone that does not fill is the "band of dead space" this page
 * has been reported for. `ExoClickSticky` collapses to nothing on its own when
 * there is no tag and no fill, so nothing is lost.
 */
const ExoClickSticky = dynamic(
  () => import("./exoclick-sticky").then((m) => m.ExoClickSticky),
  { ssr: false },
);

export function LazyExoClickSlot({
  slot,
  className,
  /**
   * How far ahead of the viewport to start loading.
   *
   * One screen of lead time on a phone: the creative lands ~4.5s after the ask
   * (measured), so starting only when the slot is already on screen would show
   * the reader an empty space for most of the time they are looking at it.
   */
  rootMargin = "600px 0px",
}: {
  slot: ExoClickInsSlot;
  className?: string;
  rootMargin?: string;
}) {
  const { showAds, ready } = useShowAds();
  const host = useRef<HTMLDivElement | null>(null);
  /**
   * One-way latch: false → true, never back. Scrolling away and returning must
   * not tear the unit down and re-ask — a re-serve is frequently declined, so
   * that trades a working ad for a coin flip (the "navigating destroys the
   * banner" bug, in a different shape).
   */
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    if (eligible || !ready || !showAds) return;
    const el = host.current;
    if (!el) return;

    // No IntersectionObserver (very old browsers): mount immediately rather
    // than never. A missing ad is worse than an early one.
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
      🔴 NO `empty:hidden` HERE, AND A REAL PLACEHOLDER CHILD WHILE WAITING.

      `LazyAdSurface` shipped that exact bug and it silently disabled every
      section-break slot on this page: no child yet → `:empty` matches →
      `display: none` → the element measures 0x0 → the IntersectionObserver never
      reports it visible → `eligible` never flips → it never gets a child. The
      same deadlock as an `<ins>` inside a hidden bar, one level up.
    */
    <div ref={host} className={className}>
      {eligible ? (
        <ExoClickSticky slot={slot} />
      ) : (
        // Inert and effectively zero-height, but a real node, so the box can be
        // measured. No shimmer: an animated skeleton for a slot that may never
        // fill is a compositor job bought for nothing.
        <div aria-hidden className="h-px w-full" />
      )}
    </div>
  );
}
