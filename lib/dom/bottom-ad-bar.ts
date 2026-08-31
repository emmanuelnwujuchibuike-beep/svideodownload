"use client";

import { useSyncExternalStore } from "react";

/**
 * Is there a REAL, FILLED ad bar docked at the bottom of the screen right now?
 *
 * ── The bug this exists to make impossible (owner, 2026-08-31) ───────────────
 *
 * "other pages still doesnt hide the bottom nav and show the bottom banner,
 * instead something like white line like the ad slot but the bottom nav still
 * persist and on landing and download page the bottom nav hides but no bottom
 * banner shows"
 *
 * Two symptoms, one cause: the nav and the ad bar were each deciding for
 * themselves, from different inputs, and nothing made them agree.
 *
 *  • `MobileNav` hid on scroll purely from the PATHNAME (`/` or `/downloads`),
 *    on the premise that the ad bar would rise into the space it vacated. When
 *    the bar had nothing to show — no configured zone, or a configured one that
 *    did not fill — the nav slid away and NOTHING replaced it. The navigation
 *    simply left.
 *  • `TopBannerAd` decided it was visible from `hasExoBottomNav`, which means
 *    "an ExoClick banner is CONFIGURED", not "an ad is on screen". A configured
 *    zone that does not fill still rendered the bar's border and padding: a thin
 *    white line above the nav, framing nothing. Which is the same "never draw a
 *    box around nothing" rule the ad slots already live by.
 *
 * So the bar publishes one honest fact — "I am on screen with a creative in me"
 * — and the nav reads it. The nav can now only step aside for something that
 * genuinely exists, on any page, without either of them knowing a route name.
 *
 * Deliberately a module store read through `useSyncExternalStore`, exactly like
 * `use-scroll-direction`: the two bars must agree WITHIN ONE COMMIT, and a
 * context provider would have to be threaded through two route-group layouts
 * that do not share a parent below the root.
 */

let present = false;
const listeners = new Set<() => void>();

/** Called by the ad bar. Idempotent — only a real change notifies. */
export function setBottomAdBarPresent(next: boolean): void {
  if (next === present) return;
  present = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): boolean => present;
/**
 * The server cannot know whether an ad filled, and the honest default is "no":
 * it renders the nav in its normal, visible position — which is what the markup
 * did before any of this existed, so it can never cause a hydration mismatch.
 */
const getServerSnapshot = (): boolean => false;

export function useBottomAdBarPresent(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
