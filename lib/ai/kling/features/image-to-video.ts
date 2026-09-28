import { KLING_OMNI_MODEL_NAME } from "@/lib/ai/kling/features/capabilities";
import { commonRequestFields, imageListField, validateCommonOptions, validateImageRefs, validatePrompt, type KlingImageRef } from "@/lib/ai/kling/features/shared";
import { invalid, ok, type KlingCommonOptions, type KlingFeatureHandler } from "@/lib/ai/kling/features/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  IMAGE → VIDEO on Kling 3.0 Omni — a picture BECOMES the clip
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ✅ SUPPORTED. The 3.0 Omni model guide lists "Image-to-Video: Includes
 * start & end frames, multi-image reference, and element reference."
 *
 * ── 🔴 THIS IS NOT THE SAME FEATURE AS reference-image.ts (§8.7) ───────────
 *
 * The owner's brief warns against confusing the two, and the difference is
 * real and visible in the request:
 *
 *   image-to-video   the image is a FRAME. It is where the clip literally
 *                    starts (and optionally ends). The output opens on that
 *                    exact picture. `image_list[].type = first_frame|end_frame`.
 *
 *   reference-image  the images are SUBJECTS or STYLE. They are never drawn
 *                    as a frame; the model takes the person or the look from
 *                    them and builds something new. No `type` at all.
 *
 * Handling both in one builder would mean a boolean that decides whether a
 * member's photo is shown or merely consulted — a coin-flip on what they get.
 * Two handlers, two intentions.
 */

export interface KlingImageToVideoInput {
  /** The picture the clip starts on. */
  firstFrameUrl: string;
  /** Optional: the picture it ends on. Omni interpolates between them. */
  endFrameUrl?: string;
  /** What should happen between the frames. Optional — the frames alone are an instruction. */
  prompt?: string;
  options?: KlingCommonOptions;
}

export const klingImageToVideo: KlingFeatureHandler<KlingImageToVideoInput> = {
  id: "image_to_video",
  label: "Image to Video",
  available: true,
  unavailableReason: null,
  model: KLING_OMNI_MODEL_NAME,

  validate(input) {
    if (!input.firstFrameUrl?.trim()) return invalid("Choose the photo the video should start from.");

    const common = validateCommonOptions(input.options);
    if (!common.ok) return common;

    const prompt = validatePrompt(input.prompt, { required: false });
    if (!prompt.ok) return prompt;

    const images: KlingImageRef[] = [{ url: input.firstFrameUrl, frame: "first_frame" }];
    if (input.endFrameUrl?.trim()) images.push({ url: input.endFrameUrl, frame: "end_frame" });

    // No video and no element here, so this feature gets the full image budget — of which it uses at most two.
    const verdict = validateImageRefs(images, { hasVideo: false, elementCount: 0, required: true });
    if (!verdict.ok) return verdict;
    return ok;
  },

  buildRequest(input) {
    const images: KlingImageRef[] = [{ url: input.firstFrameUrl, frame: "first_frame" }];
    if (input.endFrameUrl?.trim()) images.push({ url: input.endFrameUrl, frame: "end_frame" });

    const prompt = input.prompt?.trim();
    return {
      model_name: KLING_OMNI_MODEL_NAME,
      multi_shot: false,
      ...(prompt ? { prompt } : {}),
      image_list: imageListField(images),
      ...commonRequestFields(input.options),
    };
  },
};
