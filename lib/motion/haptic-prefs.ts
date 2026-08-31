"use client";

/**
 * Whether this DEVICE wants haptic feedback.
 *
 * Owner, 2026-08-30: "Make users to be able to turn off and on haptic click
 * sound in profile settings."
 *
 * ── Why haptics needed this and sounds did not ────────────────────────────────
 *
 * `playSound` has been gated on a stored preference since it was written
 * (`getCachedSoundPrefs().masterEnabled`). `haptic()` had NO gate of any kind —
 * every one of the ~40 call sites across the app vibrated unconditionally, with
 * no way for anyone to stop it. So the sound half of this request was already
 * built and the haptic half did not exist at all.
 *
 * ── Device-local, not account-synced, and that is deliberate ──────────────────
 *
 * A haptic preference is about the hardware in your hand, not about who you
 * are. Someone who silences vibration on a phone at work does not mean to
 * silence it on their tablet at home, and syncing it would do exactly that.
 * localStorage is therefore the RIGHT store here, not a shortcut — the same
 * reasoning the theme preference uses.
 *
 * ── Read synchronously, cached in a module ────────────────────────────────────
 *
 * `haptic()` is called from inside click handlers on the landing page's hot
 * path. It cannot afford to touch localStorage on every tap — a `getItem` in a
 * tap handler is a synchronous main-thread read during the one frame that has
 * to stay responsive. The value is read once, memoised, and updated in place
 * when the toggle writes it.
 */

const KEY = "frenz:haptics-enabled";

/** `null` = not read yet. Haptics default ON, matching every prior release. */
let cached: boolean | null = null;

export function hapticsEnabled(): boolean {
  if (cached !== null) return cached;
  if (typeof window === "undefined") return true;
  try {
    // Anything other than an explicit "0" means on — so a corrupted or
    // partially-written value fails toward the behaviour every existing user
    // already has, rather than silently disabling their haptics.
    cached = window.localStorage.getItem(KEY) !== "0";
  } catch {
    // Private mode / storage blocked. Not a reason to change how the app feels.
    cached = true;
  }
  return cached;
}

export function setHapticsEnabled(on: boolean): void {
  cached = on;
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* The in-memory value still applies for this session. */
  }
  // Let any other mounted toggle reflect the change without a prop drill.
  try {
    window.dispatchEvent(new CustomEvent(HAPTICS_CHANGED, { detail: on }));
  } catch {
    /* never let a notification break the setting */
  }
}

export const HAPTICS_CHANGED = "frenz:haptics-changed";
