import type { CSSProperties } from "react";

/*
  The feed's media frame.

  FULL WIDTH, NO BLUR (owner, 2026-10-22: "I don't want those side blur, it should be full screen, full width in
  feed not blur"). The frame is always the card's full width and the media fills it (object-cover).

  🔴 TALL MEDIA STOPS AT A HEIGHT CAP (owner, 2026-10-23, marking the spot on a screenshot: "medias in the feed
  should go full length when they're long, they should have a height cap at the place I marked"). Measured from
  that screenshot: the mark sits 1.17 × the screen width below the top of the media, so a frame is never taller
  than 7 : 6 (height : width). A photo or clip at or below that height keeps its own shape and nothing is cut; a
  longer one fills the capped frame, trimmed evenly top and bottom (object-cover, centred). This REPLACES the
  2026-10-22 "never cropped" frame, which let a 9:16 clip run past the bottom nav.

  Before the real shape is known (an older post with no stored size) the box is 4:5 and corrects itself on the
  media's first metadata.
*/
export const FEED_FALLBACK_RATIO = 4 / 5;
/** The tallest a feed frame gets: height = 7/6 × width (the owner's mark), i.e. width : height never below 6 : 7. */
export const FEED_MIN_RATIO = 6 / 7;

export function feedFrameRatio(ratio: number | null | undefined): number {
  const r = ratio && ratio > 0 ? ratio : FEED_FALLBACK_RATIO;
  return Math.max(r, FEED_MIN_RATIO);
}

export function feedFrameStyle(ratio: number | null | undefined): CSSProperties {
  return { width: "100%", aspectRatio: String(feedFrameRatio(ratio).toFixed(4)) };
}
