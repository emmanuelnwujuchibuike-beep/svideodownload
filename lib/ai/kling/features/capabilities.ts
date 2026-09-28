/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KLING 3.0 OMNI — what the model actually accepts (PURE, verified 2026-09-28)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 3: "Do not infer capability from Replicate Kling models, fal.ai
 * Kling adapters, third-party wrappers, old Kling O1 documentation, unofficial
 * SDKs or previous repository assumptions. The direct API is the source of
 * truth."
 *
 * ── 🔴 THIS FILE IS NOT lib/ai/character-replace/providers/kling-input.ts ───
 *
 * That file holds `KLING_O1_EDIT_LIMITS`, read from **fal.ai's published
 * schema for Kling O1 Video Edit** on 2026-09-21. It is correct for what it
 * describes and is still live in production behind the fal adapter. It is
 * also, for Omni, WRONG in at least three ways:
 *
 *      O1 Video Edit (fal)          →   3.0 Omni (direct)
 *      3–10 s                           3–15 s
 *      720–2160 px, min edge 720        720P / 1080P / 4K modes
 *      4 elements+images, always        7 images with NO video;
 *                                       4 elements+images WITH a video
 *
 * Copying the O1 numbers into Omni would silently cap every generation at ten
 * seconds and refuse a seventh reference image the model would have accepted.
 * So Omni gets its own table, here, and the two never import each other.
 *
 * ── Where these numbers come from ──────────────────────────────────────────
 *
 * ✅ Kling's own model guide, read 2026-09-28
 *    (kling.ai/quickstart/klingai-video-3-omni-model-user-guide) — this page
 *    is server-rendered and readable, unlike the API reference. It is the
 *    source for: the supported generation modes, "Up to 15s", the 720p/1080p
 *    modes, "up to 7 images (min 300px, max 10MB, .jpg/.jpeg/.png)" without a
 *    video, "up to 4 images/elements total plus one video (3-10s, ≤200MB, ≤2K)"
 *    with one, character elements as up to 4 multi-angle images or a 3–8 s
 *    clip, native audio output, and voice binding at 5–30 s.
 *
 * ⚠️ The REQUEST FIELD NAMES below (`image_list`, `element_list`, `video_list`,
 *    `multi_prompt`, `mode`, `sound`, …) could not be read from Kling's own
 *    API reference: kling.ai/document-api is a client-rendered app that
 *    returns a bare title to any non-browser fetch, on every one of its pages
 *    (retried on 2026-09-28 across four URLs). They are corroborated by
 *    several independent mirrors that agree with each other and with the
 *    envelope Part 2 already implements. **Every field here is one a
 *    published source names — nothing is invented — but a live key must
 *    confirm them before a member's money depends on one.** That confirmation
 *    is Part 4's first task, and nothing in Part 3 routes a member to Kling.
 */

/** The model this file describes. A different model needs a different table. */
export const KLING_OMNI_MODEL_NAME = "kling-v3-omni";

/** `mode` — the vendor's quality tiers, and the resolution each one means. */
export const KLING_OMNI_MODES = ["std", "pro", "4k"] as const;
export type KlingOmniMode = (typeof KLING_OMNI_MODES)[number];
export const KLING_OMNI_MODE_RESOLUTION: Record<KlingOmniMode, string> = { std: "720P", pro: "1080P", "4k": "4K" };

export const KLING_OMNI_ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export type KlingOmniAspectRatio = (typeof KLING_OMNI_ASPECT_RATIOS)[number];

/** `sound` — Omni's native audio. Off is the safe default; see `soundAllowedWithVideo`. */
export const KLING_OMNI_SOUND = ["on", "off"] as const;
export type KlingOmniSound = (typeof KLING_OMNI_SOUND)[number];

export const KLING_OMNI = {
  /** ✅ "Up to 15s" — three times what the O1 adapter allows, and the single most important difference. */
  duration: { minSeconds: 3, maxSeconds: 15, defaultSeconds: 5 },
  prompt: { maxChars: 2500 },
  /** Multi-shot: a list of shots, each with its own prompt and duration. */
  multiShot: { minShots: 1, maxShots: 6 },
  modes: KLING_OMNI_MODES,
  defaultMode: "pro" as KlingOmniMode,
  aspectRatios: KLING_OMNI_ASPECT_RATIOS,
  defaultAspectRatio: "16:9" as KlingOmniAspectRatio,

  /**
   * ✅ Reference images. The ceiling DEPENDS on whether a video is supplied —
   * the one Omni rule an O1-shaped validator gets wrong in both directions.
   */
  images: {
    withoutVideo: { max: 7 },
    /** With a video, images AND elements share one budget of four. */
    withVideo: { maxImagesAndElementsCombined: 4 },
    minEdgePx: 300,
    maxBytes: 10 * 1024 * 1024,
    /** ✅ The guide names these three. Not WebP, not AVIF, whatever our own picker accepts. */
    mimeTypes: ["image/jpeg", "image/png"] as const,
    extensions: [".jpg", ".jpeg", ".png"] as const,
    /** `image_list[].type` — which end of the clip an image pins. */
    frameTypes: ["first_frame", "end_frame"] as const,
  },

  /** ✅ A character/subject element: several angles of one person, or a short clip of them. */
  element: {
    maxImagesPerElement: 4,
    clip: { minSeconds: 3, maxSeconds: 8 },
    /** Voice bound to an element; the guide recommends this window for a multi-image subject. */
    voice: { minSeconds: 5, maxSeconds: 30 },
  },

  /** ✅ The reference/base video. Note this is still 3–10 s even though OUTPUT reaches 15 s. */
  video: {
    minSeconds: 3,
    maxSeconds: 10,
    maxBytes: 200 * 1024 * 1024,
    /** "≤2K" in the guide. 2560 is the conventional reading of 2K for a long edge. */
    maxEdgePx: 2560,
    maxCount: 1,
    /** `video_list[].refer_type` — `base` is the clip being rebuilt; `feature` is style/motion guidance. */
    referTypes: ["base", "feature"] as const,
  },

  /**
   * ✅ "must be `off` with reference video" — a rule worth naming rather than
   * leaving as a magic condition inside one handler, because two handlers
   * accept a video and both must obey it.
   */
  soundAllowedWithVideo: false,
} as const;

export type KlingOmniFrameType = (typeof KLING_OMNI.images.frameTypes)[number];
export type KlingOmniReferType = (typeof KLING_OMNI.video.referTypes)[number];

/**
 * How many images a request may carry, given whether it also carries a video
 * and how many elements it uses. The whole point of stating it as a function
 * is that no handler has to remember the interaction.
 */
export function klingOmniImageBudget(opts: { hasVideo: boolean; elementCount: number }): number {
  if (!opts.hasVideo) return KLING_OMNI.images.withoutVideo.max;
  return Math.max(0, KLING_OMNI.images.withVideo.maxImagesAndElementsCombined - opts.elementCount);
}

/**
 * Omni's placeholder syntax: a prompt names a reference by position rather
 * than describing it. `<<<element_1>>>` is the first entry of `element_list`,
 * `<<<video_1>>>` the first of `video_list`.
 *
 * Exposed as functions so the numbering lives in one place — an off-by-one
 * here points the model at the wrong person.
 */
export function klingElementRef(oneBasedIndex: number): string {
  return `<<<element_${oneBasedIndex}>>>`;
}
export function klingVideoRef(oneBasedIndex: number): string {
  return `<<<video_${oneBasedIndex}>>>`;
}

/** Seconds as the vendor writes them on the wire: `duration` is a STRING. */
export function klingDurationValue(seconds: number): string {
  return String(Math.round(seconds));
}
