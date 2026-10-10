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

/**
 * The in-page paid CARD takes the creative's OWN shape (owner, 2026-10-10: "the
 * banner don't have to be a fixed size, it should fit in on the ratio of the
 * picture or video, as long as it doesn't cross 320 px width and 500 px height,
 * nothing should be cropped"). No fixed 320 × 200 box, no backdrop bars.
 */
export const CARD_MAX = { width: 320, height: 500 } as const;

/** The card's media box for a w × h creative: its ratio, as large as fits inside CARD_MAX. Unknown size → the old 320 × 200. */
export function cardMediaBox(w: number | null | undefined, h: number | null | undefined, max: { width: number; height: number } = CARD_MAX): { width: number; height: number } {
  if (!w || !h || !(w > 0) || !(h > 0)) return { width: max.width, height: Math.round((max.width * 200) / 320) };
  const scale = Math.min(max.width / w, max.height / h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

/*
 * The Stream fallback (owner, 2026-10-10: "if cloudflare stream storage is full,
 * supabase can be the fallback") — see advertiser-server.ts publishAll.
 */
/** What every browser plays straight from storage — the Stream fallback serves only these (a MOV still needs Stream). */
export const STORAGE_PLAYABLE_VIDEO: ReadonlySet<string> = new Set(["video/mp4", "video/webm"]);
/**
 * The LAST resort only — Stream full AND the worker unreachable: an original is
 * served uncompressed up to this size. Normally the worker compresses it to
 * 480p first (ad-transcode-plan.ts). Deliberately below the bucket's 200 MB
 * (0215): a viewer should never be sent a huge original.
 */
export const ORIGINAL_SERVE_MAX_BYTES = 50 * 1024 * 1024;

/** May a video Stream could not take be served as uploaded from storage instead? */
export function canServeOriginalVideo(mime: string | null | undefined, bytes: number): boolean {
  return STORAGE_PLAYABLE_VIDEO.has(mime ?? "") && bytes > 0 && bytes <= ORIGINAL_SERVE_MAX_BYTES;
}

/** Defaults for a database that has not run 0208 yet — the code must work in both orders. */
export const SPEC_DEFAULTS = { deliveryLongEdge: 1280, imageQuality: 82 } as const;

/**
 * What a VIDEO format may be uploaded at before Stream transcodes it — the 200 MB
 * 0208 gave every video format. A video format whose max_upload_bytes is unset
 * (ALL_SLOTS was created by 0211, after 0208 ran) takes this, so a missing row
 * value can never again mean "every MOV refused, every video over 10 MB refused"
 * (owner, 2026-10-10). An image-only format keeps null: images are resized in
 * the browser, never uploaded large. An admin's own value always wins.
 */
export const DEFAULT_VIDEO_UPLOAD_BYTES = 200 * 1024 * 1024;

export function uploadBytesOf(f: { media_types?: readonly string[] | null; max_upload_bytes?: number | string | null }): number | null {
  if (f.max_upload_bytes != null) return Number(f.max_upload_bytes);
  return f.media_types?.includes("video") ? DEFAULT_VIDEO_UPLOAD_BYTES : null;
}

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
  media_types?: readonly string[] | null;
  delivery_long_edge?: number | null;
  image_quality?: number | null;
  max_duration_seconds?: number | null;
};

export function specOf(f: FormatLike): MediaSpec {
  const served = Number(f.max_file_bytes);
  const cap = uploadBytesOf(f);
  const upload = cap == null ? served : Math.max(served, cap);
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

/** Does a video need transcoding before it can be served? A MOV always does (0209): only MP4 is served. */
export function videoNeedsProcessing(w: number, h: number, bytes: number, spec: MediaSpec, mime?: string | null): boolean {
  return mime === "video/quicktime" || Math.max(w, h) > spec.deliveryLongEdge || bytes > spec.maxServedBytes;
}

/** How a creative of w×h sits in a slot of aspect `slotRatio` (w/h): the box it fills, as fractions of the slot. */
export function containBox(w: number, h: number, slotRatio: number): { width: number; height: number; letterboxed: boolean } {
  const r = w / h;
  if (!(r > 0) || !(slotRatio > 0)) return { width: 1, height: 1, letterboxed: false };
  const letterboxed = Math.abs(r / slotRatio - 1) > 0.02;
  return r > slotRatio ? { width: 1, height: slotRatio / r, letterboxed } : { width: r / slotRatio, height: 1, letterboxed };
}
