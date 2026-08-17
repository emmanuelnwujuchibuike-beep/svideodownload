/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  HOW A CLIP IS FITTED TO THE SCREEN — one rule, in one place
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 REVERSED 2026-08-17 — a full "premium edge-to-edge media viewer" spec,
 * with its own numbered acceptance tests, states as PRIORITY #1 (above even
 * "maintain existing functionality"): "NEVER crop any part of the user's
 * original media" — explicitly including a standard 9:16 clip (test 1:
 * "9:16 portrait — Expected: FULL MEDIA VISIBLE, NO CROP, NO DISTORTION").
 * This directly overrides the second instruction in the history below
 * ("long views should reach the safe area at all cost"), which is the ONE
 * documented case this file's whole three-instruction history exists to
 * protect — flagged to the owner explicitly before this rewrite, who
 * confirmed the new spec wins even for that case. `shouldFullBleed` now
 * always returns false: nothing crops, ever, regardless of shape or how
 * closely it matches the screen. The fit is `object-contain` unconditionally
 * in `reel-viewer.tsx` now — see that file's own media-layer note for how
 * the unused space is filled (a blurred backdrop, not a crop).
 *
 * The full three-instruction history is kept below, unedited, because it is
 * still the reason a "never crop" rule this absolute needed confirming
 * explicitly rather than assumed — the SAME product had an "at all cost"
 * edge-to-edge instruction for this exact shape once already.
 *
 * ── The instructions, in order (superseded, kept for history) ──────────────
 *
 * 1. "make reels videos not to ever crop width when trying to go full edge to
 *    edge, only videos capable of full edge to edge should be full edge to
 *    edge … avoid width or height cropping out."
 *
 *    The version before that tested whether the aspect ratio was within 22% of
 *    the screen's. A RATIO DIFFERENCE is not the amount lost, and 22% is
 *    enormous: on a 393x851 phone (0.462) the band ran from 0.360 to 0.563, so
 *    a standard 9:16 clip qualified and roughly a fifth of it was thrown away.
 *
 * 2. "i want it to go full screen to the safe area but shorter videos should
 *    show their respective size but long views should reach the safe area at
 *    all cost."
 *
 *    So a second, deliberate route to full bleed: a clip at least as vertical as
 *    9:16 fills the screen even though `cover` trims its sides.
 *
 * 3. "even square short videos in reels are also stretching, i said only long
 *    videos."
 *
 *    Square never took route 2 — 1.0 is nowhere near 0.6 — and it cannot take
 *    route 1 either. What made it LOOK stretched was the letterbox treatment,
 *    not the fit: the bands behind it were filled with an overscanned, blurred
 *    copy of the same frame at 75% opacity, so the picture visibly ran to every
 *    edge of the screen. The 2026-08-17 spec's own background layer is the
 *    same idea done correctly this time: the blur sits ONLY behind an honest,
 *    uncropped foreground, never behind a foreground that's ALSO being zoomed
 *    by `cover` — the two effects stacked is what actually read as "stretched"
 *    before, not the blur alone.
 *
 * ── The rule (2026-08-17) ────────────────────────────────────────────────
 *
 *   fill the screen  ⟺  never. `shouldFullBleed` always returns false.
 */

/**
 * A clip at or below this width ÷ height counts as a "long" vertical video.
 * Kept only as a documented constant for `fit.test.ts`'s shape-boundary
 * check — no longer read by `shouldFullBleed` itself.
 */
export const TALL_CLIP_ASPECT = 0.6;

/** No longer used by `shouldFullBleed` (nothing crops "for free" anymore) —
 *  kept so any lingering import doesn't break; safe to remove once nothing
 *  references it. */
export const FREE_CROP = 0.015;

/**
 * Should a clip of this shape fill the screen edge to edge (i.e. crop)?
 *
 * 🔴 Always false as of 2026-08-17 — see the file header. The parameters are
 * kept (rather than deleting the function and touching every call site) so
 * `reel-viewer.tsx` can still call this the same way; it just never says yes.
 */
export function shouldFullBleed(clipAspect: number, screenAspect: number): boolean {
  void clipAspect;
  void screenAspect;
  return false;
}

/** Screen aspect for the current viewport. Callers in effects/handlers only. */
export function viewportAspect(): number {
  if (typeof window === "undefined") return 0;
  return window.innerWidth / window.innerHeight;
}
