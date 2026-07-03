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
