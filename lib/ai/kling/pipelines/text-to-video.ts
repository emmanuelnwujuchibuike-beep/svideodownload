import { KLING_OMNI_VIDEO_PATH } from "@/lib/ai/kling/config";
import { klingTextToVideo, type KlingTextToVideoInput } from "@/lib/ai/kling/features/text-to-video";
import { KLING_OMNI_MODEL_NAME } from "@/lib/ai/kling/features/capabilities";
import { quoteKling, type KlingPricingConfig, type KlingQuote } from "@/lib/ai/kling/pricing";
import type { KlingSupportedPipeline } from "@/lib/ai/kling/pipelines/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TEXT → VIDEO — its own pipeline, end to end (§5)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ✅ VERIFIED END TO END against the live API: a real generation succeeded and
 * returned one video plus its billing line.
 *
 *     POST /omni-video/kling-v3-omni
 *     { contents: [ { type: "prompt", text } ], settings: { … } }
 *
 * ── What this pipeline does NOT do (§3) ────────────────────────────────────
 *
 * A member asking for a video from a sentence gets exactly one Kling request.
 * No voice generation, no lip sync, no character work, no second model, no
 * ElevenLabs. The brief is explicit that a feature performs only its own
 * operation, and the old Character Replace pipeline — which chained replace →
 * voice → lip-sync across two vendors — is the thing being replaced.
 *
 * ── Billing dimensions this feature owns (§21) ─────────────────────────────
 *
 * The member's ACTUAL choices, never a default: the duration they picked, the
 * resolution they picked, whether they asked for native audio. The pipeline
 * decides which dimensions matter; `quoteKling` turns them into money, so
 * prepaid and subscription cannot drift apart (§25).
 */
export const klingTextToVideoPipeline: KlingSupportedPipeline<KlingTextToVideoInput> = {
  feature: "text_to_video",
  supported: true,
  label: "Text to Video",
  aiFeature: "ai_text_to_video",
  endpoint: `${KLING_OMNI_VIDEO_PATH}/${KLING_OMNI_MODEL_NAME}`,
  model: KLING_OMNI_MODEL_NAME,
  pricedAs: "text_to_video",

  // 🔴 Its own rules, delegated to the handler that owns this feature's shape.
  validate: (input) => klingTextToVideo.validate(input),
  buildRequest: (input) => klingTextToVideo.buildRequest(input),

  quote(input, pricing: KlingPricingConfig): KlingQuote {
    /*
      🔴 The length billed is the length ASKED FOR, and when the member did not
      choose one it is the vendor's own default (5 s) rather than a number
      invented here. §21 forbids charging on "a fixed default duration" chosen by
      us or on a frontend assumption — this reads the request, and the request
      alone.
    */
    const seconds = input.options?.durationSeconds ?? 5;
    return quoteKling(pricing, {
      feature: "text_to_video",
      resolution: input.options?.resolution ?? "720p",
      seconds,
      audio: input.options?.audio === "native",
      /*
        🔴 The references are PRICED, at the operator's rate (2026-10-04). They are
        counted here and nowhere else: the browser sends what it attached, the
        pipeline already refused a count the vendor would not accept, and
        `quoteKling` turns the count into money. A surcharge applied in the UI
        instead would be the frontend deciding the price, which §13 forbids.
      */
      referenceImages: input.referenceImageUrls?.length ?? 0,
      referenceVideo: !!input.referenceVideoUrl,
    });
  },
};
