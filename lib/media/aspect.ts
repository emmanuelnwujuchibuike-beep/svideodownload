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
