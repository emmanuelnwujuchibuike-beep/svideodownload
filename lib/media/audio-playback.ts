"use client";

/**
 * Independent audio playback for the video feed.
 *
 * The whole feed autoplays MUTED via the HTML `muted` attribute, which browsers
 * allow without user interaction AND — crucially — without taking audio focus.
 * That's what lets someone keep listening to Spotify / Apple Music / a podcast /
 * Bluetooth audio while they scroll: a muted <video> plays no audio track and
 * never touches the device media session.
 *
 * We therefore NEVER:
 *   • use the Web Audio API (AudioContext / GainNode),
 *   • create hidden or silent-looping <audio> elements,
 *   • call navigator.mediaSession,
 *   • request audio focus on autoplay.
 *
 * The ONLY moment audio focus is taken is when the user explicitly taps unmute —
 * and even then we ramp the volume in gently so it never "pops". This module is
 * the single, documented home for that behavior so every surface stays consistent.
 */

const timers = new WeakMap<HTMLMediaElement, number>();

/** Ramp an element's volume to `to` over `ms` using rAF (no Web Audio). */
export function fadeVolume(el: HTMLMediaElement, to: number, ms = 200): void {
  const prev = timers.get(el);
  if (prev) cancelAnimationFrame(prev);
  const from = el.volume;
  if (ms <= 0 || from === to) {
    el.volume = to;
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    el.volume = from + (to - from) * t;
    if (t < 1) timers.set(el, requestAnimationFrame(step));
    else timers.delete(el);
  };
  timers.set(el, requestAnimationFrame(step));
}

/**
 * Unmute a video on the user's explicit tap, fading the sound in (150–250ms) so
 * it's smooth. This is the one and only place we intentionally take audio focus.
 */
export function unmuteWithFade(el: HTMLMediaElement, ms = 200): void {
  el.volume = 0;
  el.muted = false;
  void el.play().catch(() => {});
  fadeVolume(el, 1, ms);
}

/** Mute a video instantly and reset volume so the next unmute fade starts clean. */
export function muteInstant(el: HTMLMediaElement): void {
  const prev = timers.get(el);
  if (prev) cancelAnimationFrame(prev);
  timers.delete(el);
  el.muted = true;
  el.volume = 1;
}
