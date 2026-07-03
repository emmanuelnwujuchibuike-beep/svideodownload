"use client";

/**
 * Ensures only ONE video plays at a time across the feed and reels. When any
 * player starts, it "claims" playback and the previously-playing element is
 * paused. This keeps the feed calm (no wall of simultaneously-playing clips) and
 * saves bandwidth/CPU on mobile.
 */
let active: HTMLMediaElement | null = null;

export function claimPlayback(el: HTMLMediaElement): void {
  if (active && active !== el) {
    try {
      active.pause();
    } catch {
      /* element may be gone */
    }
  }
  active = el;
}

export function releasePlayback(el: HTMLMediaElement): void {
  if (active === el) active = null;
}

/**
 * Tracks when the page last scrolled, so feed videos can ignore a "tap" that's
 * really the tail end of a scroll gesture (prevents accidentally opening a reel
 * while flicking through the feed). One passive listener for the whole app.
 */
let lastScrollAt = 0;
if (typeof window !== "undefined") {
  window.addEventListener(
    "scroll",
    () => {
      lastScrollAt = Date.now();
    },
    { passive: true, capture: true },
  );
}

export function recentlyScrolled(withinMs = 280): boolean {
  return Date.now() - lastScrollAt < withinMs;
}
