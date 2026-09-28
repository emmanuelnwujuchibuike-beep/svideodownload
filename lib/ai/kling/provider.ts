import "server-only";

import { AiJobError } from "@/lib/ai/errors";
import { klingConfigured, klingGetTask } from "@/lib/ai/kling/client";
import { isKlingVideoAiFeature } from "@/lib/ai/kling/pipelines/registry";
import { stateFromKlingTask } from "@/lib/ai/kling/status";
import type { AiProvider, AiProviderState } from "@/lib/ai/provider";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KLING — the generic adapter (poll · cancel), for the paths that route by ROW
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The same shape as `lib/ai/fal/provider.ts`, and registered for the same
 * reason: the reconciler, the stall sweep and the cancel route resolve an
 * adapter from the JOB'S OWN `provider` column — a job keeps its provider for
 * ever — and ask it for state. Those paths must have an answer the day a
 * Kling row first exists, and an adapter added at the same time as the row is
 * an adapter nobody tested.
 *
 * ── 🔴 THIS IS NOW THE ONLY ADAPTER THAT RUNS VIDEO (Part 5 §1) ────────────
 *
 * Parts 2–3 kept `supports()` at false so nothing could route here. Part 5
 * opens it for the three features the live API was proven to serve, and closes
 * Replicate's and fal's to match: `hasProviderFor()` is
 * `isConfigured() && supports(f)`, and `submitJobToProvider` checks it BEFORE
 * any per-feature branch, so those two adapters can no longer execute a video
 * feature whatever a caller or a stored setting says.
 *
 * ── Why `submit` still throws ──────────────────────────────────────────────
 *
 * There is no such thing as a generic Kling submission, and §2 forbids
 * inventing one. Text to Video, Image to Video and Lip Sync each have their own
 * validation, their own request body and — in Lip Sync's case — their own
 * ENDPOINT and model. They are submitted through `lib/ai/kling/pipelines/`,
 * which is where the per-feature knowledge lives. This generic seam exists for
 * the paths that route by a job ROW (poll, cancel, reconcile) and refuses
 * anything else, exactly as the fal adapter does.
 */
export const klingProvider: AiProvider = {
  id: "kling",

  isConfigured() {
    return klingConfigured();
  },

  /**
   * 🔴 THE ONLY ADAPTER THAT SUPPORTS A VIDEO FEATURE (Part 5 §1).
   *
   * The three the live API was PROVEN to serve, each by a completed generation:
   * Text to Video, Image to Video and Lip Sync. Read from the pipeline registry
   * rather than written out here, so this list cannot drift from the pipelines
   * that actually exist and adding a pipeline stays one edit.
   *
   * Everything else answers false, including every Character Replace scope —
   * §37: an unsupported capability stays unsupported rather than approximated.
   */
  supports(feature) {
    return isKlingVideoAiFeature(feature);
  },

  async submit() {
    throw new AiJobError("FEATURE_UNAVAILABLE", "kling submissions go through the per-feature handlers (Part 3), never the generic seam");
  },

  /**
   * The task as Kling currently reports it.
   *
   * A task Kling does not know answers null from the client, which becomes
   * `queued` here rather than `failed`: "the vendor has not heard of this"
   * moments after a submit is a propagation delay, and failing a job on it
   * would refund work that is about to run. The stall deadline is what ends a
   * task that never appears — a clock, not a guess.
   */
  async poll(reference) {
    const data = await klingGetTask(reference);
    if (!data) return { reference, status: "queued", modelVersion: null, resultUrl: null, detail: null } satisfies AiProviderState;
    return stateFromKlingTask(data) ?? { reference, status: "queued", modelVersion: null, resultUrl: null, detail: null };
  },

  /**
   * Kling publishes no task-cancel endpoint that could be verified on
   * 2026-09-28, so this reports honestly that it could not stop the work.
   *
   * 🔴 `false` is not a failure path — the seam documents it as "a provider
   * that cannot cancel says so". The member's intent is still recorded and
   * the job still ends on our side; we simply do not pretend the vendor
   * stopped billing. Inventing a cancel endpoint would be worse: a 404 on
   * every cancel, logged as a provider error for ever.
   */
  async cancel() {
    return false;
  },

  /**
   * Verification lives in the route, where the RAW bytes are
   * (lib/ai/kling/signature.ts) — the same split the Replicate and fal
   * adapters make, because a signature covers bytes only that route has.
   */
  async parseWebhook() {
    return null;
  },
};
