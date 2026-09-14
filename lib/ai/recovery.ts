import "server-only";

import { FINALIZE_MAX_ATTEMPTS as MAX_FINALIZE_ATTEMPTS } from "@/lib/ai/character-replace/finalize-policy";
import { readPipeline } from "@/lib/ai/character-replace/job-meta";
import { isProviderStage, nextStage } from "@/lib/ai/character-replace/pipeline";
import { aiErrorMessage } from "@/lib/ai/errors";
import { dispatchAdvance, dispatchFinalization } from "@/lib/ai/finalize-dispatch";
import { aiFeature } from "@/lib/ai/jobs";
import { submitJobToProvider } from "@/lib/ai/submit";
import { releaseJobFunding } from "@/lib/ai/funding";
import { recordJobEvent } from "@/lib/ai/job-events";
import { listNotifyPendingJobs, listRecoverableJobs, transitionJob } from "@/lib/ai/job-store";
import { type AiJobRow } from "@/lib/ai/jobs";
import { notifyAiJobFailed, notifyAiJobFromRow } from "@/lib/ai/notify";
import { reconcileWithProvider } from "@/lib/ai/reconcile";
import { failStalledJob } from "@/lib/ai/stall-server";
import { subjectFromRow } from "@/lib/ai/subject";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  RECOVERY — the pass that finishes what the events did not
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Part 5 (owner, 2026-09-14, §12–§13, §33): a scheduled reconciliation that
 * finds jobs stuck in a stage past their expected time, finalizations that
 * failed on our side and are due another go, provider work whose webhook
 * never arrived, and announcements left pending — and moves each one along
 * with the SAME functions the live paths use. Nothing here is a second
 * queue: a due retry is re-dispatched to the same worker route the webhook
 * calls; a missed webhook is read from the provider by the same reconciler
 * the member's poll calls; a stalled row is ended by the same stall sweep.
 *
 * Two callers:
 *   · the cron (`/api/cron/ai-reconcile`, GitHub Actions every 10 min) — for
 *     the jobs nobody is polling, which is exactly the "member left the app"
 *     case this Part exists for;
 *   · the member's poll — the same `recoverJob` on the one row they are
 *     looking at, so a due retry runs the moment they look rather than at
 *     the next tick.
 *
 * Every step is idempotent with the live path: a compare-and-set claim on
 * the worker, a claim on the notification, a refund that is idempotent per
 * job. Running this twice, or while a webhook lands, changes nothing twice.
 */

/** A recorded provider URL whose dispatch note is this fresh is still in flight — leave it to the worker. */
const DISPATCH_GRACE_MS = 3 * 60_000;

/** Replicate keeps a prediction's output about an hour; a retry after that cannot download it. */
const PROVIDER_OUTPUT_LIFETIME_MS = 60 * 60_000;

/**
 * One recovery attempt per job per instance every 30 s. The workspace polls
 * every few seconds and history every few seconds while a job is live; the
 * step itself is cheap, but the provider read behind it should not be.
 */
const RECOVERY_EVERY_MS = 30_000;
const lastRecovery = new Map<string, number>();
export function recoveryDue(jobId: string, now: number = Date.now()): boolean {
  const last = lastRecovery.get(jobId) ?? 0;
  if (now - last < RECOVERY_EVERY_MS) return false;
  lastRecovery.set(jobId, now);
  if (lastRecovery.size > 500) lastRecovery.clear();
  return true;
}

export type RecoveryAction =
  | "none"
  | "working"
  | "redispatched"
  | "redispatch-failed"
  | "gave-up"
  | "reconciled"
  | "stalled"
  | "notified";

/**
 * Bring ONE job one step forward, if it is owed one. Never throws.
 */
export async function recoverJob(row: AiJobRow, now: number = Date.now()): Promise<RecoveryAction> {
  try {
    const meta = row.metadata ?? {};
    const providerUrl = typeof meta.provider_output_url === "string" ? meta.provider_output_url : null;
    const leased = !!row.finalize_lease_until && Date.parse(row.finalize_lease_until) > now;
    const due = !row.finalize_next_at || Date.parse(row.finalize_next_at) <= now;
    // 🔴 The lease/retry stage is Character Replace's. AI Clean's finalizer keeps
    // its own claim and its own deadline; this pass only reconciles and stalls it.
    const retryable = row.feature === "ai_character_replace";

    /* ── a finalization in progress or waiting its turn ──────────────────── */
    if (row.status === "finalizing" && retryable) {
      if (leased) return "working";
      if (row.finalize_attempts >= MAX_FINALIZE_ATTEMPTS || providerOutputExpired(row, now)) {
        return (await giveUpFinalization(row, now)) ? "gave-up" : "none";
      }
      if (!due) return "none";
      return await redispatch(row, "finalizing");
    }

    /* ── Part 6: a finished stage the worker never brought home ───────────── */
    const pipeline = retryable ? readPipeline(row.metadata) : null;
    if (row.status === "processing" && pipeline?.pending_advance && isProviderStage(pipeline.pending_advance)) {
      const following = nextStage(pipeline, pipeline.pending_advance);
      if (following && isProviderStage(following)) {
        const notedAt = typeof meta.noted_at === "string" ? Date.parse(meta.noted_at) : NaN;
        if (meta.advance_dispatch === "ok" && Number.isFinite(notedAt) && now - notedAt < DISPATCH_GRACE_MS) return "working";
        if (leased) return "working";
        const dispatch = await dispatchAdvance(row.id);
        await recordJobEvent(row.id, "reconcile.redispatched", { from: "processing", stage: pipeline.pending_advance, kind: "advance", dispatched: dispatch.dispatched, ...(dispatch.dispatched ? {} : { reason: dispatch.reason }) });
        return dispatch.dispatched ? "redispatched" : "redispatch-failed";
      }
    }

    /* ── Part 6: a stage advanced but its prediction was never created ──────── */
    if (row.status === "processing" && pipeline && pipeline.current !== "finalize" && (pipeline.records[pipeline.current]?.status ?? "pending") === "pending" && !pipeline.pending_advance) {
      if (leased) return "working";
      const stageStarted = typeof pipeline.stage_started_at === "string" ? Date.parse(pipeline.stage_started_at) : NaN;
      // The advance wrote the plan a moment ago and the submit may still be in flight; give it the same grace.
      if (Number.isFinite(stageStarted) && now - stageStarted < DISPATCH_GRACE_MS) return "working";
      const feature = aiFeature(row.feature);
      if (feature) {
        try {
          const { row: moved } = await submitJobToProvider(row, feature, { from: ["processing"] });
          await recordJobEvent(row.id, "reconcile.redispatched", { from: "processing", stage: pipeline.current, kind: "submit", submitted: !!moved });
          return moved ? "redispatched" : "working";
        } catch (e) {
          console.error("[ai/recovery] stage submit failed", { jobId: row.id, stage: pipeline.current, error: String(e).slice(0, 200) });
          return "redispatch-failed";
        }
      }
    }

    /* ── the provider finished; did the worker ever hear? ────────────────── */
    if (row.status === "processing" && providerUrl && retryable) {
      const notedAt = typeof meta.noted_at === "string" ? Date.parse(meta.noted_at) : NaN;
      const dispatchOk = meta.finalize_dispatch === "ok";
      if (dispatchOk && Number.isFinite(notedAt) && now - notedAt < DISPATCH_GRACE_MS) return "working";
      if (leased) return "working";
      return await redispatch(row, "processing");
    }

    /* ── the provider owes an answer; ask instead of waiting ─────────────── */
    if ((row.status === "processing" || row.status === "queued") && row.replicate_prediction_id) {
      const changed = await reconcileWithProvider(row, now);
      if (changed) {
        await recordJobEvent(row.id, "reconcile.provider", { from: row.status, predictionId: row.replicate_prediction_id });
        return "reconciled";
      }
    }

    /* ── nothing is coming: the deadline ─────────────────────────────────── */
    if (await failStalledJob(row, now)) {
      await recordJobEvent(row.id, "stall.failed", { from: row.status });
      return "stalled";
    }
    return "none";
  } catch (e) {
    console.error("[ai/recovery] step threw", { jobId: row.id, status: row.status, error: String(e).slice(0, 200) });
    return "none";
  }
}

function providerOutputExpired(row: AiJobRow, now: number): boolean {
  // The URL was recorded when the webhook (or reconcile) saw `succeeded`; the
  // closest clock we hold for that is the first finalize dispatch note. Without
  // one, fall back to started_at + the provider's own window, generously.
  const meta = row.metadata ?? {};
  const noted = typeof meta.noted_at === "string" ? Date.parse(meta.noted_at) : NaN;
  const since = Number.isFinite(noted) ? noted : Date.parse(row.started_at ?? row.created_at);
  if (!Number.isFinite(since)) return false;
  return now - since > PROVIDER_OUTPUT_LIFETIME_MS * 1.5;
}

async function redispatch(row: AiJobRow, from: "processing" | "finalizing"): Promise<RecoveryAction> {
  const dispatch = await dispatchFinalization(row.id);
  await recordJobEvent(row.id, "reconcile.redispatched", {
    from,
    attempt: row.finalize_attempts,
    dispatched: dispatch.dispatched,
    ...(dispatch.dispatched ? {} : { reason: dispatch.reason }),
  });
  if (dispatch.dispatched) return "redispatched";
  console.warn("[ai/recovery] re-dispatch did not land", { jobId: row.id, from, reason: dispatch.reason });
  return "redispatch-failed";
}

/**
 * Every allowed attempt has run (or the provider's file is gone). End the job
 * with the last transient error, refund once, tell the member once. The same
 * three steps the worker's own give-up takes — this is the copy that runs
 * where there is no worker.
 */
export async function giveUpFinalization(row: AiJobRow, now: number = Date.now()): Promise<boolean> {
  const updated = await transitionJob(row.id, ["finalizing"], "failed", {
    error_code: "FINAL_UPLOAD_FAILED",
    error_message: (row.finalize_error ?? "finalization attempts exhausted").slice(0, 2000),
    completed_at: new Date(now).toISOString(),
    finalize_lease_until: null,
    finalize_next_at: null,
  });
  if (!updated) return false;
  await recordJobEvent(row.id, "finalize.gave_up", { attempts: row.finalize_attempts, lastError: row.finalize_error, from: "recovery" });
  const subject = subjectFromRow(updated);
  if (subject) {
    try {
      await releaseJobFunding({ job: updated, subject, feature: "ai_character_replace", dailyLimit: 0 });
      await recordJobEvent(row.id, "refund.issued", { reason: "FINAL_UPLOAD_FAILED", chargedCents: updated.charged_cents, from: "recovery" });
    } catch (e) {
      console.error("[ai/recovery] refund failed", { jobId: row.id, error: String(e).slice(0, 200) });
    }
    if (subject.kind === "user") {
      await notifyAiJobFailed({ userId: subject.userId, jobId: row.id, feature: updated.feature, message: aiErrorMessage("PROCESSING_FAILED"), errorCode: "FINAL_UPLOAD_FAILED" });
    }
  }
  console.error("[ai/recovery] gave up a finalization", { jobId: row.id, attempts: row.finalize_attempts });
  return true;
}

export interface SweepReport {
  scanned: number;
  actions: Record<RecoveryAction, number>;
  notifiedPending: number;
  ms: number;
}

/**
 * The scheduled pass. One page of live rows, oldest first, one step each;
 * then every terminal row whose announcement is still pending.
 */
export async function sweepAiJobs(now: number = Date.now()): Promise<SweepReport> {
  const startedAt = Date.now();
  const actions: Record<RecoveryAction, number> = {
    none: 0, working: 0, redispatched: 0, "redispatch-failed": 0, "gave-up": 0, reconciled: 0, stalled: 0, notified: 0,
  };
  const rows = await listRecoverableJobs(100);
  for (const row of rows) {
    const action = await recoverJob(row, now);
    actions[action] += 1;
  }

  let notifiedPending = 0;
  for (const row of await listNotifyPendingJobs(50)) {
    try {
      const outcome = await notifyAiJobFromRow(row.id, { local: true });
      if (outcome === "sent") notifiedPending += 1;
    } catch (e) {
      console.error("[ai/recovery] pending notify failed", { jobId: row.id, error: String(e).slice(0, 200) });
    }
  }
  actions.notified += notifiedPending;

  const report = { scanned: rows.length, actions, notifiedPending, ms: Date.now() - startedAt };
  console.info("[ai/recovery] sweep", report);
  return report;
}
