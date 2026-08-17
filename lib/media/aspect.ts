/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FEED'S SHARED "HOW TALL CAN MEDIA GET" RULE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 REVERSED 2026-08-17 (owner, with X/Twitter reference screenshots: "in
 * twitter video size how depends on the size, it doesnt give a fied size and
 * occupy the space with black bakground"). The 2026-08-16 brief directly
 * below asked for "like Twitter" but the mechanism it built was the OPPOSITE
 * of Twitter's real one: it forced every post's container into a fixed 4:5–
 * 16:9 band and letterboxed (blurred-fill) anything that didn't match, where
 * real Twitter/X applies NO ratio floor or ceiling at all — a post's media
 * renders at its own true aspect, full width, and the only limit is a MAX
 * HEIGHT (not a locked ratio). This function now returns the media's real,
 * unclamped ratio; a max-height CSS cap on the actual `<video>`/`<img>`
 * elements (see feed-video.tsx / feed-image.tsx) is what keeps a
 * pathologically tall clip from taking over the screen — and unlike the old
 * ratio clamp, it never produces a mismatched box for `object-contain` to
 * letterbox inside, because the container's shape IS the media's shape.
 *
 * ── The original 2026-08-16 brief, kept for context ─────────────────────────
 * "the feed should be premium like Twitter and thread, every long video or
 * image should shrink on the feed like Twitter… it should be two [posts]
 * that will be able to show complete like Twitter and thread style… show
 * full in reels only when clicked." The "shrink" and "two per screen" goals
 * are still real — they're now met by the max-height cap instead of a ratio
 * clamp, which was solving them by producing letterboxed, not truly full,
 * media.
 */
export function clampFeedRatio(w?: number | null, h?: number | null): number | null {
  if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
}
