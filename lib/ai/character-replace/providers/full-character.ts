import "server-only";

import { WAN_ANIMATE_REPLACE, wanResolutionFor } from "@/lib/ai/character-replace/model";
import { replicateWanAnimateReplaceProvider } from "@/lib/ai/character-replace/provider";
import type { ReplacementProvider, ReplacementRequest, ReplacementSubmission } from "@/lib/ai/character-replace/providers/types";
import { isCharacterReplaceQualityId } from "@/lib/ai/character-replace/config";
import { AiJobError } from "@/lib/ai/errors";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FULL CHARACTER → the existing Wan 2.2 Animate Replace provider (Parts 4–5)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Face Only brief: "Do NOT remove, rewrite, or break the existing Wan 2.2
 * Full Character Replacement pipeline. Keep it working exactly as it
 * currently does." Skin + Face brief §12: "full_character → existing Wan
 * 2.2 Animate Replace… completely separate."
 *
 * So this file is a thin adapter over `replicateWanAnimateReplaceProvider`
 * (lib/ai/character-replace/provider.ts) — untouched — that presents it
 * through the router's interface. The payload it builds, the pin it uses,
 * the resolution mapping (480 / 720, 1080p refused), `go_fast` and
 * `merge_audio` are exactly what Part 4 shipped.
 */
export const fullCharacterProvider: ReplacementProvider = {
  id: "replicate",
  mode: "full_character",
  model: WAN_ANIMATE_REPLACE.model,
  version: WAN_ANIMATE_REPLACE.version,

  isConfigured() {
    return replicateWanAnimateReplaceProvider.isConfigured();
  },

  settingsFor(quality) {
    if (!isCharacterReplaceQualityId(quality)) return null;
    const resolution = wanResolutionFor(quality);
    return resolution ? { resolution } : null;
  },

  buildInput(req) {
    const resolution = isCharacterReplaceQualityId(req.quality) ? wanResolutionFor(req.quality) : null;
    if (!resolution) throw new AiJobError("QUALITY_UNAVAILABLE", `${req.quality} is not a resolution this provider offers`);
    return replicateWanAnimateReplaceProvider.buildInput({
      videoUrl: req.videoUrl,
      characterImageUrl: req.referenceImageUrls[0] ?? "",
      resolution,
      goFast: req.goFast,
      mergeAudio: req.keepOriginalAudio,
    }) as unknown as Record<string, unknown>;
  },

  async createPrediction(req: ReplacementRequest): Promise<ReplacementSubmission> {
    const resolution = isCharacterReplaceQualityId(req.quality) ? wanResolutionFor(req.quality) : null;
    if (!resolution) throw new AiJobError("QUALITY_UNAVAILABLE", `${req.quality} is not a resolution this provider offers`);
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
      settings: { resolution, goFast: req.goFast },
      mergeAudio: req.keepOriginalAudio,
    };
  },
};
