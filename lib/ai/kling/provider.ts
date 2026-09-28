import "server-only";

import { AiJobError } from "@/lib/ai/errors";
import { klingConfigured, klingGetTask } from "@/lib/ai/kling/client";
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
 * ── 🔴 `supports()` ANSWERS false FOR EVERY FEATURE, ON PURPOSE (§19) ───────
 *
 * Part 2's promise is "the seam exists and nothing uses it". That promise is
 * worth more as a line of code than as a sentence in a report, so it is one:
 *
 *   · `hasProviderFor()` is `provider.isConfigured() && provider.supports(f)`,
 *     so Kling can never report itself able to run anything;
 *   · `submitJobToProvider` (lib/ai/submit.ts) checks `supports()` BEFORE it
 *     reaches any per-feature branch and refuses with FEATURE_UNAVAILABLE.
 *
 * Even if a future edit wired a feature's routing to Kling by accident, the
 * submission would be refused here — free, before a charge, before an upload.
 * Part 3 opens this one method, per feature, deliberately.
 *
 * ── Why `submit` throws rather than being written now ──────────────────────
 *
 * There is no such thing as a generic Kling submission. Face Only, Full
 * Character, image-to-video and text-to-video each need their own validation,
 * their own request body and their own prompt handling — the owner's explicit
 * instruction is that there must NOT be one giant shared pipeline. So the
 * generic seam refuses, exactly as the fal adapter refuses, and Part 3 adds
 * one handler per feature over `klingCreateTask`.
 */
export const klingProvider: AiProvider = {
  id: "kling",

  isConfigured() {
    return klingConfigured();
  },

  /* 🔴 See the note above. Part 2 routes no feature to Kling. */
  supports() {
    return false;
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
