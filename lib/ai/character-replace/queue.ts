import "server-only";

import { concurrencyLimitFor } from "@/lib/ai/character-replace/config";
import { dispatchPreparation } from "@/lib/ai/character-replace/prepare-dispatch";
import { audienceFromPlan } from "@/lib/ai/audience";
import { releaseJobFunding } from "@/lib/ai/funding";
import { recordJobEvent } from "@/lib/ai/job-events";
import { aiFeature, type AiFeature } from "@/lib/ai/jobs";
import { admitWaitingJobs, getJobAsService, listWaitingUserIds, noteJobDiagnostic, transitionJob } from "@/lib/ai/job-store";
import { policyFor } from "@/lib/ai/policy";
import { subjectFromRow } from "@/lib/ai/subject";
import { getLandingSettings } from "@/lib/landing/settings";
import { getUserPlan } from "@/lib/monetization/plan";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasWorker } from "@/lib/worker";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE QUEUE PUMP — a member's next video starts when one of theirs finishes
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-21 (multi-video brief §3, §7, §15): "The queue must be
 * server-controlled … If the user closes the browser, jobs continue … Two
 * jobs finish at exactly the same time. The system must not accidentally
 * start 4 new jobs when the user is only allowed 2."
 *
 * There is no queue process and no in-memory list. The queue IS the rows in
 * `waiting` (0166), and this function is the only thing that moves them:
 *
 *   1. read the operator's switches — paused or in maintenance, nothing is
 *      admitted (the rows keep waiting; the sweep pumps again later);
 *   2. for each member with a waiting row (or the one named), work out THEIR
 *      cap — the plan's, the operator's per-plan figure, an administrator's,
 *      tightened by the global per-member cap — the same function /start uses;
 *   3. `admit_ai_waiting_jobs`: under the start lock, move as many waiting
 *      rows as the free slots allow to `acquiring`. Two pumps racing (two
 *      webhooks in the same second) are serialised by the lock and the second
 *      finds nothing left to admit — the cap holds by construction;
 *   4. hand each admitted job to the worker exactly as /start does. A refused
 *      hand-off ends that job with its reservation refunded, once.
 *
 * ── Who calls it, and from where ────────────────────────────────────────────
 * Every place a slot frees: `releaseJobFunding` (every failure and cancel,
 * on both hosts), the finalizer's completion (the worker), the cancel route,
 * /start after a `waiting` verdict, and the ten-minute reconcile sweep as the
 * safety net for anything the live paths missed. Calling it when nothing is
 * waiting costs one indexed read.
 *
 * The provider credentials live on Vercel and the dispatch goes Vercel →
 * worker, so the pump RUNS on the frontend. The worker asks for one through
 * `/api/internal/ai/queue` — the same worker → frontend hop as the submit and
 * the notification (`requestQueuePump` in queue-signal.ts knows which host it
 * is on; it lives apart so lib/ai/funding.ts can import it without a cycle).
 */

const FEATURE: AiFeature = "ai_character_replace";
/** A waiting row without a reservation stamp this old is a start whose reservation never finished (the process died between the claim and the ledger). */
const UNRESERVED_WAIT_MS = 5 * 60_000;

export interface PumpResult {
  users: number;
  admitted: string[];
  dispatched: number;
  failed: number;
  expired: number;
  skipped: string | null;
}

async function isAdminUserId(userId: string): Promise<boolean> {
  try {
    const { data } = await createAdminClient().from("profiles").select("role, is_admin").eq("id", userId).maybeSingle();
    const p = data as { role?: string | null; is_admin?: boolean | null } | null;
    return !!p && (p.is_admin === true || p.role === "admin");
  } catch {
    return false;
  }
}

/** Waiting rows whose reservation never completed — ended, once, so they cannot hold the member's line for a day. */
async function expireUnreservedWaiting(userId: string, now: number): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin.from("ai_jobs").select("id, user_id, guest_id, funding_source, metadata, created_at").eq("user_id", userId).eq("feature", FEATURE).eq("status", "waiting").limit(20);
  let expired = 0;
  for (const row of (data ?? []) as { id: string; user_id: string | null; guest_id: string | null; funding_source: "free" | "balance" | "credits" | null; metadata: Record<string, unknown> | null; created_at: string }[]) {
    const queue = (row.metadata?.queue ?? null) as { queued_at?: unknown; reserved_at?: unknown } | null;
    if (queue?.reserved_at) continue;
    const queuedAt = typeof queue?.queued_at === "string" ? Date.parse(queue.queued_at) : Date.parse(row.created_at);
    if (!Number.isFinite(queuedAt) || now - queuedAt < UNRESERVED_WAIT_MS) continue;
    const ended = await transitionJob(row.id, ["waiting"], "failed", { error_code: "PREPARATION_FAILED", error_message: "queue: the reservation never completed", completed_at: new Date(now).toISOString() });
    if (!ended) continue;
    expired += 1;
    const subject = subjectFromRow(row);
    // Idempotent and safe either way: nothing reserved → no-op; reserved but never stamped → the money comes back.
    if (subject) await releaseJobFunding({ job: ended, subject, feature: FEATURE, dailyLimit: 0, cause: "undo" });
    await recordJobEvent(row.id, "queue.expired", { reason: "reservation never confirmed", waitedMs: now - queuedAt });
  }
  return expired;
}

export async function pumpCharacterReplaceQueue(opts: { userId?: string | null; reason: string; now?: number } = { reason: "unspecified" }): Promise<PumpResult> {
  const result: PumpResult = { users: 0, admitted: [], dispatched: 0, failed: 0, expired: 0, skipped: null };
  const feature = aiFeature(FEATURE);
  if (!feature) return { ...result, skipped: "feature unknown" };
  if (!hasWorker) return { ...result, skipped: "no worker configured on this host" };
  const settings = await getLandingSettings();
  const config = settings.frenzAiCharacterReplace;
  if (!config.enabled) return { ...result, skipped: "tool disabled" };
  if (config.ops.maintenanceMode) return { ...result, skipped: "maintenance" };
  if (!config.ops.processingEnabled) return { ...result, skipped: "processing paused" };
  const now = opts.now ?? Date.now();

  const users = opts.userId ? [opts.userId] : await listWaitingUserIds(FEATURE);
  result.users = users.length;
  for (const userId of users) {
    try {
      result.expired += await expireUnreservedWaiting(userId, now);
      const [plan, isAdmin] = await Promise.all([getUserPlan(userId), isAdminUserId(userId)]);
      const audience = audienceFromPlan(plan);
      const cap = concurrencyLimitFor(config, { audience, isAdmin, policyMaxConcurrent: policyFor(audience, FEATURE).maxConcurrent });
      const admitted = await admitWaitingJobs({ userId, feature: FEATURE, maxActivePerUser: cap, maxActiveGlobal: config.limits.maxActiveJobsGlobal, limit: cap });
      for (const jobId of admitted) {
        result.admitted.push(jobId);
        await recordJobEvent(jobId, "queue.admitted", { reason: opts.reason, cap, audience: isAdmin ? "admin" : audience });
        const handoff = await dispatchPreparation(jobId);
        if (handoff.dispatched) {
          result.dispatched += 1;
          console.info("[cr/queue] admitted and handed off", { jobId, userId, cap, reason: opts.reason, transition: "waiting -> acquiring" });
          continue;
        }
        if (handoff.reason !== "refused") {
          /*
            A TRANSIENT miss (the worker timed out, a 5xx, a network blip): the
            worker never received the request, so nothing runs for this job.
            It stays `acquiring` with the miss on the row and the reconcile
            sweep re-dispatches it (lib/ai/recovery.ts) — a whole batch is not
            failed and refunded for a thirty-second hiccup. Only a 401/403/404,
            which no retry can improve, ends the job here.
          */
          await noteJobDiagnostic(jobId, { prepare_dispatch: "failed", prepare_detail: handoff.detail.slice(0, 300), prepare_from: "queue" });
          await recordJobEvent(jobId, "queue.dispatch_failed", { reason: handoff.reason, detail: handoff.detail.slice(0, 300), retry: "sweep" });
          console.warn("[cr/queue] admitted, worker did not take it yet — the sweep will re-dispatch", { jobId, userId, reason: handoff.reason });
          continue;
        }
        /*
          The same ending /start gives a REFUSED hand-off: the job fails now,
          honestly, with its reservation refunded once — never left in
          `acquiring` holding the member's money with nothing coming.
        */
        result.failed += 1;
        const row = await getJobAsService(jobId);
        const subject = row ? subjectFromRow(row) : null;
        if (row && subject) await releaseJobFunding({ job: row, subject, feature: FEATURE, dailyLimit: 0, cause: "undo" });
        await transitionJob(jobId, ["acquiring"], "failed", { error_code: "PREPARATION_FAILED", error_message: handoff.detail.slice(0, 2000), completed_at: new Date().toISOString() });
        if (row) await createAdminClient().from("ai_jobs").update({ metadata: { ...(row.metadata ?? {}), failure_category: "system", failed_in: "queue_dispatch" } }).eq("id", jobId);
        await recordJobEvent(jobId, "queue.dispatch_failed", { reason: handoff.reason, detail: handoff.detail.slice(0, 300) });
        console.error("[cr/queue] admitted but the worker refused — ended with a refund", { jobId, userId, reason: handoff.reason, detail: handoff.detail });
      }
    } catch (e) {
      console.error("[cr/queue] pump failed for a member", { userId, reason: opts.reason, error: String(e).slice(0, 300) });
    }
  }
  return result;
}
