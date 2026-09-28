import "server-only";

import { AiJobError } from "@/lib/ai/errors";
import { klingCreateTask, type KlingCreateResult } from "@/lib/ai/kling/client";
import { klingPipeline, type KlingPipelineInputs, type KlingRunnableFeature } from "@/lib/ai/kling/pipelines/registry";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A PIPELINE'S REQUEST, ACTUALLY SENT — the one server-only file down here
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything else under `pipelines/` is pure and testable without a key. This
 * is where a built request meets the network, and it is deliberately thin:
 * gate, validate, build, hand to the shared client at the pipeline's OWN
 * endpoint. No billing, no job row, no storage, no notification — all of that
 * already exists and stays where it is (`lib/ai/video/create.ts` owns the
 * money; this owns one HTTP call).
 *
 * ── 🔴 THE ENDPOINT COMES FROM THE PIPELINE, NOT FROM A BRANCH HERE ────────
 *
 * Part 5 §2 forbids a shared video pipeline that "internally decides" what to
 * run. So this function never asks which feature it is holding: it reads
 * `pipeline.endpoint` and `pipeline.model` off the pipeline and passes them
 * through. Lip Sync submits to `/v1/videos/lip-sync` with a completely
 * different body shape from Omni's, and that difference lives in the Lip Sync
 * pipeline — not in an `if` here.
 *
 * ── 🔴 THE GATE RUNS AGAIN, AND THAT IS NOT REDUNDANT ──────────────────────
 *
 * The caller gates before charging. This validates again immediately before
 * spending provider money, because the Part 1 audit's most expensive recorded
 * bug was a capability check that existed but was not reached on one path. A
 * check costing nanoseconds that can only ever prevent a wrong charge is worth
 * running twice.
 */

export interface KlingPipelineSubmission extends KlingCreateResult {
  feature: KlingRunnableFeature;
  model: string;
  endpoint: string;
}

export interface SubmitKlingPipelineOptions<K extends KlingRunnableFeature> {
  feature: K;
  input: KlingPipelineInputs[K];
  /** Ours. The log line, and the vendor-side idempotency handle. */
  jobId: string;
  /** Where Kling reports the outcome — /api/webhooks/kling on this deployment. */
  callbackUrl: string;
}

export async function submitKlingPipeline<K extends KlingRunnableFeature>(opts: SubmitKlingPipelineOptions<K>): Promise<KlingPipelineSubmission> {
  const pipeline = klingPipeline(opts.feature);

  const verdict = pipeline.validate(opts.input);
  if (!verdict.ok) {
    throw new AiJobError(verdict.kind === "unsupported" ? "FEATURE_UNAVAILABLE" : "INVALID_INPUT", `kling/${opts.feature}: ${verdict.reason}`);
  }

  const result = await klingCreateTask({
    model: pipeline.model,
    // 🔴 The pipeline's own endpoint. Omni and Lip Sync are different paths.
    path: pipeline.endpoint,
    input: pipeline.buildRequest(opts.input),
    callbackUrl: opts.callbackUrl,
    /*
      The job id as the vendor-side handle. If a create times out, Kling may
      have accepted and billed work we never saw an id for; re-submitting with
      the SAME handle lets the vendor recognise it, and lets us find the
      original by asking (`GET /tasks?external_task_ids=…`, verified).
    */
    externalTaskId: opts.jobId,
    label: opts.feature,
    jobId: opts.jobId,
  });

  return { ...result, feature: opts.feature, model: pipeline.model, endpoint: pipeline.endpoint };
}
