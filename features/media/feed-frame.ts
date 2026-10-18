import type { CSSProperties } from "react";

/*
  The feed's media frame (owner, 2026-10-18): "Videos card doesn't reach width to width … the image
  of 9:16 shouldn't go longer than the screen view, users shouldn't need to scroll to see the full
  length, a view should contain a 9:16 video or image with the next post, user name, title and caption".

  So the frame is ALWAYS the card's full width, and its height is the smaller of
    · the media's own height at that width (a wide clip keeps its true shape, no bars), and
    · the screen less what must share it: the top bar, the creator row, a caption, the action row,
      the top of the next post and the floating nav (~25rem), never below 18rem.
  A tall clip is then shown WHOLE inside it (object-contain) over the blurred backdrop the two
  components already paint — never cropped, never taller than the screen.

  The width basis is the viewport, capped at the feed column (42rem): on a phone the card is the
  full screen width, which is exact; on wider screens it only sets where the height cap starts.
  No container queries, so it holds on older iOS.
*/
export const FEED_MEDIA_CAP = "max(18rem, calc(100svh - 25rem))";

export function feedFrameStyle(ratio: number | null | undefined): CSSProperties {
  const r = ratio && ratio > 0 ? ratio : 4 / 5;
  return { width: "100%", aspectRatio: "auto", height: `min(calc(min(100vw, 42rem) / ${r.toFixed(4)}), ${FEED_MEDIA_CAP})` };
}
