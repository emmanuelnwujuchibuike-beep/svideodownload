/**
 * Frenz Motion — the app's single haptic vocabulary. Every `navigator.vibrate`
 * call site used to pick its own magic number (6, 8, 10, 12, 18, 35 all showed
 * up independently across a dozen files, each meaning roughly the same thing);
 * this collects them into 4 named intents so a light tap, a selection, and a
 * celebratory moment feel deliberately different but consistent everywhere,
 * the same way `lib/motion/springs.ts` did for spring physics. Near-identical
 * values (6 vs 8, 10 vs 12) are intentionally merged into one shared tier —
 * a handful of distinguishable, reusable intents beats a dozen arbitrary
 * near-duplicate numbers no one could tell apart anyway.
 */

const PATTERNS = {
  /** A light acknowledgement — double-tap-to-Wow, pull-to-refresh trigger,
   *  a seek/step gesture. The most common, lowest-weight buzz. */
  light: 8,
  /** A deliberate action landed — sending a repost/share, a long-press
   *  selection registering. */
  selection: 12,
  /** Something worth celebrating slightly more — a repost/share confirmed,
   *  a milestone-flavored moment. */
  medium: 18,
  /** A rare, maximal moment (e.g. an Easter egg unlock). Used sparingly. */
  strong: 35,
} as const;

export type HapticIntent = keyof typeof PATTERNS;

/** Fire a named haptic. Silently no-ops where the Vibration API is unsupported
 *  (iOS Safari, desktop) — never throws, never needs its own try/catch at the
 *  call site. */
export function haptic(intent: HapticIntent): void {
  try {
    navigator.vibrate?.(PATTERNS[intent]);
  } catch {
    /* unsupported */
  }
}

/** A custom vibration pattern for the rare case a named intent isn't a fit
 *  (e.g. share-sheet's multi-pulse copy-link confirmation). */
export function hapticPattern(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}
