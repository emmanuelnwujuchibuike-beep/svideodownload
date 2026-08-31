"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";

/**
 * `useLayoutEffect` on the client, `useEffect` on the server — React warns
 * about the former during SSR, and there is no layout to read there anyway.
 */
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Which way the page is currently being scrolled.
 *
 * Owner, 2026-08-31: "i want the bottom nav in the landing pages and download
 * page to hide when scrolling down and the bottom ad banner slot should pop up
 * smoothly like a luxurious design and when a user when to scroll up the bottom
 * nav shows but scrolling down the bottom banner shows, they should transform
 * smoothly and premiumly like a design and not like an ad pop up."
 *
 * ── 🔴 ONE listener for the whole app, not one per subscriber ────────────────
 *
 * Two bars need this answer, and they must never disagree — a frame where the
 * nav has hidden but the banner has not yet risen is the "pop up" the owner is
 * explicitly asking not to see. A module-level store read through
 * `useSyncExternalStore` gives every subscriber the SAME value in the SAME
 * commit, from a single `scroll` listener, however many components mount.
 *
 * It is also the cheap way: this app already scrolls long feeds on low-end
 * phones, and a per-component scroll handler is how a page starts dropping
 * frames while scrolling. The listener is passive, does no layout reads beyond
 * `scrollY`, and coalesces into one `requestAnimationFrame`.
 *
 * ── The thresholds, and what each one prevents ───────────────────────────────
 *
 *  • `THRESHOLD` — direction only flips after 8px of travel in the new
 *    direction. Without it, the one-pixel jitter of a finger resting on a
 *    scrolling page flickers the bars against each other continuously.
 *  • `TOP_ZONE` — near the top of the page the nav is always shown. Arriving
 *    on a page and nudging down a few pixels should not take the navigation
 *    away before the reader has seen it.
 *
 * ── Hydration ────────────────────────────────────────────────────────────────
 *
 * The server snapshot is "up", which is the nav-visible state — identical to
 * what the markup rendered before this existed. So the first client render
 * matches the server HTML and this can never introduce a hydration mismatch.
 */
export type ScrollDirection = "up" | "down";

const THRESHOLD = 8;
const TOP_ZONE = 64;

let direction: ScrollDirection = "up";
let lastY = 0;
let frame = 0;
let started = false;
const listeners = new Set<() => void>();

function publish(next: ScrollDirection): void {
  if (next === direction) return;
  direction = next;
  for (const l of listeners) l();
}

function measure(): void {
  frame = 0;
  const y = window.scrollY;
  const delta = y - lastY;

  // Always show near the top, whatever the last gesture was.
  if (y <= TOP_ZONE) {
    lastY = y;
    publish("up");
    return;
  }
  if (Math.abs(delta) < THRESHOLD) return;
  lastY = y;
  publish(delta > 0 ? "down" : "up");
}

function onScroll(): void {
  // Coalesce a burst of scroll events into one read per frame.
  if (frame) return;
  frame = window.requestAnimationFrame(measure);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!started) {
    started = true;
    lastY = window.scrollY;
    window.addEventListener("scroll", onScroll, { passive: true });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      started = false;
      window.removeEventListener("scroll", onScroll);
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      // Reset so the next mount starts from a shown bar rather than inheriting
      // a stale "down" from a page the reader has already left.
      direction = "up";
    }
  };
}

const getSnapshot = (): ScrollDirection => direction;
/** The server has no scroll position; "up" is the bars-visible default. */
const getServerSnapshot = (): ScrollDirection => "up";

/**
 * Forget the last gesture and re-anchor to the current scroll position.
 *
 * 🔴 THE BUG THIS FIXES (owner, 2026-08-31: "any other page doesnt hide the
 * bottom nav, instead they seems to be a comflict when i enter any other pages
 * causing it to hide entirely in the landing and download page too").
 *
 * `direction` is module state, and `subscribe`'s cleanup only resets it once
 * the listener count reaches ZERO. `MobileNav` is mounted by every layout in
 * the app, so the count never reaches zero and the reset never ran. Scrolling
 * down anywhere — /history, /reels, a settings page, none of which hide their
 * nav — left the store holding "down", and the next visit to `/` or
 * `/downloads` read that stale answer on its first render: nav already
 * translated off-screen, ad bar already risen, before the reader had scrolled
 * at all. Exactly "it hides entirely".
 *
 * `lastY` was stale for the same reason. Arriving on a fresh page at y=0 while
 * `lastY` still held the previous page's 3000 makes the first `measure()`
 * compute a 3000px UPWARD delta from a scroll that never happened.
 *
 * A route change is the natural boundary: a new page has no gesture history, so
 * it starts from the bars-visible default — the same state a full page load
 * gives, which is what nobody has ever reported a problem with.
 */
export function resetScrollDirection(): void {
  lastY = typeof window === "undefined" ? 0 : window.scrollY;
  publish("up");
}

export function useScrollDirection(): ScrollDirection {
  const pathname = usePathname();
  /*
    Layout effect, not a passive one: this must land BEFORE the browser paints
    the new route, or the nav paints one frame in its hidden position and then
    snaps back — a visible flicker on every navigation, and the transform is
    animated, so it would read as the bar sliding in for no reason.
  */
  useIsomorphicLayoutEffect(() => {
    resetScrollDirection();
  }, [pathname]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
