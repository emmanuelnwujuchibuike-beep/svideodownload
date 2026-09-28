import { KLING_OMNI_MODEL_NAME, klingVideoRef } from "@/lib/ai/kling/features/capabilities";
import {
  commonRequestFields,
  imageListField,
  validateCommonOptions,
  validateImageRefs,
  validatePrompt,
  validateSoundWithVideo,
  validateVideoRef,
  videoListField,
  type KlingImageRef,
  type KlingVideoRefInput,
} from "@/lib/ai/kling/features/shared";
import { invalid, ok, type KlingCommonOptions, type KlingFeatureHandler } from "@/lib/ai/kling/features/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REFERENCE VIDEO on Kling 3.0 Omni — a clip the model TAKES CUES FROM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ✅ SUPPORTED. The 3.0 Omni model guide lists "Video Element Reference —
 * Supports uploading/recording video elements", with a clip of 3–10 s,
 * ≤ 200 MB, ≤ 2K, and a combined budget of four references once a video is
 * present.
 *
 * ── 🔴 `refer_type: "feature"`, AND THAT IS THE WHOLE DISTINCTION (§8.8) ───
 *
 * The owner's brief: "Do not equate 'video input' with 'reference video'
 * unless the official API does." It does not, and the field says so:
 *
 *   feature   THIS handler. The clip is guidance — motion, style, energy. The
 *             output is a NEW video that resembles it. The source is not
 *             preserved frame for frame and is not expected to be.
 *   base      full-character.ts. The clip IS the video, rebuilt with a
 *             different character in it. The member expects their own footage
 *             back, edited.
 *
 * A member who uploads their holiday clip expecting it edited, and receives
 * something merely *inspired* by it, has been given the wrong product and
 * charged for it. One field, two completely different promises — so, two
 * handlers.
 *
 * ── Sound ──────────────────────────────────────────────────────────────────
 * Omni's native audio may not be requested alongside a reference video. That
 * is the vendor's rule and it is checked by `validateSoundWithVideo`, shared
 * with the other video-accepting handler so neither can forget it.
 */

export interface KlingReferenceVideoInput {
  /** The clip to take cues from. 3–10 s — the VIDEO's window, not the output's. */
  videoUrl: string;
  /** Measured by our worker, never claimed by a browser. Omitted = unmeasured, and then unchecked. */
  videoDurationSeconds?: number;
  videoBytes?: number;
  /** What to make from it. Required: without it the model has a mood and no subject. */
  prompt: string;
  /** Optional stills alongside the clip. They share the four-reference budget with it. */
  styleImageUrls?: readonly string[];
  options?: KlingCommonOptions;
}

/** The token that names the nth video inside a prompt. 1-based, like the vendor's own syntax. */
export function promptForVideo(oneBasedIndex: number): string {
  return klingVideoRef(oneBasedIndex);
}

export const klingReferenceVideo: KlingFeatureHandler<KlingReferenceVideoInput> = {
  id: "reference_video",
  label: "Reference Video",
  available: true,
  unavailableReason: null,
  model: KLING_OMNI_MODEL_NAME,

  validate(input) {
    if (!input.videoUrl?.trim()) return invalid("Choose the video to take cues from.");

    const prompt = validatePrompt(input.prompt, { required: true });
    if (!prompt.ok) return prompt;

    const common = validateCommonOptions(input.options);
    if (!common.ok) return common;

    const sound = validateSoundWithVideo(input.options, true);
    if (!sound.ok) return sound;

    const video: KlingVideoRefInput = { url: input.videoUrl, referType: "feature", durationSeconds: input.videoDurationSeconds, bytes: input.videoBytes };
    const videoVerdict = validateVideoRef(video);
    if (!videoVerdict.ok) return videoVerdict;

    const images: KlingImageRef[] = (input.styleImageUrls ?? []).map((url) => ({ url }));
    // With a video present the budget is four in total, and the video itself takes one of them.
    const imageVerdict = validateImageRefs(images, { hasVideo: true, elementCount: 1, required: false });
    if (!imageVerdict.ok) return imageVerdict;
    return ok;
  },

  buildRequest(input) {
    const images = (input.styleImageUrls ?? []).map((url) => ({ url }));
    return {
      model_name: KLING_OMNI_MODEL_NAME,
      multi_shot: false,
      prompt: input.prompt.trim(),
      video_list: videoListField([{ url: input.videoUrl, referType: "feature" }]),
      ...(images.length ? { image_list: imageListField(images) } : {}),
      ...commonRequestFields(input.options),
    };
  },
};
