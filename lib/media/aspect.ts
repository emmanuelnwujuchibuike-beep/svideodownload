/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FEED'S SHARED "HOW TALL CAN MEDIA GET" RULE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner brief (2026-08-16): "the feed should be premium like Twitter and
 * thread, every long video or image should shrink on the feed like Twitter…
 * it should be two [posts] that will be able to show complete like Twitter
 * and thread style… show full in reels only when clicked."
 *
 * ── Why the ceiling is an ASPECT RATIO, not a viewport-height guess ────────
 *
 * A portrait clip or photo at its raw shape can run up to 16:9 rotated —
 * height = 1.78× its own width — and that is what made one post occupy most
 * of a screen: nothing was wrong with any single post, there just wasn't a
 * budget. The fix caps TALLNESS RELATIVE TO WIDTH at 4:5 (height = 1.25×
 * width) — Instagram and Threads' own feed cap, for the same reason: unlike a
 * `vh` cap, a width-relative ratio produces the same proportions on a phone,
 * a tablet, or a 4K monitor, and needs no knowledge of the viewport's height
 * to compute. Two posts capped this way, plus their header/caption/action
 * chrome, are what makes "roughly two per screen" true across device sizes
 * rather than only at whichever one screen height it was tuned against.
 *
 * The WIDE end is untouched (16:9, height = 0.5625× width) — landscape media
 * was never the complaint; it is already short.
 *
 * ── Why this never crops ────────────────────────────────────────────────────
 *
 * This clamps the CONTAINER, not the media. Every consumer renders its actual
 * video/image with `object-contain` inside a box sized to this ratio, so
 * anything taller than 4:5 is shown SMALLER, letterboxed within the box —
 * shrunk to fit, exactly the "never crop" rule this app holds everywhere else
 * (see the story-viewer and reel-viewer notes on `object-contain` vs
 * `object-cover`). The full, uncapped frame is one tap away — into the
 * fullscreen Reels/Image viewer, which is where "show full… only when
 * clicked" already happens; this ratio applies to the inline feed card only.
 */
export function clampFeedRatio(w?: number | null, h?: number | null): number | null {
  if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return Math.min(16 / 9, Math.max(4 / 5, w / h));
}
