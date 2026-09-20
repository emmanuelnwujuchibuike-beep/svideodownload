import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE AUDIT TRAIL — what the background did to a job while nobody watched
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Part 5 (owner, 2026-09-14, §36): "Log important background events: webhook
 * received, job state transitions, finalization retries, notification sends,
 * refund triggers, admin recovery actions. This helps debugging without
 * exposing sensitive data."
 *
 * One append-only row per event in `ai_job_events` (0156). It is the record
 * the admin monitor shows under a job and the thing an operator reads instead
 * of Vercel logs when a member asks "what happened to my video".
 *
 * ── Best-effort, never load-bearing ─────────────────────────────────────────
 * An audit write must never fail the job it describes: this catches, logs and
 * returns. The job row is the source of truth; this is the narrative.
 *
 * ── What goes in `detail` ───────────────────────────────────────────────────
 * Ids, codes, counts, durations, an operator's user id and reason. Never a
 * provider's stack trace, never a signed URL, never a member's file name.
 */
export type AiJobEventKind =
  | "webhook.received"
  | "webhook.ignored"
  | "provider.submitted"
  | "prepare.started"
  | "prepare.failed"
  /* Part 6: the voice, and the hand-over between provider stages */
  | "audio.prepared"
  | "audio.rejected"
  /** 2026-09-20: a reference image re-encoded plain for the provider — or not, with why. */
  | "reference.prepared"
  | "reference.prepare_failed"
  | "advance.claimed"
  | "advance.completed"
  | "advance.failed"
  | "advance.retry_scheduled"
  /* Part 7: what the member did with the result */
  | "result.saved"
  | "result.unsaved"
  | "result.deleted"
  | "finalize.claimed"
  | "finalize.retry_scheduled"
  | "finalize.gave_up"
  | "finalize.completed"
  | "finalize.failed"
  | "notify.sent"
  | "notify.handed_off"
  | "notify.pending"
  | "notify.skipped"
  | "refund.issued"
  | "reconcile.provider"
  | "reconcile.redispatched"
  | "stall.failed"
  | "admin.retry_finalization"
  | "admin.reconcile"
  | "admin.retry_notification"
  | "admin.refund";

export async function recordJobEvent(
  jobId: string,
  kind: AiJobEventKind,
  detail: Record<string, unknown> = {},
  actor: string = "system",
): Promise<void> {
  try {
    const { error } = await createAdminClient()
      .from("ai_job_events")
      .insert({ job_id: jobId, kind, actor: actor.slice(0, 80), detail });
    if (error) console.error("[ai/events] write failed", { jobId, kind, message: error.message });
  } catch (e) {
    console.error("[ai/events] write threw", { jobId, kind, error: String(e).slice(0, 200) });
  }
}

export interface AiJobEventRow {
  id: number;
  job_id: string;
  at: string;
  kind: string;
  actor: string;
  detail: Record<string, unknown>;
}

/** The newest events of one job, for the admin monitor. Service role; the caller has already checked it is an admin. */
export async function listJobEvents(jobId: string, limit = 50): Promise<AiJobEventRow[]> {
  const { data, error } = await createAdminClient()
    .from("ai_job_events")
    .select("id, job_id, at, kind, actor, detail")
    .eq("job_id", jobId)
    .order("at", { ascending: false })
    .limit(Math.max(1, Math.min(200, limit)));
  if (error) {
    console.error("[ai/events] list failed", { jobId, message: error.message });
    return [];
  }
  return (data ?? []) as AiJobEventRow[];
}
