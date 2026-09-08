import "server-only";

import { getAiEntitlement } from "@/lib/ai/entitlement";
import { dispatchFinalization } from "@/lib/ai/finalize-dispatch";
import { aiFeature, type AiJobRow, type AiJobStatus } from "@/lib/ai/jobs";
import { recordProviderOutput, transitionJob, noteJobDiagnostic } from "@/lib/ai/job-store";
import { notifyAiCleanFailed } from "@/lib/ai/notify";
import { providerFor } from "@/lib/ai/providers";
import { subjectFromRow } from "@/lib/ai/subject";
import { releaseAiUsage } from "@/lib/ai/usage";

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
export async function reconcileWithProvider(job: AiJobRow, now: number = Date.now()): Promise<boolean> {
  if (!job.replicate_prediction_id || !due(job, now)) return false;

  const feature = aiFeature(job.feature);
  if (!feature) return false;
  const provider = providerFor(feature.provider);
  if (!provider || !provider.isConfigured()) return false;

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
      return await failFrom(job, "PROCESSING_FAILED", state.detail);
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
    await notifyAiCleanFailed({
      userId: subject.userId,
      jobId: job.id,
      message: "The cleanup didn't finish. Your allowance wasn't used — you can try again.",
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
    await releaseAiUsage(subject, def.id, entitlement.dailyLimit);
  } catch (e) {
    console.error("[ai/reconcile] refund failed", { jobId: job.id, error: String(e) });
  }
}
