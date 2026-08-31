"use client";

import { useSyncExternalStore } from "react";

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

export function useScrollDirection(): ScrollDirection {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
