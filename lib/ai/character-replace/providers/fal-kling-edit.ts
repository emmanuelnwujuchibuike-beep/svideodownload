import "server-only";

import { isCharacterReplaceQualityId } from "@/lib/ai/character-replace/config";
import { KLING_O1_EDIT_LIMITS, buildKlingEditInput, klingEditPrompt, validateKlingInputFacts, type KlingEditInput } from "@/lib/ai/character-replace/providers/kling-input";
import type { ReplacementProvider, ReplacementRequest, ReplacementSubmission } from "@/lib/ai/character-replace/providers/types";
import { AiJobError } from "@/lib/ai/errors";
import { falConfigured, falQueueSubmit } from "@/lib/ai/fal/client";
import { FAL_KLING_O1_EDIT, providerRunEstimateUsdCents, type ProviderModelConfig } from "@/lib/ai/providers/config";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KLING O1 VIDEO EDIT on fal.ai — the fal.ai Character Replace adapter (§3)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The fal.ai brief: "The initial fal.ai Character Replace model is Kling O1
 * Video Edit … Do NOT use Wan 2.2 Animate Replace as the fal.ai Character
 * Replace model. The comparison should be: Replicate — the existing
 * implementation, versus fal.ai — Kling O1 Video Edit."
 *
 * ── Capability mapping (§4: "DO NOT ASSUME PROVIDER PARITY") ────────────────
 *
 * Kling O1 Video Edit takes a reference video, up to four elements / images,
 * and a prompt that says what to change while the motion, camera and scene
 * are kept. Replacing THE CHARACTER from a reference element is exactly that
 * task, so this adapter claims:
 *
 *   full_character   ✓   the whole visible person becomes @Element1
 *   upper_body       ✓   the same task on a waist-up video (what the frame shows)
 *   face_only        ✗   a face SWAP that keeps skin, hair and body — a
 *   skin_face        ✗   face-swap model's job; not claimed, never re-mapped
 *
 * A scope this adapter does not claim is refused before anything is charged
 * (lib/ai/providers/resolve.ts) and shows on the admin diagnostics; the
 * operator may narrow the two claimed scopes further after testing
 * (`falScopes` in the providers configuration). Nothing is faked.
 *
 * ── The model's own input constraints (§5) are enforced in TWO places ──────
 *
 *   before billing   /start: the selected length must be 3–10 s (the trim
 *                    workflow is how a longer video gets there — never a
 *                    silent cut), the source must be MP4/MOV within 200 MB
 *                    (lib/ai/character-replace/providers/kling-input.ts).
 *   before submit    the worker's prepare step re-encodes to the model's
 *                    geometry (both edges ≥ 720 px, long edge ≤ 2160, 24–60
 *                    fps, MP4) and this adapter re-checks the facts on the
 *                    row; a violation is a refused submission and a refund,
 *                    never a paid-for guaranteed failure.
 *
 * Everything Kling-specific — the element/@Element1 architecture, the
 * prompt, the input names — lives in kling-input.ts (pure, tested) and here.
 * The routes, the workspace and the finalizer never learn any of it.
 */
export function falKlingEditProvider(model: ProviderModelConfig, scopes: { upper_body: boolean; full_character: boolean }): ReplacementProvider {
  const endpoint = model.model || FAL_KLING_O1_EDIT;
  const modes = (["full_character", "upper_body"] as const).filter((m) => scopes[m]);
  return {
    id: "fal",
    mode: "full_character",
    model: endpoint,
    version: model.version,
    capabilities: {
      modes,
      /*
        The tiers: Full Character's 720p (and 1080p if the operator ever
        enables it) and Upper Body's High — the ones whose long edge gives the
        model its 720 px minimum without upscaling a 480p tier past what the
        member chose. The worker still guarantees the geometry for a narrow
        aspect (a 21:9 clip at 1280 wide is 548 tall).
      */
      supportsTier: (mode, quality) => (mode === "upper_body" ? quality === "high" : mode === "full_character" ? isCharacterReplaceQualityId(quality) && quality !== "480p" : false),
      keepsAudio: true,
      maxReferenceImages: KLING_O1_EDIT_LIMITS.maxElementsAndImages,
      referenceFraming: "full_body",
    },
    supportsMode(mode) {
      return this.capabilities.modes.includes(mode);
    },
    /*
      §19: the fal.ai cost profile is the operator's own figures on the
      providers tab (per second / per run); the mode's Replicate per-second
      figure passed by the caller is NOT this provider's and is ignored.
    */
    estimateProcessingCostUsdCents(durationMs) {
      return providerRunEstimateUsdCents(model, durationMs);
    },

    isConfigured() {
      return falConfigured() && model.enabled && !!endpoint;
    },

    settingsFor(quality) {
      return { profile: "kling_o1_edit", quality, keepAudioSupported: true };
    },

    buildInput(req) {
      return buildKlingEditInput({
        mode: req.mode,
        videoUrl: req.videoUrl,
        referenceImageUrls: req.referenceImageUrls,
        keepAudio: req.keepOriginalAudio,
      }) as unknown as Record<string, unknown>;
    },

    async createPrediction(req: ReplacementRequest): Promise<ReplacementSubmission> {
      if (!this.isConfigured()) throw new AiJobError("FEATURE_UNAVAILABLE", "the fal.ai Character Replace model is not configured");
      if (!this.supportsMode(req.mode)) throw new AiJobError("FEATURE_UNAVAILABLE", `${req.mode} is not a scope Kling O1 Video Edit serves`);
      if (!req.referenceImageUrls.length) throw new AiJobError("INVALID_INPUT", "Kling O1 Video Edit needs the character's photo as an element");
      // The facts the worker measured on the PREPARED file, re-checked at the moment of submission (§5): nothing guaranteed to fail is sent.
      if (req.facts) {
        const verdict = validateKlingInputFacts(req.facts);
        if (!verdict.ok) throw new AiJobError("INVALID_INPUT", `prepared media violates the model's limits: ${verdict.reason}`);
      }
      const input: KlingEditInput = buildKlingEditInput({ mode: req.mode, videoUrl: req.videoUrl, referenceImageUrls: req.referenceImageUrls, keepAudio: req.keepOriginalAudio });
      const res = await falQueueSubmit(endpoint, input as unknown as Record<string, unknown>, { webhookUrl: req.webhookUrl, label: "kling-o1-edit", jobId: req.jobId });
      return {
        reference: res.requestId,
        status: "processing",
        model: endpoint,
        modelVersion: model.version || null,
        settings: {
          profile: "kling_o1_edit",
          keep_audio: input.keep_audio === true,
          elements: input.elements?.length ?? 0,
          referenceImages: (input.elements?.[0]?.reference_image_urls?.length ?? 0) + (input.image_urls?.length ?? 0),
          promptTemplate: klingEditPrompt(req.mode).slice(0, 80),
          queuePosition: res.queuePosition,
          submitLatencyMs: res.latencyMs,
        },
        mergeAudio: input.keep_audio === true,
      };
    },
  };
}
