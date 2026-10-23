import { KLING_OMNI_VIDEO_PATH } from "@/lib/ai/kling/config";
import { KLING_OMNI_MODEL_NAME } from "@/lib/ai/kling/features/capabilities";
import { klingPersonReplace, type KlingPersonReplaceInput } from "@/lib/ai/kling/features/person-replace";
import { quoteKling, type KlingPricingConfig, type KlingQuote } from "@/lib/ai/kling/pricing";
import type { KlingSupportedPipeline } from "@/lib/ai/kling/pipelines/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CHARACTER REPLACE — its own pipeline (2026-10-19)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The member's video, edited on Kling 3.0 Omni so one or two chosen people
 * become the people in their photos. One request (`base_video` + `refer_image`
 * + a server-written instruction); the handler (features/person-replace.ts)
 * owns the rules and the body, this owns the price.
 *
 * ── 🔴 BILLING DIMENSIONS (§21) ─────────────────────────────────────────────
 *
 *   · the length is the VIDEO's, as the worker measured it — an edit comes
 *     back at the clip's own length whatever duration is asked, and Kling
 *     bills that length (2026-10-06). Never a browser figure, never a default;
 *   · the resolution asked for;
 *   · each replacement photo, at the operator's per-image rate;
 *   · NOT native audio (an edit cannot have it) and NOT the "reference video"
 *     surcharge or multiplier: the video is this tool's REQUIRED input, and its
 *     own tier (`character_replace:*`) is priced as a video-input generation
 *     from the start — exactly as Lip Sync is never charged for its video.
 *
 * The tiers ship DISABLED (pricing.ts): a new tier's price defaults to zero,
 * and a zero-priced paid tool switched on by a deploy would be free.
 */
export const klingPersonReplacePipeline: KlingSupportedPipeline<KlingPersonReplaceInput> = {
  feature: "full_character",
  supported: true,
  label: "Character Replace",
  aiFeature: "ai_person_replace",
  endpoint: `${KLING_OMNI_VIDEO_PATH}/${KLING_OMNI_MODEL_NAME}`,
  model: KLING_OMNI_MODEL_NAME,
  pricedAs: "character_replace",
  // an edit of the member's own clip is never the complimentary video
  complimentary: false,

  validate: (input) => klingPersonReplace.validate(input),
  buildRequest: (input) => klingPersonReplace.buildRequest(input),

  quote(input, pricing: KlingPricingConfig): KlingQuote {
    const seconds = Math.round(Math.max(0, input.video?.durationMs ?? 0)) / 1000;
    const images = (input.targets ?? []).reduce((n, t) => n + (t.referenceImageUrls?.length ?? 0), 0);
    return quoteKling(pricing, {
      feature: "character_replace",
      resolution: input.options?.resolution ?? "720p",
      seconds,
      audio: false,
      referenceImages: images,
      referenceVideo: false,
    });
  },
};
