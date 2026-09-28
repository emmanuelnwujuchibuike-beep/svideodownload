import "server-only";

import { AiJobError } from "@/lib/ai/errors";
import { klingCreateTask, type KlingCreateResult } from "@/lib/ai/kling/client";
import { KLING_HANDLERS, klingFeatureGate, type KlingFeatureInputs, type KlingImplementedFeatureId } from "@/lib/ai/kling/features/registry";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A HANDLER'S REQUEST, ACTUALLY SENT — the only server-only file down here
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything else under features/ is pure and testable without a key. This is
 * the one place a built request meets the network, and it is deliberately
 * thin: gate, validate, build, hand to the shared client. No billing, no job
 * row, no storage, no notification — all of that already exists and stays
 * exactly where it is.
 *
 * ── The contract with whoever calls this (Part 4) ──────────────────────────
 *
 * The caller owns the job and the money, in the order §5 fixes:
 *
 *     klingFeatureGate(feature)        ← free, pure, BEFORE any charge
 *     …the caller's own quote check…
 *     …the caller reserves / charges…
 *     …the caller creates the ai_jobs row…
 *     submitKlingFeature(...)          ← here
 *     …the caller stamps the returned taskId on the row and opens the
 *        provider-run ledger entry, exactly as the Replicate and fal
 *        submit paths already do…
 *
 * That last step is the caller's rather than this function's for the reason
 * `lib/ai/character-replace/submit.ts` already works that way: the row, its
 * pipeline metadata and the ledger are the JOB's business, and a provider
 * adapter that wrote to them would be a second place that decides what a job
 * is. The task id comes back from here; `stampJobProvider` puts it in the
 * existing provider-neutral column.
 *
 * ── 🔴 THE GATE RUNS AGAIN, HERE, AND THAT IS NOT REDUNDANT ────────────────
 *
 * The caller is supposed to have gated before charging. This gates again
 * immediately before spending provider money, because the Part 1 audit's
 * most expensive recorded bug was precisely a capability check that existed
 * but was not reached on one path. A check that costs nanoseconds and can
 * only ever prevent a wrong charge is worth running twice.
 */

export interface KlingSubmitOptions<K extends KlingImplementedFeatureId> {
  feature: K;
  input: KlingFeatureInputs[K];
  /** Ours. Used for the log line and as the vendor-side idempotency handle. */
  jobId: string;
  /** Where Kling reports the outcome — /api/webhooks/kling on this deployment. */
  callbackUrl: string;
  /**
   * Send the job id to Kling as `external_task_id` so a timed-out create can
   * be recovered instead of re-billed. On by default; see the field's note in
   * the client for why it is not yet load-bearing.
   */
  sendExternalTaskId?: boolean;
}

export interface KlingSubmission extends KlingCreateResult {
  feature: KlingImplementedFeatureId;
  model: string;
}

export async function submitKlingFeature<K extends KlingImplementedFeatureId>(opts: KlingSubmitOptions<K>): Promise<KlingSubmission> {
  const capability = klingFeatureGate(opts.feature);
  if (!capability.available) {
    // A documented vendor limitation, not a fault. The member's copy comes from lib/ai/errors.ts; the reason is for us.
    throw new AiJobError("FEATURE_UNAVAILABLE", `kling: ${opts.feature} — ${capability.reason}`);
  }

  const handler = KLING_HANDLERS[opts.feature];
  const verdict = handler.validate(opts.input);
  if (!verdict.ok) {
    throw new AiJobError(verdict.kind === "unsupported" ? "FEATURE_UNAVAILABLE" : "INVALID_INPUT", `kling: ${opts.feature} — ${verdict.reason}`);
  }

  const result = await klingCreateTask({
    model: handler.model,
    /*
      🔴 The handler names its own endpoint. Lip Sync is a DIFFERENT capability on
      a different path with a different body, and a submit function that chose the
      path itself would have to know which feature was which — the beginning of
      the shared pipeline §2 forbids.
    */
    ...(handler.path ? { path: handler.path } : {}),
    input: handler.buildRequest(opts.input),
    callbackUrl: opts.callbackUrl,
    externalTaskId: opts.sendExternalTaskId === false ? null : opts.jobId,
    label: opts.feature,
    jobId: opts.jobId,
  });

  return { ...result, feature: opts.feature, model: handler.model };
}
