import "server-only";

import { WAN_ANIMATE_REPLACE } from "@/lib/ai/character-replace/model";
import { UPPER_BODY_TIER_MAP, isReplacementTierId, type UpperBodyProviderSettings } from "@/lib/ai/character-replace/modes";
import { replicateWanAnimateReplaceProvider } from "@/lib/ai/character-replace/provider";
import { linearCostEstimate, type ReplacementProvider, type ReplacementRequest, type ReplacementSubmission } from "@/lib/ai/character-replace/providers/types";
import { AiJobError } from "@/lib/ai/errors";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  UPPER BODY — a body/appearance-capable model, with the scope's own tiers
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The replacement-scope brief (2026-09-20, §4): "UPPER_BODY: use a character
 * replacement provider capable of body/appearance replacement." The one
 * such model wired today is Wan 2.2 Animate Replace — the same integration
 * Full Character has used since Part 4 — so this adapter is a thin, honest
 * wrap of it: the mode's tiers (Standard → 480, High → 720; Ultra
 * unsupported) become Wan's documented resolutions, the member's photo is
 * the single `character_image`, and nothing the model does not accept is
 * ever sent. On a waist-up video what Wan can see — and therefore replaces
 * — is the upper body; the photo step says so in the member's words.
 *
 * The router picks this adapter when `modes.upper_body.provider.model` names
 * Wan; the day a dedicated upper-body model exists, an adapter for it
 * declares `modes: ["upper_body"]` and the operator switches the model in
 * the admin — no interface change.
 */
function resolutionFor(quality: unknown): UpperBodyProviderSettings["resolution"] | null {
  if (!isReplacementTierId(quality)) return null;
  const map = UPPER_BODY_TIER_MAP[quality];
  return map.support === "supported" && map.settings ? map.settings.resolution : null;
}

export const upperBodyProvider: ReplacementProvider = {
  id: "replicate",
  mode: "upper_body",
  model: WAN_ANIMATE_REPLACE.model,
  version: WAN_ANIMATE_REPLACE.version,
  capabilities: {
    modes: ["upper_body", "full_character"],
    supportsTier: (mode, quality) => (mode === "upper_body" ? resolutionFor(quality) !== null : quality === "480p" || quality === "720p"),
    keepsAudio: true,
    maxReferenceImages: 1,
    referenceFraming: "half_body",
  },
  supportsMode(mode) {
    return this.capabilities.modes.includes(mode);
  },
  estimateProcessingCostUsdCents: linearCostEstimate,

  isConfigured() {
    return replicateWanAnimateReplaceProvider.isConfigured();
  },

  settingsFor(quality) {
    const resolution = resolutionFor(quality);
    return resolution ? { resolution } : null;
  },

  buildInput(req) {
    const resolution = resolutionFor(req.quality);
    if (!resolution) throw new AiJobError("QUALITY_UNAVAILABLE", `${req.quality} is not a tier Upper Body offers`);
    return replicateWanAnimateReplaceProvider.buildInput({
      videoUrl: req.videoUrl,
      characterImageUrl: req.referenceImageUrls[0] ?? "",
      resolution,
      goFast: req.goFast,
      mergeAudio: req.keepOriginalAudio,
    }) as unknown as Record<string, unknown>;
  },

  async createPrediction(req: ReplacementRequest): Promise<ReplacementSubmission> {
    if (!this.isConfigured()) throw new AiJobError("FEATURE_UNAVAILABLE", "REPLICATE_API_TOKEN is not set");
    if (!req.referenceImageUrls.length) throw new AiJobError("INVALID_INPUT", "upper body needs one reference image");
    const resolution = resolutionFor(req.quality);
    if (!resolution) throw new AiJobError("QUALITY_UNAVAILABLE", `${req.quality} is not a tier Upper Body offers`);
    const state = await replicateWanAnimateReplaceProvider.createPrediction({
      jobId: req.jobId,
      videoUrl: req.videoUrl,
      characterImageUrl: req.referenceImageUrls[0] ?? "",
      resolution,
      goFast: req.goFast,
      mergeAudio: req.keepOriginalAudio,
      webhookUrl: req.webhookUrl,
    });
    return {
      reference: state.reference,
      status: state.status,
      model: WAN_ANIMATE_REPLACE.model,
      modelVersion: state.modelVersion ?? WAN_ANIMATE_REPLACE.version,
      settings: { resolution, goFast: req.goFast, scope: "upper_body" },
      mergeAudio: req.keepOriginalAudio,
    };
  },
};
