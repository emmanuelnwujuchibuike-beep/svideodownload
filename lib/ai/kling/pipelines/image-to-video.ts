import { KLING_OMNI_VIDEO_PATH } from "@/lib/ai/kling/config";
import { KLING_OMNI_MODEL_NAME } from "@/lib/ai/kling/features/capabilities";
import { klingImageToVideo, type KlingImageToVideoInput } from "@/lib/ai/kling/features/image-to-video";
import { quoteKling, type KlingPricingConfig, type KlingQuote } from "@/lib/ai/kling/pricing";
import type { KlingSupportedPipeline } from "@/lib/ai/kling/pipelines/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  IMAGE → VIDEO — its own pipeline (§6)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ✅ VERIFIED END TO END: a reachable portrait sent as `first_frame` came back
 * ANIMATED AND FAITHFUL — same person, clothing, lighting and background.
 *
 *     POST /omni-video/kling-v3-omni
 *     { contents: [ {type:"prompt"}?, {type:"first_frame",url}, {type:"last_frame",url}? ],
 *       settings: { … } }
 *
 * ── 🔴 SEPARATE FROM REFERENCE IMAGE, AND NOT BY CONVENTION ────────────────
 *
 * §7 requires the two to be different pipelines. On this API they are not merely
 * different requests — Reference Image does not exist at all (a plain `image`
 * item is never fetched; see pipelines/unsupported.ts). So this pipeline handles
 * FRAMES only: the picture the clip literally opens on, and optionally the one it
 * ends on. It never pretends a frame is a subject reference.
 *
 * ── Quality (§6, §19, §32) ─────────────────────────────────────────────────
 *
 * The image is handed to Kling as a URL and is NOT re-encoded, resized or
 * recompressed by us. Kling fetches it itself — proven, because an unreachable
 * URL makes the task fail with "Something went wrong when we tried to get the
 * contents of the file." Validation is therefore a REFUSAL (a sentence before the
 * charge), never a transformation. The only processing this feature can justify
 * is none.
 */
export const klingImageToVideoPipeline: KlingSupportedPipeline<KlingImageToVideoInput> = {
  feature: "image_to_video",
  supported: true,
  label: "Image to Video",
  aiFeature: "ai_image_to_video",
  endpoint: `${KLING_OMNI_VIDEO_PATH}/${KLING_OMNI_MODEL_NAME}`,
  model: KLING_OMNI_MODEL_NAME,
  pricedAs: "image_to_video",

  validate: (input) => klingImageToVideo.validate(input),
  buildRequest: (input) => klingImageToVideo.buildRequest(input),

  quote(input, pricing: KlingPricingConfig): KlingQuote {
    const seconds = input.options?.durationSeconds ?? 5;
    return quoteKling(pricing, {
      feature: "image_to_video",
      resolution: input.options?.resolution ?? "720p",
      seconds,
      audio: input.options?.audio === "native",
    });
  },
};
