import { klingImageToVideoPipeline } from "@/lib/ai/kling/pipelines/image-to-video";
import { klingLipSyncPipeline } from "@/lib/ai/kling/pipelines/lip-sync";
import { klingTextToVideoPipeline } from "@/lib/ai/kling/pipelines/text-to-video";
import { klingUnsupportedPipeline, KLING_UNSUPPORTED_PIPELINES } from "@/lib/ai/kling/pipelines/unsupported";
import {
  isSupportedPipeline,
  KLING_PIPELINE_FEATURES,
  type KlingAnyPipeline,
  type KlingCapabilityReport,
  type KlingCapabilityState,
  type KlingPipelineFeature,
  type KlingSupportedPipeline,
} from "@/lib/ai/kling/pipelines/types";
import { klingTier, klingTierKey, type KlingPricingConfig } from "@/lib/ai/kling/pricing";
import type { KlingImageToVideoInput } from "@/lib/ai/kling/features/image-to-video";
import type { KlingLipSyncInput } from "@/lib/ai/kling/features/lip-sync";
import type { KlingTextToVideoInput } from "@/lib/ai/kling/features/text-to-video";
import type { AiFeature } from "@/lib/ai/jobs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FEATURE → PIPELINE MAP (§4) — explicit, complete, and not a dispatcher
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner §4: "Create an explicit feature-to-pipeline registry. Every production
 * video feature must map to exactly one direct Kling pipeline. Do not allow
 * ambiguous provider resolution. The feature registry must make it obvious which
 * Kling endpoint/capability owns each feature."
 *
 *   text_to_video    → POST /omni-video/kling-v3-omni   (Omni, prompt)
 *   image_to_video   → POST /omni-video/kling-v3-omni   (Omni, first_frame)
 *   lip_sync         → POST /v1/videos/lip-sync         (its own endpoint+model)
 *   reference_image  → unsupported (verified)
 *   reference_video  → unsupported (verified)
 *   full_character   → unsupported (verified)
 *   face_only        → unsupported (verified)
 *   face_skin        → unsupported (verified)
 *   upper_body       → unsupported (verified)
 *
 * ── 🔴 A MAP, NOT A MASTER PIPELINE (§2) ───────────────────────────────────
 *
 * This file knows which pipeline owns which feature and NOTHING about what any
 * of them does. There is no `run(feature, input)` here, no `switch` that builds a
 * body, no shared validation path. Each pipeline is imported, listed, and left
 * alone — the difference between "shared infrastructure", which §2 allows, and
 * "shared feature execution", which it forbids.
 *
 * A test asserts this file contains no request construction.
 */

/** The features that actually have a working pipeline. */
export type KlingRunnableFeature = "text_to_video" | "image_to_video" | "lip_sync";

/** Each runnable feature's own input type, so one feature cannot be handed another's. */
export interface KlingPipelineInputs {
  text_to_video: KlingTextToVideoInput;
  image_to_video: KlingImageToVideoInput;
  lip_sync: KlingLipSyncInput;
}

export const KLING_PIPELINES: { [K in KlingRunnableFeature]: KlingSupportedPipeline<KlingPipelineInputs[K]> } = {
  text_to_video: klingTextToVideoPipeline,
  image_to_video: klingImageToVideoPipeline,
  lip_sync: klingLipSyncPipeline,
};

export const KLING_RUNNABLE_FEATURES: readonly KlingRunnableFeature[] = ["text_to_video", "image_to_video", "lip_sync"];

export function isKlingRunnableFeature(id: string): id is KlingRunnableFeature {
  return (KLING_RUNNABLE_FEATURES as readonly string[]).includes(id);
}

/** The pipeline for a runnable feature, typed to its own input. */
export function klingPipeline<K extends KlingRunnableFeature>(id: K): KlingSupportedPipeline<KlingPipelineInputs[K]> {
  return KLING_PIPELINES[id];
}

/** Every feature the product names, supported or not — the complete map. */
export function klingPipelineFor(feature: string): KlingAnyPipeline | null {
  if (isKlingRunnableFeature(feature)) return KLING_PIPELINES[feature] as unknown as KlingAnyPipeline;
  return klingUnsupportedPipeline(feature);
}

/**
 * 🔴 Which `ai_jobs.feature` values are Kling VIDEO features.
 *
 * Used by the provider-isolation guards: a row carrying one of these must be
 * running on Kling, and must never be handed to a Replicate or fal adapter.
 */
export const KLING_VIDEO_AI_FEATURES: readonly AiFeature[] = KLING_RUNNABLE_FEATURES.map((f) => KLING_PIPELINES[f].aiFeature);

export function isKlingVideoAiFeature(feature: string | null | undefined): boolean {
  return !!feature && (KLING_VIDEO_AI_FEATURES as readonly string[]).includes(feature);
}

/* ─────────────────────── the capability report (§36) ──────────────────────── */

/**
 * What the frontend is told about one feature.
 *
 * 🔴 §36: "The UI must never display a feature as available if the backend cannot
 * actually execute it." So `available` is COMPUTED from three things that must
 * all hold — the pipeline exists, the deployment has a credential, and the
 * operator has the tier on sale — rather than declared anywhere.
 *
 * `configured` is passed in rather than read here so this function stays pure and
 * testable; the caller asks `klingConfigured()` once.
 */
export function klingCapability(feature: KlingPipelineFeature, opts: { configured: boolean; pricing: KlingPricingConfig }): KlingCapabilityReport {
  const pipeline = klingPipelineFor(feature);

  if (!pipeline) {
    return { feature, label: feature, state: "unsupported", reason: "That option isn't available.", detail: "No pipeline is registered for this feature id.", revisitWhen: null };
  }

  if (!isSupportedPipeline(pipeline)) {
    /*
      🔴 `unsupported` is a VERIFIED limitation of the direct API, not a
      configuration problem — so it is reported the same whether or not a
      credential is present, and an operator cannot "enable" it.
    */
    return { feature, label: pipeline.label, state: "unsupported", reason: pipeline.memberReason, detail: pipeline.detail, revisitWhen: pipeline.revisitWhen };
  }

  let state: KlingCapabilityState = "available";
  let reason: string | null = null;
  let detail: string | null = null;

  if (opts.pricing.paused) {
    state = "admin_disabled";
    reason = "This is paused right now. Try again shortly — nothing has been charged.";
    detail = "Kling generation is paused in the admin pricing panel.";
  } else if (!klingTier(opts.pricing, pipeline.pricedAs, "720p").enabled) {
    state = "admin_disabled";
    reason = "This isn't available right now.";
    detail = `The pricing tier ${klingTierKey(pipeline.pricedAs, "720p")} is switched off in the admin pricing panel.`;
  } else if (!opts.configured) {
    /*
      A missing credential is TEMPORARY, not unsupported — the difference matters
      to a member ("try later" vs "this will never work") and to an operator
      reading the admin panel.
    */
    state = "temporarily_unavailable";
    reason = "This is temporarily unavailable. Try again shortly — nothing has been charged.";
    detail = "No Kling credential is set on this deployment.";
  }

  return { feature, label: pipeline.label, state, reason, detail, revisitWhen: null };
}

/** Every feature's state at once — what the AI Studio renders from. */
export function klingCapabilityReport(opts: { configured: boolean; pricing: KlingPricingConfig }): KlingCapabilityReport[] {
  return KLING_PIPELINE_FEATURES.map((f) => klingCapability(f, opts));
}

export { KLING_UNSUPPORTED_PIPELINES, KLING_PIPELINE_FEATURES };
