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
/** The three named BANDS. A band sets what the stored preview can hold (below) — the gate. */
export const BLUR_LEVELS = ["light", "medium", "strong"] as const;
export type BlurBand = (typeof BLUR_LEVELS)[number];
/**
 * A post's blur: a named band, or a SLIDER position "b0"…"b100" (0310 — owner, 2026-10-30: "drag it to the right to
 * increase and drag to left to reduce like reducing volume"). The position falls in a band, and the band — never the
 * position — sets the stored preview's size, so the far left is exactly Light: the slider never shows more than Light.
 */
export type BlurLevel = BlurBand | `b${number}`;
export const DEFAULT_BLUR_LEVEL: BlurLevel = "medium";

/** The slider's ends: 0 = Light (the least the stored preview allows), 100 = beyond Strong. */
export const BLUR_AMOUNT_MIN = 0;
export const BLUR_AMOUNT_MAX = 100;
/** Where each named band sits on the slider (a post saved before the slider existed opens there). */
export const BLUR_AMOUNT_FOR: Record<BlurBand, number> = { light: 15, medium: 50, strong: 85 };
/** Band edges on the slider: below 35 is Light, below 70 Medium, the rest Strong (35 rounds to the first Medium step). */
const LIGHT_BELOW = 35;
const MEDIUM_BELOW = 70;

const SLIDER_RE = /^b(\d|[1-9]\d|100)$/;

export function isBlurLevel(v: unknown): v is BlurLevel {
  return typeof v === "string" && ((BLUR_LEVELS as readonly string[]).includes(v) || SLIDER_RE.test(v));
}

/** Anything unknown — a database before 0307, a bad value — is the default. */
export function normalizeBlurLevel(v: unknown): BlurLevel {
  return isBlurLevel(v) ? v : DEFAULT_BLUR_LEVEL;
}

/** A slider position (0–100) for any level — a named band answers its anchor. */
export function blurAmountOf(v: unknown): number {
  const level = normalizeBlurLevel(v);
  return (BLUR_LEVELS as readonly string[]).includes(level) ? BLUR_AMOUNT_FOR[level as BlurBand] : Number(level.slice(1));
}

/** The level a slider position stores. */
export function blurLevelForAmount(amount: number): BlurLevel {
  const n = Math.round(Math.min(BLUR_AMOUNT_MAX, Math.max(BLUR_AMOUNT_MIN, Number.isFinite(amount) ? amount : BLUR_AMOUNT_FOR.medium)));
  return `b${n}`;
}

/** The band a level falls in — what the stored preview is made for. */
export function blurBand(v: unknown): BlurBand {
  const level = normalizeBlurLevel(v);
  if ((BLUR_LEVELS as readonly string[]).includes(level)) return level as BlurBand;
  const n = blurAmountOf(level);
  return n < LIGHT_BELOW ? "light" : n < MEDIUM_BELOW ? "medium" : "strong";
}

/** The blurred clip's width in pixels, per band: the most detail the public clip can hold. */
export const BLUR_CLIP_WIDTH_FOR: Record<BlurBand, number> = { light: 48, medium: 24, strong: 24 };
/** The blurred still's width in pixels, per band. */
export const BLUR_STILL_WIDTH_FOR: Record<BlurBand, number> = { light: 32, medium: 20, strong: 20 };
export const blurClipWidth = (v: unknown): number => BLUR_CLIP_WIDTH_FOR[blurBand(v)];
export const blurStillWidth = (v: unknown): number => BLUR_STILL_WIDTH_FOR[blurBand(v)];

/** Does moving from one level to the other need the stored previews made again (a different size)? */
export function blurPreviewsChange(from: BlurLevel, to: BlurLevel): boolean {
  return blurClipWidth(from) !== blurClipWidth(to) || blurStillWidth(from) !== blurStillWidth(to);
}

/**
 * The CSS blur drawn on top of the preview, as a share of its frame's width (app/globals.css .sub-blur-*): about the
 * same fraction of one clip pixel at any size, so the tiny clip never shows its pixels — "cracking" (owner, 2026-10-30)
 * — whether it fills a full-width card or a small tile. The element the preview fills carries BLUR_FRAME_CLASS.
 */
export const BLUR_CSS_CLASS: Record<BlurBand, string> = { light: "sub-blur-light", medium: "sub-blur-medium", strong: "sub-blur-strong" };
/** The frame a blurred preview fills: the container its blur is measured against. */
export const BLUR_FRAME_CLASS = "sub-blur-frame";
/** A slider position's CSS blur, in eleven steps (app/globals.css .sub-blur-s0 … .sub-blur-s10). */
export const BLUR_SLIDER_STEPS = 10;

export function blurClass(level: unknown): string {
  const v = normalizeBlurLevel(level);
  if ((BLUR_LEVELS as readonly string[]).includes(v)) return BLUR_CSS_CLASS[v as BlurBand];
  return `sub-blur-s${Math.round(blurAmountOf(v) / (BLUR_AMOUNT_MAX / BLUR_SLIDER_STEPS))}`;
}

export const BLUR_LEVEL_LABEL: Record<BlurBand, string> = { light: "Light", medium: "Medium", strong: "Strong" };
/** The hint for any level — its band's. */
export const blurHint = (v: unknown): string => BLUR_LEVEL_HINT[blurBand(v)];
export const BLUR_LEVEL_HINT: Record<BlurBand, string> = {
  light: "Shapes and movement are easy to see — still no detail.",
  medium: "Movement is clear, the picture is not. The default.",
  strong: "Only colour and light — the most hidden.",
};
