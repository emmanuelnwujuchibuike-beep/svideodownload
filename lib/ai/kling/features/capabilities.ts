/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KLING — what the models actually accept (PURE, VERIFIED 2026-09-28)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 4 §5: "Use the official Kling API documentation and verify the
 * live API contract before routing production traffic… Do not rely blindly on
 * mirrors or assumptions from previous code. The actual live Kling API contract
 * must be treated as authoritative."
 *
 * It was verified with a real key. The evidence — every probe, every vendor
 * error message quoted verbatim — is in
 * `docs/AI_PROVIDER_MIGRATION_PART4_KLING_CONTRACT.md`.
 *
 * ── 🔴 WHAT PART 3 HAD, AND WHY IT COULD NEVER HAVE WORKED ──────────────────
 *
 * Part 3 built this table from mirrors and marked the request field names ⚠️.
 * Every one of them was wrong:
 *
 *      Part 3 (guessed)            live API (verified)
 *      image_list[]                contents[] with type "image"/"first_frame"
 *      element_list[]              contents[] with type "element"
 *      video_list[] + refer_type   contents[] with type "video"
 *      multi_prompt[] + shot_type  settings.multi_shot
 *      mode: std|pro|4k            settings.resolution: 480p|720p|1080p|4k
 *      sound: on|off               settings.audio: native|off
 *      end_frame                   last_frame
 *      model_name in the body      the model is a PATH segment
 *      callback_url top-level      options.callback_url
 *
 * The last one is the dangerous one: unknown top-level fields are IGNORED, not
 * rejected, so a Part 3 request would have been accepted, generated, BILLED and
 * never called back.
 *
 * ── 🔴 THIS FILE IS NOT character-replace/providers/kling-input.ts ──────────
 *
 * That file holds `KLING_O1_EDIT_LIMITS`, read from **fal.ai's** schema for
 * Kling O1 Video Edit. It is correct for what it describes and is still live
 * behind the fal adapter. It is also wrong for these models, and the two never
 * import each other (a test asserts it).
 */

/** The Omni model. ✅ Accepted; `kling-v3-1-omni` answers "model is not supported". */
export const KLING_OMNI_MODEL_NAME = "kling-v3-omni";

/* ───────────────────────────── settings{} ────────────────────────────────── */

/**
 * `settings.resolution`. ✅ VERIFIED — the vendor lists these itself:
 * `"settings.resolution value 'bogus' is invalid, allowed values: 480p, 720p, 1080p, 4k"`
 *
 * 🔴 Lower-case. `720P` is NOT accepted, which is exactly the sort of thing a
 * mirror gets wrong (Pollo publishes `720P`).
 */
export const KLING_RESOLUTIONS = ["480p", "720p", "1080p", "4k"] as const;
export type KlingResolution = (typeof KLING_RESOLUTIONS)[number];

/**
 * 🔴 THE RESOLUTIONS OMNI WILL ACTUALLY RENDER VIDEO AT.
 *
 * The vendor's `settings.resolution` validator lists four values, but `480p` is
 * then refused at generation time with a DIFFERENT error:
 * `"video resolution value '480p' is invalid"`. Verified 2026-09-28 — the first
 * attempt at the owner's "cheapest settings" was rejected for exactly this.
 *
 * Two lists, because the difference is real and a reader needs both: what the
 * field accepts, and what the model renders. Offering 480p because the enum
 * mentions it would be a refusal after the charge.
 */
export const KLING_VIDEO_RESOLUTIONS = ["720p", "1080p", "4k"] as const;
export type KlingVideoResolution = (typeof KLING_VIDEO_RESOLUTIONS)[number];

/**
 * `settings.aspect_ratio`. ✅ VERIFIED:
 * `"aspect_ratio value '99:1' is invalid, supported values: 16:9, 9:16, 1:1"`
 */
export const KLING_ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export type KlingAspectRatio = (typeof KLING_ASPECT_RATIOS)[number];

/**
 * `settings.audio`. ✅ VERIFIED the vendor accepts three names —
 * `"allowed values: native, off, original"`.
 *
 * 🔴 `original` = KEEP THE REFERENCE VIDEO'S OWN SOUND (2026-10-07, owner:
 * "reference videos don't take the audio from the reference video"). The
 * 10-04 refusal ("not supported by the current model") was a request with NO
 * video — there is no original sound to keep. With a `base_video` or a
 * `feature_video` it is accepted, and it was settled by GENERATION, not by a
 * 200: a 3 s clip carrying a 440 Hz tone, edited with `audio: "original"`,
 * came back with that tone (spectral centroid 457 Hz vs 462 Hz, a pure tone in
 * both) and was billed 2.7 units — the plain 0.9 units/s of a reference video,
 * so no sound surcharge (task 936753170905833539). Valid ONLY with a reference
 * video: lib/ai/kling/features/shared.ts refuses it otherwise, before a charge.
 */
export const KLING_AUDIO_MODES_VENDOR = ["native", "off", "original"] as const;
export const KLING_AUDIO_MODES = ["native", "off", "original"] as const;
export type KlingAudioMode = (typeof KLING_AUDIO_MODES)[number];

/**
 * ✅ VERIFIED: `aspect_ratio` is REQUIRED unless a first frame is supplied —
 * `"Aspect ratio must be specified unless a first frame is provided or the task
 * is video editing"`. Named here because two handlers depend on it.
 */
export const KLING_ASPECT_RATIO_REQUIRED_WITHOUT_FIRST_FRAME = true;

export const KLING_OMNI = {
  /**
   * ⚠️ 3–15 s is the model guide's window, and the vendor does **NOT** enforce
   * it: `settings.duration` of `0`, `1` and `20` were all accepted, and only a
   * non-numeric value is refused.
   *
   * 🔴 So this ceiling is OURS to enforce. An unenforced range is a member
   * charged for a 20-second request the model may silently truncate, or a
   * 1-second one they did not mean.
   */
  duration: { minSeconds: 3, maxSeconds: 15, defaultSeconds: 5 },
  /** ⚠️ 2500 from the model guide; the vendor did not reject a longer prompt in probing. Enforced by us. */
  prompt: { maxChars: 2500 },
  resolutions: KLING_RESOLUTIONS,
  defaultResolution: "720p" as KlingResolution,
  aspectRatios: KLING_ASPECT_RATIOS,
  defaultAspectRatio: "16:9" as KlingAspectRatio,
  audioModes: KLING_AUDIO_MODES,

  /**
   * ✅ `contents[].type` — the COMPLETE accepted set. Anything else answers
   * `contents[i].type value '<x>' is invalid`.
   */
  // refer_image, base_video, feature_video: found by probing 2026-10-06 and settled by generation — the reference types Omni actually reads (`image`/`video` are accepted and IGNORED)
  contentTypes: ["prompt", "image", "video", "element", "first_frame", "last_frame", "voice", "refer_image", "base_video", "feature_video"] as const,

  /** ⚠️ Image limits from the model guide (min 300 px, 10 MB, jpg/png). Not vendor-verified. */
  images: {
    max: 7,
    /**
     * 🔴 THE CEILING IS CONDITIONAL, AND THIS IS THE HALF THAT WAS MISSING
     * (2026-10-04).
     *
     * The vendor's own wording: "reference_images: Up to 7 reference images
     * (up to 4 when also using a reference video)". Confirmed against two
     * independent publications of the model's schema.
     *
     * So attaching a reference video does not just add an input — it LOWERS
     * how many images may travel with it. A UI that offers seven slots and
     * then lets somebody attach a video has built a request the API refuses,
     * after they composed it. `klingMaxReferenceImages()` below is the one
     * place that answers the question, so the picker, the validator and the
     * quote cannot disagree about it.
     */
    maxWithReferenceVideo: 4,
    minEdgePx: 300,
    maxBytes: 10 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png"] as const,
    extensions: [".jpg", ".jpeg", ".png"] as const,
  },

  /** ⚠️ The reference/base video's own window, from the model guide. Note it is NOT the output's window. */
  video: {
    minSeconds: 3,
    maxSeconds: 10,
    maxBytes: 200 * 1024 * 1024,
    maxEdgePx: 2560,
    maxCount: 1,
  },
} as const;

export type KlingContentType = (typeof KLING_OMNI.contentTypes)[number];

/**
 * How many reference images may travel with this request.
 *
 * 🔴 ONE function, because the answer depends on something the caller might not
 * think to ask about: attaching a reference video drops the ceiling from 7 to
 * 4. The slot picker, the pipeline's validator and the quote all ask here, so
 * none of them can offer, accept or price a combination the vendor refuses.
 */
export function klingMaxReferenceImages(hasReferenceVideo: boolean): number {
  return hasReferenceVideo ? KLING_OMNI.images.maxWithReferenceVideo : KLING_OMNI.images.max;
}

/* ───────────────────────────── lip sync ──────────────────────────────────── */

/**
 * ✅ VERIFIED: `POST /v1/videos/lip-sync` is a real, separate endpoint with its
 * own request shape. Part 3 declared Lip Sync unavailable because it is not an
 * Omni mode — true, and exactly the inference the owner's §6 forbade.
 */
export const KLING_LIP_SYNC = {
  /** ✅ `"input.mode value 'x' is invalid, allowed values: text2video, audio2video"` */
  modes: ["audio2video", "text2video"] as const,
  /** ✅ `"input.audio_type value 'bogus' is invalid, allowed values: file, url"` */
  audioTypes: ["url", "file"] as const,
  /**
   * 🔴 ✅ `"input.voice_language value 'bogus' is invalid, allowed values: zh, en"`
   *
   * TWO languages. Frenz AI's Text to Audio offers far more through ElevenLabs,
   * so Kling's NATIVE text-driven lip sync is a two-language feature and the
   * multilingual path is "ElevenLabs makes the speech, then `audio2video`" — a
   * separate billed operation, never a hidden chained stage (§3).
   */
  voiceLanguages: ["zh", "en"] as const,
  /** ✅ `"input.voiceSpeed: must be less than or equal to 2.0"` — note the vendor's internal camelCase. */
  voiceSpeed: { min: 0.8, max: 2.0, default: 1 },
} as const;

export type KlingLipSyncMode = (typeof KLING_LIP_SYNC.modes)[number];
export type KlingLipSyncAudioType = (typeof KLING_LIP_SYNC.audioTypes)[number];
export type KlingLipSyncVoiceLanguage = (typeof KLING_LIP_SYNC.voiceLanguages)[number];

/* ───────────────────────────── helpers ───────────────────────────────────── */

/**
 * Omni's placeholder syntax: a prompt names a reference by position rather than
 * describing it. Exposed as functions so the numbering lives in one place — an
 * off-by-one here points the model at the wrong person.
 *
 * ⚠️ From the model guide, not vendor-verified (it cannot be, without a usable
 * `element`; see the contract document §2.4).
 */
export function klingElementRef(oneBasedIndex: number): string {
  return `<<<element_${oneBasedIndex}>>>`;
}
export function klingVideoRef(oneBasedIndex: number): string {
  return `<<<video_${oneBasedIndex}>>>`;
}

/** Seconds as `settings.duration`. ✅ A number and a numeric string are both accepted; a number is sent. */
export function klingDurationValue(seconds: number): number {
  return Math.round(seconds);
}
