/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FEED'S SHARED "HOW TALL CAN MEDIA GET" RULE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 SETTLED 2026-08-17, after several same-day revisions. Owner's full set
 * of constraints, taken together: media must reach the card's FULL width
 * ("increase the width... i want the post to reach the extreme end of the
 * right side"); never cropped ("dont crop tall image or video"); and the
 * width must be REAL content, not a blurred backdrop standing in for it
 * ("remember the width shouldnt include the black blurred background").
 *
 * Those three, together, leave no room for a ratio floor or a tight
 * max-height: for a fixed full width and an UNCLAMPED true ratio with
 * `object-contain`, height is fully determined (`width / ratio`) — there is
 * no free dimension left to cap without breaking one of the three
 * constraints above. So this function is back to the media's real,
 * unclamped ratio (no floor, no ceiling — a landscape and a portrait clip
 * are each exactly their own shape), and the max-height on the actual
 * elements (`feed-image.tsx`/`feed-video.tsx`) is set generously enough
 * that it essentially never triggers for realistic phone-shot content —
 * true last-resort protection against a genuinely pathological upload
 * (a 1:20 image, say), not a routine compactness lever. The owner's
 * "the current height is already okay" meant they'd already accepted
 * that fixing width would mean SOME posts render taller than the
 * previous, over-tight cap allowed — not that height must stay pinned to
 * a specific pixel value.
 */
export function clampFeedRatio(w?: number | null, h?: number | null): number | null {
  if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ONE EXCEPTION TO "NEVER CROP" — REELS-SHAPED MEDIA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 2026-08-17, after the owner saw the never-crop rule ship: "16:9 should
 * reach full edge to edge, it can crop a little if necessary to reach there
 * but image size below 16:9 shouldn't crop… reels should reach the safe area
 * with videos from 16:9 upwards and below should stay fixed."
 *
 * This narrows, rather than reverses, the never-crop rule confirmed earlier
 * the same day. Everything below this ratio (4:5, 1:1, landscape — anything
 * LESS tall than standard reels video) keeps object-contain + a blurred
 * backdrop exactly as shipped, unchanged. Only media at or beyond standard
 * reels tallness — 9:16 and narrower, the shape every "reels/wallpaper full
 * screen" reference in this app already assumes — is allowed the same
 * object-cover treatment `wallpaper-reels.tsx` has always used. A real phone
 * screen is taller than 9:16 (closer to 9:19.5-20), so even a "perfect" 9:16
 * clip still loses a sliver off one axis to fill it — that sliver is the
 * "crop a little if necessary" the owner explicitly asked for, scoped to
 * exactly this shape class and no other.
 */
export const REELS_SHAPE_RATIO = 9 / 16;

/** True once a clip/photo is at or beyond standard reels tallness — see the
 *  note above for why only this class is allowed to crop to fill. */
export function isReelsShaped(ratio: number | null): boolean {
  return ratio !== null && ratio <= REELS_SHAPE_RATIO;
}
