import "server-only";

import { buildWanAnimateReplaceInput, WAN_ANIMATE_REPLACE, type WanAnimateReplaceInput } from "@/lib/ai/character-replace/model";
import { AiJobError } from "@/lib/ai/errors";
import type { AiJobStatus } from "@/lib/ai/jobs";
import { replicateCall, toState, type ReplicatePrediction } from "@/lib/ai/replicate/provider";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE CHARACTER REPLACE PROVIDER — one seam, one implementation for now
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13 (Part 4, §3): "Create a clean provider abstraction…
 * CharacterReplaceProvider └── ReplicateWanAnimateReplaceProvider. Do not
 * scatter Replicate-specific code throughout API routes/components."
 *
 * The application layer (lib/ai/character-replace/submit.ts, the webhook,
 * the reconciler) sees `createPrediction`, `poll`, `cancel` and a
 * `ProviderState` in FrenzSave's own vocabulary. This file is the only place
 * that knows the model's input names, its version, or that the answer is a
 * Replicate prediction. A second provider — a different model, a different
 * vendor — implements the same interface and is chosen by configuration.
 *
 * Shares the HTTP client, the token and the status mapping with the AI Clean
 * adapter (lib/ai/replicate/provider.ts) — one credential system (§2, §38),
 * never a second one. Webhook VERIFICATION stays in the route, where the raw
 * body is (lib/ai/replicate/signature.ts); this provider only interprets a
 * verified body.
 */

export interface CharacterReplacePredictionRequest {
  jobId: string;
  /** Signed, time-limited URLs into the private source bucket — never public. */
  videoUrl: string;
  characterImageUrl: string;
  resolution: "480" | "720";
  goFast: boolean;
  mergeAudio: boolean;
  webhookUrl: string;
}

export interface CharacterReplaceProviderState {
  /** The provider's own id for this run. */
  reference: string;
  status: AiJobStatus;
  modelVersion: string | null;
  /** The provider's output URL — a TEMPORARY provider resource (§19). */
  outputUrl: string | null;
  detail: string | null;
}

export interface CharacterReplaceProvider {
  readonly id: "replicate";
  readonly model: string;
  readonly version: string;
  isConfigured(): boolean;
  /** Build the payload from validated values; exposed so a test can see exactly what would be sent. */
  buildInput(req: Omit<CharacterReplacePredictionRequest, "jobId" | "webhookUrl">): WanAnimateReplaceInput;
  createPrediction(req: CharacterReplacePredictionRequest): Promise<CharacterReplaceProviderState>;
  poll(reference: string): Promise<CharacterReplaceProviderState>;
  cancel(reference: string): Promise<boolean>;
}

function fromState(s: ReturnType<typeof toState>): CharacterReplaceProviderState {
  return { reference: s.reference, status: s.status, modelVersion: s.modelVersion, outputUrl: s.resultUrl, detail: s.detail };
}

export const replicateWanAnimateReplaceProvider: CharacterReplaceProvider = {
  id: "replicate",
  model: WAN_ANIMATE_REPLACE.model,
  version: WAN_ANIMATE_REPLACE.version,

  isConfigured() {
    return !!process.env.REPLICATE_API_TOKEN?.trim() && !!WAN_ANIMATE_REPLACE.version;
  },

  buildInput(req) {
    return buildWanAnimateReplaceInput({
      videoUrl: req.videoUrl,
      characterImageUrl: req.characterImageUrl,
      resolution: req.resolution,
      goFast: req.goFast,
      mergeAudio: req.mergeAudio,
    });
  },

  /**
   * An ASYNC prediction with a webhook (§37): the request returns the moment
   * Replicate has queued the run, and `start` + `completed` are the only
   * events worth a round trip. The member's browser is never waiting on this.
   */
  async createPrediction(req) {
    if (!this.isConfigured()) throw new AiJobError("FEATURE_UNAVAILABLE", "REPLICATE_API_TOKEN is not set");
    const input = this.buildInput(req);
    const res = await replicateCall("/predictions", {
      method: "POST",
      body: JSON.stringify({
        version: WAN_ANIMATE_REPLACE.version,
        input,
        webhook: req.webhookUrl,
        webhook_events_filter: ["start", "completed"],
      }),
    });
    if (!res.ok) {
      // 402/429 are OUR account (credit, throttling), not this job — see the AI Clean adapter for the observation.
      const ourProblem = res.status === 402 || res.status === 429;
      console.error("[cr/provider] create rejected", {
        jobId: req.jobId,
        status: res.status,
        classified: ourProblem ? "PROVIDER_UNAVAILABLE" : "PROVIDER_ERROR",
        body: res.text.slice(0, 500),
      });
      throw new AiJobError(ourProblem ? "PROVIDER_UNAVAILABLE" : "PROVIDER_ERROR", `replicate ${res.status}: ${res.text.slice(0, 500)}`);
    }
    const body = (res.json ?? {}) as ReplicatePrediction;
    if (!body.id) throw new AiJobError("PROVIDER_ERROR", "replicate accepted the job but returned no prediction id");
    const state = fromState(toState(body, body.id));
    return { ...state, modelVersion: state.modelVersion ?? WAN_ANIMATE_REPLACE.version };
  },

  async poll(reference) {
    const res = await replicateCall(`/predictions/${encodeURIComponent(reference)}`, { method: "GET" });
    if (!res.ok) throw new AiJobError("PROVIDER_ERROR", `replicate poll ${res.status}: ${res.text.slice(0, 300)}`);
    return fromState(toState((res.json ?? {}) as ReplicatePrediction, reference));
  },

  async cancel(reference) {
    try {
      const res = await replicateCall(`/predictions/${encodeURIComponent(reference)}/cancel`, { method: "POST" });
      return res.ok;
    } catch {
      return false;
    }
  },
};

/** The configured provider for Character Replace. One today; a registry when there are two. */
export function characterReplaceProvider(): CharacterReplaceProvider {
  return replicateWanAnimateReplaceProvider;
}
