import type { CSSProperties } from "react";

/*
  The feed's media frame.

  🔴 FULL WIDTH, NEVER CROPPED, NO BLUR (owner, 2026-10-22: "I don't want those side blur, it should
  be full screen, full width in feed not blur, it should be full width and never cropped"). This
  REPLACES the 2026-10-18 frame, which capped the height to the screen and showed a tall clip whole
  inside it (object-contain) — the cap is what left the blurred side bars beside every portrait clip.

  So the frame is always the card's full width, and its height is simply the media's own height at
  that width: its true shape, nothing cut off and no space left over. The media fills it exactly
  (object-cover on a box of the media's own ratio crops nothing). Before the real shape is known (an
  older post with no stored size) the box is 4:5 and corrects itself on the media's first metadata.
*/
export const FEED_FALLBACK_RATIO = 4 / 5;

export function feedFrameStyle(ratio: number | null | undefined): CSSProperties {
  const r = ratio && ratio > 0 ? ratio : FEED_FALLBACK_RATIO;
  return { width: "100%", aspectRatio: String(r.toFixed(4)) };
}
