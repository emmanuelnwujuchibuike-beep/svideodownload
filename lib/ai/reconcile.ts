import "server-only";

import { readPipeline } from "@/lib/ai/character-replace/job-meta";
import { isProviderStage, markFailed, markSucceeded, nextStage, type PipelineMeta, type PipelineStage } from "@/lib/ai/character-replace/pipeline";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorMessage } from "@/lib/ai/errors";
import { dispatchAdvance, dispatchFinalization } from "@/lib/ai/finalize-dispatch";
import { aiFeature, type AiJobRow, type AiJobStatus } from "@/lib/ai/jobs";
import { getJobAsService, recordProviderOutput, transitionJob, noteJobDiagnostic, writeProcessingMetadata } from "@/lib/ai/job-store";
import { notifyAiJobFailed } from "@/lib/ai/notify";
import { providerFor } from "@/lib/ai/providers";
import { subjectFromRow } from "@/lib/ai/subject";
import { releaseJobFunding } from "@/lib/ai/funding";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ASKING THE PROVIDER DIRECTLY, INSTEAD OF WAITING TO BE TOLD
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 WHY THIS EXISTS (owner, 2026-09-08: "still stuck in progress again") ──
 *
 * Three jobs in a row sat at `processing` until the owner gave up and cancelled
 * them. Every one had been dispatched correctly — a prediction id, a pinned
 * version, in under four seconds — and every one was waiting on a webhook.
 *
 * The honest position when that was written: I could not prove the webhook was
 * broken, because all three were cancelled BEFORE the model could plausibly
 * have finished on CPU hardware. It might have been a missed callback; it might
 * have been a slow model and an impatient afternoon.
 *
 * That uncertainty is the whole argument for this file. A webhook-only design
 * has a failure mode with no recovery and no signal: if the delivery is lost,
 * the signing secret is wrong, or the callback is refused, the row sits at
 * `processing` for ever, Replicate sees a 200 and never retries, and NOTHING
 * anywhere logs an error. The system cannot tell "still working" from "never
 * coming back" — and neither could I.
 *
 * So the webhook stops being the only way a job can finish. It is still the
 * fast path and still preferred; this is the floor underneath it. A job that
 * has been quiet for a while gets its status read straight from the provider,
 * on the poll the waiting member is already making.
 *
 * ── This costs nothing at the provider ──────────────────────────────────────
 *
 * Reading a prediction is a plain GET against an already-paid-for record.
 * Replicate bills compute, not lookups, so reconciliation cannot add to a bill
 * — which is why the grace period below is measured in a minute or two rather
 * than in the tens of minutes a timeout would need.
 *
 * ── It is deliberately IDEMPOTENT with the webhook ──────────────────────────
 *
 * Both paths end in `transitionJob`, a compare-and-set. If a callback lands
 * while this is mid-flight, one of them updates the row and the other matches
 * nothing. There is no lock, no flag, and no window where both could act.
 */

/**
 * How long a job may sit before we stop waiting to be told.
 *
 * Long enough that the webhook is genuinely the normal path — a callback
 * arrives seconds after the model finishes — and short enough that a lost one
 * costs a member a minute rather than their afternoon.
 */
const RECONCILE_AFTER_MS = 90_000;

/**
 * The minimum gap between two reconciliations of the SAME job.
 *
 * The workspace polls every few seconds. Without this, a job that genuinely IS
 * still running would produce a provider request per poll for its entire life —
 * free, but rude, and the kind of traffic that gets an API key rate-limited at
 * the worst possible moment.
 *
 * Module scope, so it is per serverless instance rather than global. That is
 * fine: the worst case is one extra GET per instance, and the alternative is a
 * database write on every poll to save a request that costs nothing.
 */
const RECONCILE_EVERY_MS = 20_000;
const lastChecked = new Map<string, number>();

/** Statuses where the provider is the authority on what happened. */
const AWAITING_PROVIDER: readonly AiJobStatus[] = ["queued", "processing"];

function due(job: Pick<AiJobRow, "id" | "status" | "started_at" | "created_at">, now: number): boolean {
  if (!AWAITING_PROVIDER.includes(job.status)) return false;

  const since = Date.parse(job.started_at ?? job.created_at);
  if (!Number.isFinite(since) || now - since < RECONCILE_AFTER_MS) return false;

  const last = lastChecked.get(job.id) ?? 0;
  return now - last >= RECONCILE_EVERY_MS;
}

/**
 * Bring one job's status in line with the provider's.
 *
 * Returns true when something changed, so the caller knows to re-read the row.
 * Never throws: this runs inside a read that must still answer if the provider
 * is unreachable. A member seeing "still processing" for another minute is a
 * much better outcome than a poll that 500s.
 */
export async function reconcileWithProvider(job: AiJobRow, now: number = Date.now(), opts: { force?: boolean } = {}): Promise<boolean> {
  // `force` is the operator's "Reconcile now" (Part 5, §35): the grace and the throttle are theirs to skip.
  if (!job.replicate_prediction_id || (!opts.force && !due(job, now))) return false;

  const feature = aiFeature(job.feature);
  if (!feature) return false;
  const provider = providerFor(feature.provider);
  if (!provider || !provider.isConfigured()) return false;

  /*
    ── Part 8: WHICH STAGE the prediction on the row belongs to ────────────

    A multi-stage Character Replace job keeps the LAST prediction it created
    on the row. Between stages — the voice succeeded, the worker stored the
    speech, the replace stage is `pending` because its submit was throttled —
    that id is a finished stage's, and asking the provider about it again
    answers "succeeded" for work that is already home. Before this guard the
    member's own poll did exactly that ninety seconds in: it recorded the
    speech file as "the provider output" and dispatched a FINALIZATION for a
    job whose video had not been generated. Nothing here may act unless the
    prediction is the CURRENT stage's and that stage is still in flight.
  */
  const pipeline = job.feature === "ai_character_replace" ? readPipeline(job.metadata) : null;
  const stage: PipelineStage | null = pipeline?.current ?? null;
  if (pipeline && stage) {
    if (!isProviderStage(stage)) return false;
    const record = pipeline.records[stage];
    const inFlight = record?.status === "submitted" || record?.status === "processing";
    if (!inFlight || (record.predictionId && record.predictionId !== job.replicate_prediction_id)) return false;
  }
  const following = pipeline && stage ? nextStage(pipeline, stage) : null;
  const intermediate = !!pipeline && !!stage && !!following && isProviderStage(following);

  lastChecked.set(job.id, now);

  try {
    const state = await provider.poll(job.replicate_prediction_id);

    /* ── still working. The common answer, and it is good news. ──────────── */
    if (state.status === "queued" || state.status === "processing") {
      // Record that it really did start, for a job whose `start` callback was
      // the delivery that went missing.
      if (job.status === "queued") {
        await transitionJob(job.id, ["queued"], "processing", {
          started_at: job.started_at ?? new Date(now).toISOString(),
        });
        return true;
      }
      return false;
    }

    /* ── finished, and we were never told ─────────────────────────────────── */
    if (state.status === "completed") {
      if (!state.resultUrl) {
        return await failFrom(job, "PROVIDER_ERROR", "succeeded with no usable output");
      }

      // Written BEFORE anything is dispatched, so a worker call that never
      // lands still leaves a job that can be finalized later rather than one
      // that has lost the only link to its own output.
      await recordProviderOutput(job.id, state.resultUrl);
      if (pipeline && stage) await recordStage(job, pipeline, (p) => markSucceeded(p, stage, state.resultUrl, new Date(now).toISOString()));

      if (intermediate) {
        /*
          ── Part 8: a lost callback for an INTERMEDIATE stage ────────────────
          Mirror of the webhook's own branch: the worker brings this stage's
          output home and submits the next (advance), never the finalizer —
          a finalizer handed a speech file would call it "not a video" and
          refund a job that was going fine. A refusal ends the job exactly as
          the webhook's would; anything transient is left to the sweep, which
          re-dispatches while `pipeline.pending_advance` is set.
        */
        const dispatch = await dispatchAdvance(job.id);
        console.warn("[ai/reconcile] advanced a stage the webhook never reported", { jobId: job.id, stage, next: following, predictionId: job.replicate_prediction_id, dispatched: dispatch.dispatched, ...(dispatch.dispatched ? {} : { reason: dispatch.reason }) });
        await noteJobDiagnostic(job.id, {
          advance_dispatch: dispatch.dispatched ? "ok" : dispatch.reason,
          advance_detail: dispatch.dispatched ? null : ("detail" in dispatch ? dispatch.detail : null),
          advance_from: "reconcile",
        });
        if (dispatch.dispatched === false && dispatch.reason === "refused") {
          console.error("[ai/reconcile] worker REFUSED the advance — ending the job", { jobId: job.id, status: dispatch.status, detail: dispatch.detail });
          return await failFrom(job, "FINALIZER_UNAVAILABLE", dispatch.detail);
        }
        return true;
      }

      /*
        🔴 NOT `after()` here, unlike the webhook.

        That helper exists because a webhook must answer Replicate immediately
        and would otherwise be frozen the moment it responds. This runs inside a
        member's own poll, where the dispatch is a single fast internal call and
        awaiting it means the very next poll sees `finalizing` instead of a
        second helping of `processing`.
      */
      const dispatch = await dispatchFinalization(job.id);
      console.warn("[ai/reconcile] finished a job the webhook never reported", {
        jobId: job.id,
        predictionId: job.replicate_prediction_id,
        dispatched: dispatch.dispatched,
        ...(dispatch.dispatched ? {} : { reason: dispatch.reason }),
      });

      /*
        🔴 Same rule as the webhook: a REFUSAL is permanent, so the job ends
        here with an honest error rather than being handed back to a poll that
        will get the identical 403 every few seconds until the stall deadline.

        This mattered more than it looks. Replicate deletes prediction output
        after about an hour, so a job left spinning on a refused handoff does
        not merely stay slow — it becomes unrecoverable, and then reports
        "succeeded with no usable output", which reads like the model's fault
        and is not.
      */
      await noteJobDiagnostic(job.id, {
        finalize_dispatch: dispatch.dispatched ? "ok" : dispatch.reason,
        finalize_detail: dispatch.dispatched ? null : ("detail" in dispatch ? dispatch.detail : null),
        finalize_from: "reconcile",
      });

      if (dispatch.dispatched === false && dispatch.reason === "refused") {
        console.error("[ai/reconcile] worker REFUSED the finalization — ending the job", {
          jobId: job.id,
          status: dispatch.status,
          detail: dispatch.detail,
        });
        return await failFrom(job, "FINALIZER_UNAVAILABLE", dispatch.detail);
      }

      return true;
    }

    if (state.status === "failed") {
      // Which stage failed, for the operator — before the status moves, so the note survives the CAS.
      if (pipeline && stage) await recordStage(job, pipeline, (p) => markFailed(p, stage, state.detail ?? "provider failed", new Date(now).toISOString()));
      return await failFrom(job, stage === "voice" ? "VOICE_GENERATION_FAILED" : stage === "lipsync" ? "LIPSYNC_FAILED" : "PROCESSING_FAILED", state.detail);
    }

    if (state.status === "cancelled") {
      const updated = await transitionJob(job.id, ["queued", "processing"], "cancelled", {
        completed_at: new Date(now).toISOString(),
      });
      if (updated) await refund(job);
      return !!updated;
    }

    return false;
  } catch (e) {
    // The provider is unreachable or answered something unusable. The job is
    // untouched and the next poll tries again; the stall deadline is still
    // underneath this as the final backstop.
    console.error("[ai/reconcile] provider read failed", {
      jobId: job.id,
      error: String(e).slice(0, 200),
    });
    return false;
  }
}

/**
 * Write a stage record on the CURRENT row, guarded by the prediction id so a
 * webhook landing in the same second cannot be overwritten with older
 * metadata. Best-effort: the stage note is for the tracker and the operator;
 * the transition that matters is the status CAS in the caller.
 */
async function recordStage(job: AiJobRow, fallback: PipelineMeta, mark: (pipeline: PipelineMeta) => PipelineMeta): Promise<void> {
  try {
    const current = await getJobAsService(job.id);
    if (!current || current.replicate_prediction_id !== job.replicate_prediction_id || current.status !== "processing") return;
    await writeProcessingMetadata(job.id, job.replicate_prediction_id!, { ...(current.metadata ?? {}), pipeline: mark(readPipeline(current.metadata) ?? fallback) });
  } catch (e) {
    console.warn("[ai/reconcile] stage note not written", { jobId: job.id, error: String(e).slice(0, 120) });
  }
}

async function failFrom(job: AiJobRow, code: string, detail: string | null | undefined): Promise<boolean> {
  const updated = await transitionJob(job.id, ["queued", "processing"], "failed", {
    error_code: code,
    // Operator-facing only. `jobToView` never selects this column, so a
    // provider's words cannot reach a browser.
    error_message: detail ? String(detail).slice(0, 2000) : null,
    completed_at: new Date().toISOString(),
  });
  if (!updated) return false;

  await refund(job);

  const subject = subjectFromRow(job);
  if (subject?.kind === "user") {
    await notifyAiJobFailed({
      userId: subject.userId,
      jobId: job.id,
      feature: job.feature,
      // The product's own sentence: AI Clean's "cleanup" line is wrong for a Character Replace job.
      message: job.feature === "ai_character_replace" ? aiErrorMessage("PROCESSING_FAILED") : "The cleanup didn't finish. Your allowance wasn't used — you can try again.",
      // A job reconcile gives up on failed on OUR side, not on the input.
      errorCode: "PROCESSING_FAILED",
    });
  }
  console.error("[ai/reconcile] failed a job the webhook never reported", { jobId: job.id, code });
  return true;
}

/** Give the slot back. Ours or the provider's, so it is free. */
async function refund(job: AiJobRow): Promise<void> {
  const def = aiFeature(job.feature);
  const subject = subjectFromRow(job);
  if (!def || !subject) return;
  try {
    const entitlement = await getAiEntitlement(subject, def);
    /*
      🔴 The row says HOW it was funded. A paid job gets its money back; a free
      one gets its daily slot back. Releasing a slot for a paid job would create
      a free video — see lib/ai/funding.ts.
    */
    await releaseJobFunding({ job, subject, feature: def.id, dailyLimit: entitlement.dailyLimit });
  } catch (e) {
    console.error("[ai/reconcile] refund failed", { jobId: job.id, error: String(e) });
  }
}
