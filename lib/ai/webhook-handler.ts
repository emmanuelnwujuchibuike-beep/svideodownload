import "server-only";

import { after } from "next/server";

import { readPipeline } from "@/lib/ai/character-replace/job-meta";
import { isProviderStage, markFailed, markProcessing, markSucceeded, nextStage } from "@/lib/ai/character-replace/pipeline";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorMessage } from "@/lib/ai/errors";
import { dispatchAdvance, dispatchFinalization } from "@/lib/ai/finalize-dispatch";
import { releaseJobFunding } from "@/lib/ai/funding";
import { recordJobEvent } from "@/lib/ai/job-events";
import { findJobByPredictionId, getJobAsService, noteJobDiagnostic, recordProviderOutput, transitionJob, writeProcessingMetadata } from "@/lib/ai/job-store";
import { aiFeature, isActiveStatus, isWalletFundedFeature, type AiFeature, type AiProviderId } from "@/lib/ai/jobs";
import { notifyAiJobFailed } from "@/lib/ai/notify";
import type { AiProviderState } from "@/lib/ai/provider";
import { closeProviderRun } from "@/lib/ai/providers/runs";
import { subjectFromRow, type AiSubject } from "@/lib/ai/subject";
import { releaseAiUsage } from "@/lib/ai/usage";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ONE HANDLER FOR EVERY PROVIDER'S CALLBACK — after the route has verified it
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 2026-09-21 (the fal.ai brief §15): "Preserve the existing Replicate
 * webhook … Duplicate webhook delivery must NEVER double-charge, double-refund,
 * create duplicate outputs, create duplicate notifications."
 *
 * This is the body of app/api/ai/replicate/webhook/route.ts from the moment
 * the signature has been checked and the body parsed, moved here VERBATIM
 * in behaviour so /api/webhooks/fal runs the identical sequence. Each route
 * keeps its own verification (a signature covers the raw bytes only that
 * route has) and hands over a normalised `AiProviderState`.
 *
 * ── Idempotency is the database's job, not a flag here ─────────────────────
 *
 * Both providers retry. `transitionJob` is a compare-and-set: it updates only
 * from the statuses a job is allowed to leave, so the second delivery of the
 * same callback matches no row and changes nothing. That is what stops a
 * retry double-charging usage, re-copying the file, reopening a finished job
 * or announcing it twice (`claimNotification` is a CAS of its own).
 *
 * ── The provider id is a guard, not a label ─────────────────────────────────
 *
 * A callback is matched by the provider's own request id (UNIQUE on the row),
 * and then the row's `provider` must be the one that called: a fal delivery
 * cannot finish a Replicate job even with a colliding id.
 *
 * ── Always 200, even when we refuse ────────────────────────────────────────
 *
 * A non-2xx makes a provider retry, so anything that will never succeed on a
 * retry — an unknown reference, a mismatched provider — is answered 200 with
 * a plain body and logged. Genuine transient failures on OUR side answer 500
 * so a retry does happen.
 */
export interface CallbackAnswer {
  status: 200 | 500;
  body: Record<string, unknown>;
}

export async function handleProviderCallback(state: AiProviderState, opts: { provider: AiProviderId; log: string }): Promise<CallbackAnswer> {
  const { provider, log } = opts;
  try {
    const job = await findJobByPredictionId(state.reference);
    if (!job) {
      // Verified, but about a request we do not know. Nothing to do, and no retry will change that.
      console.warn(`[${log}] no job for reference`, { provider, reference: state.reference });
      return { status: 200, body: { ok: true, matched: false } };
    }
    if ((job.provider ?? "replicate") !== provider) {
      console.warn(`[${log}] reference belongs to another provider's job — ignored`, { provider, rowProvider: job.provider, jobId: job.id });
      await recordJobEvent(job.id, "webhook.ignored", { provider, reason: `delivery from ${provider} for a ${job.provider} job`, predictionId: state.reference });
      return { status: 200, body: { ok: true, matched: false } };
    }

    const feature = aiFeature(job.feature);
    if (!feature) return { status: 200, body: { ok: true } };

    /*
      The audit row (Part 5, §36). `ignored` when the job is already past the
      status this delivery could move — a duplicate or an out-of-order one —
      which the compare-and-set below turns into a no-op regardless; the row
      just says so.
    */
    const stale = !isActiveStatus(job.status);
    await recordJobEvent(job.id, stale ? "webhook.ignored" : "webhook.received", {
      provider,
      providerStatus: state.status,
      jobStatus: job.status,
      predictionId: state.reference,
      ...(stale ? { reason: "job already terminal (duplicate or out of order)" } : {}),
    });

    /*
      ── Part 6: WHICH STAGE this delivery is about ─────────────────────────
      A multi-stage Character Replace job carries a pipeline; the request id
      on the row is the CURRENT stage's, and this delivery was matched by it,
      so `pipeline.current` is the stage that finished.
    */
    const pipeline = isWalletFundedFeature(job.feature) ? readPipeline(job.metadata) : null;
    const stage = pipeline?.current ?? null;
    const following = pipeline && stage ? nextStage(pipeline, stage) : null;
    const intermediate = !!pipeline && !!stage && isProviderStage(stage) && !!following && isProviderStage(following);

    /* ── still running ────────────────────────────────────────────────────── */
    if (state.status === "processing" || state.status === "queued") {
      await transitionJob(job.id, ["queued"], "processing", { started_at: job.started_at ?? new Date().toISOString() });
      if (pipeline && stage && job.status === "processing") {
        const current = await getJobAsService(job.id);
        if (current?.replicate_prediction_id === state.reference) {
          await writeProcessingMetadata(job.id, state.reference, { ...(current.metadata ?? {}), pipeline: markProcessing(readPipeline(current.metadata) ?? pipeline, stage) }).catch(() => null);
        }
      }
      if (state.status === "processing") await closeProviderRun(provider, state.reference, { status: "processing" });
      return { status: 200, body: { ok: true } };
    }

    /* ── finished, one way or another ─────────────────────────────────────── */
    if (state.status === "completed") {
      const outputUrl = state.resultUrl;
      if (!outputUrl) {
        // The provider says it succeeded and there is no video in the output. A provider failure, refunded.
        await closeProviderRun(provider, state.reference, { status: "failed", errorCode: "PROVIDER_ERROR", errorDetail: state.detail ?? "succeeded with no usable output" });
        return await failJob(job.id, subjectFromRow(job), feature.id, "PROVIDER_ERROR", state.detail ?? "succeeded with no usable output", log);
      }

      try {
        // Written BEFORE the response, so a dispatch that never lands leaves a job that can still be finalized later.
        await recordProviderOutput(job.id, outputUrl);
        if (pipeline && stage) {
          const current = await getJobAsService(job.id);
          if (current?.replicate_prediction_id === state.reference && current.status === "processing") {
            const moved = markSucceeded(readPipeline(current.metadata) ?? pipeline, stage, outputUrl, new Date().toISOString());
            await writeProcessingMetadata(job.id, state.reference, { ...(current.metadata ?? {}), pipeline: moved });
          }
        }
      } catch (e) {
        // Our database, our problem — 500 asks for the redelivery that fixes it.
        console.error(`[${log}] could not record provider output`, { jobId: job.id, error: String(e) });
        return { status: 500, body: { ok: false } };
      }
      await closeProviderRun(provider, state.reference, { status: "succeeded", outputRef: outputUrl });

      if (intermediate) {
        after(async () => {
          const dispatch = await dispatchAdvance(job.id);
          console.info(`[${log}] advance dispatched`, { jobId: job.id, userId: job.user_id, stage, next: following, predictionId: state.reference, dispatched: dispatch.dispatched, ...(dispatch.dispatched ? {} : { reason: dispatch.reason }) });
          await noteJobDiagnostic(job.id, {
            advance_dispatch: dispatch.dispatched ? "ok" : dispatch.reason,
            advance_detail: dispatch.dispatched ? null : ("detail" in dispatch ? dispatch.detail : null),
            advance_from: "webhook",
          });
          if (dispatch.dispatched === false && dispatch.reason === "refused") {
            console.error(`[${log}] worker REFUSED the advance — ending the job`, { jobId: job.id, status: dispatch.status, detail: dispatch.detail });
            await failJob(job.id, subjectFromRow(job), feature.id, "FINALIZER_UNAVAILABLE", dispatch.detail, log);
          }
        });
        return { status: 200, body: { ok: true } };
      }

      /*
        Fired AFTER the response. The job stays `processing` until the worker
        CLAIMS it with a compare-and-set, which is what makes two deliveries of
        this callback safe. A REFUSED hand-off ends the job now (it used to
        orphan it — see the Replicate route's history); transient failures are
        left to the reconciler.
      */
      after(async () => {
        const dispatch = await dispatchFinalization(job.id);
        console.info(`[${log}] finalization dispatched`, {
          jobId: job.id,
          userId: job.user_id,
          feature: feature.id,
          provider,
          predictionId: state.reference,
          modelVersion: state.modelVersion,
          dispatched: dispatch.dispatched,
          ...(dispatch.dispatched ? {} : { reason: dispatch.reason }),
          ...(dispatch.dispatched === false && dispatch.reason === "refused" ? { status: dispatch.status, detail: dispatch.detail } : {}),
        });
        await noteJobDiagnostic(job.id, {
          finalize_dispatch: dispatch.dispatched ? "ok" : dispatch.reason,
          finalize_detail: dispatch.dispatched ? null : ("detail" in dispatch ? dispatch.detail : null),
          finalize_from: "webhook",
        });
        if (dispatch.dispatched === false && dispatch.reason === "refused") {
          console.error(`[${log}] worker REFUSED the finalization — ending the job`, { jobId: job.id, status: dispatch.status, detail: dispatch.detail });
          await failJob(job.id, subjectFromRow(job), feature.id, "FINALIZER_UNAVAILABLE", dispatch.detail, log);
        }
      });

      return { status: 200, body: { ok: true } };
    }

    if (state.status === "failed") {
      if (pipeline && stage) {
        const current = await getJobAsService(job.id);
        if (current?.replicate_prediction_id === state.reference && current.status === "processing") {
          await writeProcessingMetadata(job.id, state.reference, { ...(current.metadata ?? {}), pipeline: markFailed(readPipeline(current.metadata) ?? pipeline, stage, state.detail ?? "provider failed", new Date().toISOString()) }).catch(() => null);
        }
      }
      const code = stage === "voice" ? "VOICE_GENERATION_FAILED" : stage === "lipsync" ? "LIPSYNC_FAILED" : "PROCESSING_FAILED";
      await closeProviderRun(provider, state.reference, { status: "failed", errorCode: code, errorDetail: state.detail });
      return await failJob(job.id, subjectFromRow(job), feature.id, code, state.detail, log);
    }

    if (state.status === "cancelled") {
      const updated = await transitionJob(job.id, ["queued", "processing"], "cancelled", { completed_at: new Date().toISOString() });
      await closeProviderRun(provider, state.reference, { status: "cancelled" });
      if (updated) {
        // A cancelled run still consumed provider time, but the member asked for it to stop and got nothing — the slot goes back.
        await refund(subjectFromRow(job), feature.id, updated, "cancel");
      }
      return { status: 200, body: { ok: true } };
    }

    return { status: 200, body: { ok: true } };
  } catch (e) {
    console.error(`[${log}] threw`, { provider, reference: state.reference, error: String(e) });
    // Our side broke. 500 asks for the retry that might succeed.
    return { status: 500, body: { ok: false } };
  }
}

/** Mark it failed, refund the slot, and never store the provider's words where a member can read them. */
async function failJob(jobId: string, subject: AiSubject | null, feature: AiFeature, code: string, detail: string | null | undefined, log: string): Promise<CallbackAnswer> {
  const updated = await transitionJob(jobId, ["queued", "processing"], "failed", {
    error_code: code,
    // Operator-facing only. `jobToView` never selects this column into a response.
    error_message: detail ? detail.slice(0, 2000) : null,
    completed_at: new Date().toISOString(),
  });

  if (updated) {
    await refund(subject, feature, updated, "failure");
    // A guest has nowhere to receive a push; they see it when they return.
    if (subject?.kind === "user") {
      await notifyAiJobFailed({
        userId: subject.userId,
        jobId,
        feature,
        message: aiErrorMessage(code === "PROVIDER_UNAVAILABLE" ? "PROVIDER_UNAVAILABLE" : "PROCESSING_FAILED"),
      });
    }
    console.error(`[${log}] failed`, { jobId, subject: subject?.key ?? null, feature, code, transition: "-> failed", released: true });
  }
  return { status: 200, body: { ok: true } };
}

/**
 * Give the slot back. The entitlement is re-resolved because the refund cap
 * is the member's own daily allowance, and a webhook has no session.
 */
async function refund(subject: AiSubject | null, feature: AiFeature, job?: { id: string; user_id: string | null; funding_source: "free" | "balance" | "credits" | null }, cause: "failure" | "cancel" | "undo" = "undo") {
  const def = aiFeature(feature);
  if (!def || !subject) return;
  const entitlement = await getAiEntitlement(subject, def);
  // Character Replace: the product-wallet / credit / complimentary release, exactly once (lib/ai/funding.ts).
  if (job && isWalletFundedFeature(feature)) {
    await releaseJobFunding({ job, subject, feature, dailyLimit: entitlement.dailyLimit, cause });
    return;
  }
  await releaseAiUsage(subject, feature, entitlement.dailyLimit);
}
