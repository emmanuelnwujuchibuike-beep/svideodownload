/**
 * How a creative's size relates to where it is shown — ONE set of rules for
 * the upload, the preview, the server check and the serving (owner, 2026-10-09:
 * "Read the actual dimensions and aspect ratio from the canonical ad-slot
 * registry. Do not hard-code dimensions separately …").
 *
 * The four sizes, never confused:
 *   display      the physical slot's shape          → slot-registry.ts `aspect`
 *   recommended  advice to the advertiser           → ad_formats.width / height
 *   upload max   what may be sent at all            → ad_formats.max_width / max_height
 *                (orientation-agnostic), max_upload_bytes
 *   delivery     what is actually served            → ad_formats.delivery_long_edge,
 *                                                     image_quality, max_file_bytes
 *
 * A slot's shape NEVER forces the creative's shape: every creative is shown
 * whole ("contain") inside its slot, over a soft backdrop of itself — no
 * stretching, no squeezing, no cropping (FIT_RULE).
 *
 * Pure and dependency-free: imported by the browser and the server alike.
 */

/** Never crop, never distort: the whole creative, centred, with space around it where the shapes differ. */
export const FIT_RULE = "contain" as const;

/** Defaults for a database that has not run 0208 yet — the code must work in both orders. */
export const SPEC_DEFAULTS = { deliveryLongEdge: 1280, imageQuality: 82 } as const;

/**
 * Decompression-bomb guard for images decoded in the browser: a tiny file that
 * claims 50 000 × 50 000 px would allocate gigabytes. Checked from the header
 * BEFORE anything is decoded.
 */
export const MAX_DECODE_PIXELS = 60_000_000;

export interface MediaSpec {
  /** advice only */
  recommendedWidth: number | null;
  recommendedHeight: number | null;
  /** upload caps, orientation-agnostic (a 3840×2160 video passes a 2160×3840 cap) */
  maxWidth: number;
  maxHeight: number;
  maxUploadBytes: number;
  /** delivery */
  deliveryLongEdge: number;
  imageQuality: number;
  maxServedBytes: number;
  maxDurationSeconds: number | null;
}

type FormatLike = {
  width?: number | null;
  height?: number | null;
  max_width: number;
  max_height: number;
  max_file_bytes: number | string;
  max_upload_bytes?: number | string | null;
  delivery_long_edge?: number | null;
  image_quality?: number | null;
  max_duration_seconds?: number | null;
};

export function specOf(f: FormatLike): MediaSpec {
  const served = Number(f.max_file_bytes);
  const upload = f.max_upload_bytes == null ? served : Math.max(served, Number(f.max_upload_bytes));
  return {
    recommendedWidth: f.width ?? null,
    recommendedHeight: f.height ?? null,
    maxWidth: f.max_width,
    maxHeight: f.max_height,
    maxUploadBytes: upload,
    deliveryLongEdge: f.delivery_long_edge ?? SPEC_DEFAULTS.deliveryLongEdge,
    imageQuality: f.image_quality ?? SPEC_DEFAULTS.imageQuality,
    maxServedBytes: served,
    maxDurationSeconds: f.max_duration_seconds ?? null,
  };
}

/** Within the upload caps, whichever way round the media is. */
export function withinUploadCaps(w: number, h: number, maxW: number, maxH: number): boolean {
  return Math.max(w, h) <= Math.max(maxW, maxH) && Math.min(w, h) <= Math.min(maxW, maxH);
}

/**
 * The largest size with the SAME proportions whose long edge is at most
 * `longEdge` — never enlarged. Rounded to even numbers (video encoders need them).
 */
export function fitWithin(w: number, h: number, longEdge: number): { width: number; height: number } {
  const scale = Math.min(1, longEdge / Math.max(w, h));
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return scale >= 1 ? { width: w, height: h } : { width: even(w), height: even(h) };
}

/** Does an image need re-encoding before upload? (too large, or too heavy to serve) */
export function imageNeedsOptimizing(w: number, h: number, bytes: number, mime: string, spec: MediaSpec): boolean {
  if (Math.max(w, h) > spec.deliveryLongEdge) return true;
  if (bytes > spec.maxServedBytes) return true;
  // PNG/JPEG over 300 kB re-encode to WebP for delivery; small files are left exactly as made
  return mime !== "image/webp" && mime !== "image/avif" && bytes > 300 * 1024;
}

/** Does a video need transcoding before it can be served? */
export function videoNeedsProcessing(w: number, h: number, bytes: number, spec: MediaSpec): boolean {
  return Math.max(w, h) > spec.deliveryLongEdge || bytes > spec.maxServedBytes;
}

/** How a creative of w×h sits in a slot of aspect `slotRatio` (w/h): the box it fills, as fractions of the slot. */
export function containBox(w: number, h: number, slotRatio: number): { width: number; height: number; letterboxed: boolean } {
  const r = w / h;
  if (!(r > 0) || !(slotRatio > 0)) return { width: 1, height: 1, letterboxed: false };
  const letterboxed = Math.abs(r / slotRatio - 1) > 0.02;
  return r > slotRatio ? { width: 1, height: slotRatio / r, letterboxed } : { width: r / slotRatio, height: 1, letterboxed };
}
