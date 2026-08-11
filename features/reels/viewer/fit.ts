/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  HOW A CLIP IS FITTED TO THE SCREEN — one rule, in one place
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This lived inline in `reel-viewer.tsx` and has been rewritten by three
 * different instructions from the owner. Each rewrite was correct about the
 * case in front of it and each one broke a case it was not looking at, which is
 * what a rule that cannot be tested does. It is a pure function now, with the
 * whole history as its specification.
 *
 * ── The instructions, in order ─────────────────────────────────────────────
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
 *    edge of the screen. See `LETTERBOX` below.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 *
 *   fill the screen  ⟺  cropping ≤ 1.5%  OR  the clip is at least 9:16 tall
 *
 * The first arm is free: at 1.5% nothing meaningful is lost — a few pixels,
 * never a face, a caption or a subtitle. The second arm is the owner's "at all
 * cost", scoped to the shape that instruction is about.
 */

/**
 * A clip at or below this width ÷ height counts as a "long" vertical video.
 *
 * 9:16 is 0.5625, so this admits the standard reel shape and everything taller,
 * and excludes 2:3 (0.667), 3:4 (0.75), 4:5 (0.8), square and every landscape
 * shape. Those are the "shorter videos" that keep their own size.
 */
export const TALL_CLIP_ASPECT = 0.6;

/** The largest fraction `cover` may silently discard when the shapes nearly match. */
export const FREE_CROP = 0.015;

/**
 * Should a clip of this shape fill the screen edge to edge?
 *
 * Both arguments are width ÷ height. Returns false for a degenerate size (a
 * `<video>` reports 0x0 until metadata arrives, and an unknown clip must never
 * be cropped on a guess).
 */
export function shouldFullBleed(clipAspect: number, screenAspect: number): boolean {
  if (!Number.isFinite(clipAspect) || clipAspect <= 0) return false;
  if (!Number.isFinite(screenAspect) || screenAspect <= 0) return false;
  // The ACTUAL fraction `cover` would discard — the quantity the first
  // instruction is about, which a ratio difference is not.
  const cropped =
    clipAspect > screenAspect ? 1 - screenAspect / clipAspect : 1 - clipAspect / screenAspect;
  return cropped <= FREE_CROP || clipAspect <= TALL_CLIP_ASPECT;
}

/** Screen aspect for the current viewport. Callers in effects/handlers only. */
export function viewportAspect(): number {
  if (typeof window === "undefined") return 0;
  return window.innerWidth / window.innerHeight;
}
