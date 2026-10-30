/*
  The frame every blurred exclusive preview sits in (owner, 2026-10-30: "the exclusive media card in the users profile has
  sharp edges", and a slide that "doesn't show to the right edge unless swipe").

  · ROUNDED_CLIP — iOS Safari composites a playing <video> and a CSS-blurred layer on their own, and draws them past a
    parent's rounded corners even with overflow hidden. A mask on the frame makes Safari clip them to the curve; the
    isolation keeps the blur inside the frame's own layer.
  · BLUR_COVER — the blurred layer covers its frame edge to edge: it fills the frame and is scaled past it, so the soft,
    see-through rim a CSS blur leaves at an element's edge lies outside the frame (clipped), never inside it as a dark band.
*/
export const ROUNDED_CLIP = "isolate overflow-hidden [-webkit-mask-image:-webkit-radial-gradient(white,black)] [transform:translateZ(0)]";
export const BLUR_COVER = "absolute inset-0 h-full w-full scale-[1.15] object-cover";
