import "server-only";

import { AiJobError } from "@/lib/ai/errors";
import { falConfigured, falQueueCancel, falQueueResult, falQueueStatus } from "@/lib/ai/fal/client";
import { extractFalVideoUrl, mapFalQueueStatus } from "@/lib/ai/fal/status";
import type { AiProvider, AiProviderState } from "@/lib/ai/provider";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FAL.AI — the generic adapter (poll · cancel), for the paths that route by ROW
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The reconciler, the stall sweep and the cancel route ask "the provider of
 * this job" for its state or to stop it. They resolve the adapter by the
 * job's own `provider` column (a job keeps its provider for ever, §21) and
 * pass the job's `model` — a fal request is addressed by endpoint + request
 * id, so the endpoint travels with the reference in `context.model`.
 *
 * SUBMISSION is not here: Character Replace submits through the Kling
 * adapter (lib/ai/character-replace/providers/fal-kling-edit.ts) and Lip
 * Sync through the Sync-3 adapter (lib/ai/voice/fal-sync3.ts), each behind
 * its feature's router. `submit` on this seam is AI Clean's shape, and AI
 * Clean is retired — it throws.
 */
export const falProvider: AiProvider = {
  id: "fal",

  isConfigured() {
    return falConfigured();
  },

  supports(feature) {
    // Character Replace (the replacement AND its lip-sync stage) is the feature this build routes to fal.ai.
    return feature === "ai_character_replace";
  },

  async submit() {
    throw new AiJobError("FEATURE_UNAVAILABLE", "fal.ai submissions go through the feature adapters, never the generic seam");
  },

  async poll(reference, context) {
    const endpoint = context?.model?.trim();
    if (!endpoint) throw new AiJobError("PROVIDER_ERROR", "a fal request cannot be read without its endpoint");
    const status = await falQueueStatus(endpoint, reference);
    const mapped = mapFalQueueStatus(status.status) ?? "queued";
    if (mapped !== "completed") {
      return { reference, status: mapped, modelVersion: null, resultUrl: null, detail: null };
    }
    // COMPLETED says the request finished, not that it succeeded — the result read tells which.
    const result = await falQueueResult(endpoint, reference);
    if ("failed" in result) {
      return { reference, status: "failed", modelVersion: null, resultUrl: null, detail: result.failed.detail.slice(0, 2000) } satisfies AiProviderState;
    }
    const url = extractFalVideoUrl(result.data);
    return { reference, status: "completed", modelVersion: null, resultUrl: url, detail: url ? null : "succeeded with no video in the result" };
  },

  async cancel(reference, context) {
    const endpoint = context?.model?.trim();
    if (!endpoint) return false;
    return falQueueCancel(endpoint, reference);
  },

  async parseWebhook() {
    // Verification belongs to the route, where the raw body is (lib/ai/fal/signature.ts) — see the Replicate adapter's note.
    return null;
  },
};
