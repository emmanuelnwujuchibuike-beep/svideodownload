/**
 * How blurry a locked exclusive post looks to a non-subscriber — the CREATOR's choice, per post (owner, 2026-10-30:
 * "Make users be able to set how blurry they want the post to be", and "the auto play should be obvious movement not
 * too much thick blurred that the auto play doesn't even show").
 *
 * Two things make the blur, and a level sets both:
 *   · the STORED preview's size — the blurred clip and still are made this many pixels wide, so the detail beyond that
 *     never exists in the public file (lib/media/make-blur-clip.ts, lib/sub/blur-clip-plan.ts, lib/sub/blur-preview.ts);
 *   · the CSS blur drawn on top — the look only, never the gate.
 *
 * Medium (the default) keeps the 24 px clip and 20 px still every post already has, with a far lighter CSS blur than
 * before (blur-xl, 24 px), so the movement shows. Strong is the old look. Light stores a 48 px clip and a 32 px still —
 * a post that changes to or from Light gets its previews made again at the new size (lib/sub/posts.ts).
 *
 * Pure: shared by the server, the worker and the browser.
 */
export const BLUR_LEVELS = ["light", "medium", "strong"] as const;
export type BlurLevel = (typeof BLUR_LEVELS)[number];
export const DEFAULT_BLUR_LEVEL: BlurLevel = "medium";

export function isBlurLevel(v: unknown): v is BlurLevel {
  return typeof v === "string" && (BLUR_LEVELS as readonly string[]).includes(v);
}

/** Anything unknown — a database before 0307, a bad value — is the default. */
export function normalizeBlurLevel(v: unknown): BlurLevel {
  return isBlurLevel(v) ? v : DEFAULT_BLUR_LEVEL;
}

/** The blurred clip's width in pixels: the most detail the public clip can hold. */
export const BLUR_CLIP_WIDTH_FOR: Record<BlurLevel, number> = { light: 48, medium: 24, strong: 24 };
/** The blurred still's width in pixels. */
export const BLUR_STILL_WIDTH_FOR: Record<BlurLevel, number> = { light: 32, medium: 20, strong: 20 };

/** Does moving from one level to the other need the stored previews made again (a different size)? */
export function blurPreviewsChange(from: BlurLevel, to: BlurLevel): boolean {
  return BLUR_CLIP_WIDTH_FOR[from] !== BLUR_CLIP_WIDTH_FOR[to] || BLUR_STILL_WIDTH_FOR[from] !== BLUR_STILL_WIDTH_FOR[to];
}

/** The CSS blur drawn on top of the preview — written out in full so Tailwind generates each class. */
export const BLUR_CSS_CLASS: Record<BlurLevel, string> = { light: "blur-[3px]", medium: "blur-[7px]", strong: "blur-[16px]" };

export function blurClass(level: unknown): string {
  return BLUR_CSS_CLASS[normalizeBlurLevel(level)];
}

export const BLUR_LEVEL_LABEL: Record<BlurLevel, string> = { light: "Light", medium: "Medium", strong: "Strong" };
export const BLUR_LEVEL_HINT: Record<BlurLevel, string> = {
  light: "Shapes and movement are easy to see — still no detail.",
  medium: "Movement is clear, the picture is not. The default.",
  strong: "Only colour and light — the most hidden.",
};
