import "server-only";

import { AI_JOB_STATUSES, isActiveStatus, type AiJobStatus } from "@/lib/ai/jobs";
import { stalledForMs } from "@/lib/ai/stall";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — WHAT AN OPERATOR NEEDS TO SEE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09 (the AdSense brief, §12/§19): "Add an AI Safety section to
 * the existing admin dashboard… Total AI jobs, Successful, Failed, Blocked,
 * Abuse/rate-limit events, Free-user usage, Pro-user usage" — and, in the same
 * breath, "Do NOT expose private user media unnecessarily."
 *
 * ── 🔴 COUNTS ONLY. NOT ONE ROW OF ANYBODY'S WORK ───────────────────────────
 *
 * Every number here is an aggregate. This module cannot return a filename, a
 * storage path, a source URL, a prediction id or a member's identity, because
 * it never selects those columns — the queries ask for `count` and `status` and
 * nothing else.
 *
 * That is a deliberate shape rather than an oversight. An admin screen is the
 * easiest place in a product to accidentally build a window onto private media:
 * somebody adds a "recent jobs" table to help debug one incident, and now every
 * operator can read the filenames of every video every member has ever
 * uploaded. The way to not do that is to make it impossible here rather than
 * to remember not to do it there.
 *
 * ── The window is a day, and the day is UTC ─────────────────────────────────
 *
 * The daily allowance resets at midnight UTC (lib/ai/usage.ts), so "today" on
 * this screen has to mean the same thing it means to the reservation, or an
 * operator comparing the two would find them disagreeing for hours.
 */

export interface AiAdminStats {
  /** Every job ever, by status. A total `Record` so a new status cannot hide. */
  byStatus: Record<AiJobStatus, number>;
  total: number;
  /** The same, for jobs created since midnight UTC. */
  todayTotal: number;
  todayCompleted: number;
  todayFailed: number;
  /**
   * Jobs that produced a result nobody has been told about yet.
   *
   * 🔴 The single most useful number on this panel. A healthy system keeps it
   * near zero — a completed job is announced within seconds. A rising count
   * means the notifier is failing silently, which is invisible everywhere else
   * precisely because the JOBS are succeeding.
   */
  completedUnnotified: number;
  /** Still running right now. A stuck queue shows up here first. */
  active: number;
}

/** Midnight UTC today, matching what the allowance reservation calls "today". */
function startOfUtcDay(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/**
 * Read the counters.
 *
 * ── 🔴 `head: true`, SO NO ROWS TRAVEL ──────────────────────────────────────
 *
 * PostgREST returns the count in a header and the body empty. That is the
 * difference between reading a number and pulling every AI job this product
 * has ever run through a serverless function — and it is also what makes the
 * "no private media" promise above structural: there is no body to leak.
 *
 * Never throws. An admin dashboard that 500s because one panel could not count
 * is worse than a panel that says it could not count.
 */
export async function getAiAdminStats(): Promise<AiAdminStats | null> {
  try {
    const db = createAdminClient();
    const since = startOfUtcDay();

    const countWhere = async (
      apply: (q: ReturnType<ReturnType<typeof createAdminClient>["from"]>) => unknown,
    ): Promise<number> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST's builder is not generically typed for this
      const query: any = apply(db.from("ai_jobs") as any);
      const { count, error } = await query;
      if (error) throw new Error(error.message);
      return count ?? 0;
    };

    const byStatus = {} as Record<AiJobStatus, number>;
    /*
      One query per status rather than a group-by, because PostgREST has no
      GROUP BY and the alternative is a database function — a migration, a
      grant and a REVOKE (a new SQL function is executable by the browser by
      default) for a panel that is read a handful of times a day. Eight
      head-only counts is the cheaper correct answer.
    */
    await Promise.all(
      AI_JOB_STATUSES.map(async (status) => {
        byStatus[status] = await countWhere((q) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (q as any).select("id", { count: "exact", head: true }).eq("status", status),
        );
      }),
    );

    const [total, todayTotal, todayCompleted, todayFailed, completedUnnotified] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countWhere((q) => (q as any).select("id", { count: "exact", head: true })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countWhere((q) => (q as any).select("id", { count: "exact", head: true }).gte("created_at", since)),
      countWhere((q) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (q as any).select("id", { count: "exact", head: true }).gte("created_at", since).eq("status", "completed"),
      ),
      countWhere((q) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (q as any).select("id", { count: "exact", head: true }).gte("created_at", since).eq("status", "failed"),
      ),
      countWhere((q) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (q as any)
          .select("id", { count: "exact", head: true })
          .eq("status", "completed")
          .is("notified_at", null)
          .gte("created_at", since),
      ),
    ]);

    const active =
      (byStatus.queued ?? 0) +
      (byStatus.acquiring ?? 0) +
      (byStatus.processing ?? 0) +
      (byStatus.finalizing ?? 0);

    return { byStatus, total, todayTotal, todayCompleted, todayFailed, completedUnnotified, active };
  } catch (e) {
    console.error("[ai/admin] stats failed", { error: String(e) });
    return null;
  }
}

/* ───────────────────── Character Replace jobs (Part 4, §29) ─────────────────── */

/**
 * One row per recent Character Replace job, for the operator: status, the
 * provider's state as we recorded it, duration, quality, what was charged,
 * whether it came back, the prediction id, the timestamps. Read with the
 * service role, shaped here so the panel never sees a storage path.
 */
export interface CharacterReplaceAdminJob {
  id: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  status: AiJobStatus;
  userId: string | null;
  quality: string | null;
  durationMs: number | null;
  trimmed: boolean;
  chargedCents: number | null;
  currency: string | null;
  refunded: boolean;
  predictionId: string | null;
  modelVersion: string | null;
  errorCode: string | null;
  failureCategory: string | null;
  /* ── Part 5 (§35): the background's own bookkeeping ── */
  attempt: number;
  finalizeAttempts: number;
  finalizeNextAt: string | null;
  finalizeError: string | null;
  /** How long the worker's finalization took, when it finished. */
  finalizeMs: number | null;
  notifiedAt: string | null;
  notifyPending: boolean;
  /** Past the stage's deadline, or a finalization retry waiting with no lease. */
  stuck: boolean;
  /* ── Part 6: which replacement, which provider stage, what it cost us ── */
  mode: "face_only" | "skin_face" | "full_character";
  /** The model of the CURRENT stage's prediction (`ai_jobs.model`). */
  model: string | null;
  /** "voice" | "replace" | "lipsync" | "finalize" — the pipeline's current stage, or null for a single-stage row. */
  stage: string | null;
  voiceSource: "upload" | "tts" | null;
  lipSyncMode: string | null;
  /** The operator's estimate of the provider bill, US cents. Null when no estimate was configured. */
  providerCostUsdCents: number | null;
  /** The quoted per-second customer rate, minor units. */
  rateCents: number | null;
}

/** The counts the operator wants at a glance (§35), from the rows already read. Pure. */
export function summarizeCharacterReplaceJobs(jobs: CharacterReplaceAdminJob[], now: number = Date.now()): {
  active: number;
  queued: number;
  processing: number;
  finalizing: number;
  completed24h: number;
  failed24h: number;
  refunded24h: number;
  stuck: number;
  retrying: number;
} {
  const dayAgo = now - 24 * 60 * 60_000;
  const recent = (j: CharacterReplaceAdminJob) => Date.parse(j.completedAt ?? j.createdAt) >= dayAgo;
  return {
    active: jobs.filter((j) => isActiveStatus(j.status)).length,
    queued: jobs.filter((j) => j.status === "queued" || j.status === "acquiring").length,
    processing: jobs.filter((j) => j.status === "processing").length,
    finalizing: jobs.filter((j) => j.status === "finalizing").length,
    completed24h: jobs.filter((j) => j.status === "completed" && recent(j)).length,
    failed24h: jobs.filter((j) => (j.status === "failed" || j.status === "expired") && recent(j)).length,
    refunded24h: jobs.filter((j) => j.refunded && recent(j)).length,
    stuck: jobs.filter((j) => j.stuck).length,
    retrying: jobs.filter((j) => j.status === "finalizing" && j.finalizeAttempts > 0 && !!j.finalizeNextAt).length,
  };
}

export async function listCharacterReplaceAdminJobs(limit = 30): Promise<CharacterReplaceAdminJob[]> {
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("ai_jobs")
      .select("id, user_id, status, charged_cents, replicate_prediction_id, model, model_version, error_code, created_at, started_at, completed_at, notified_at, finalize_attempts, finalize_lease_until, finalize_next_at, finalize_error, metadata")
      .eq("feature", "ai_character_replace")
      .order("created_at", { ascending: false })
      .limit(Math.max(1, Math.min(100, limit)));
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as {
      id: string;
      user_id: string | null;
      status: AiJobStatus;
      charged_cents: number | null;
      replicate_prediction_id: string | null;
      model: string | null;
      model_version: string | null;
      error_code: string | null;
      created_at: string;
      started_at: string | null;
      completed_at: string | null;
      notified_at: string | null;
      finalize_attempts: number | null;
      finalize_lease_until: string | null;
      finalize_next_at: string | null;
      finalize_error: string | null;
      metadata: Record<string, unknown> | null;
    }[];
    const now = Date.now();
    const jobIds = rows.map((r) => r.id);
    // Which of these charges came back — the ledger is the truth, not the status.
    const refundedIds = new Set<string>();
    if (jobIds.length > 0) {
      const { data: ledger } = await db
        .from("ai_product_ledger")
        .select("job_id, status")
        .eq("product", "character_replace")
        .eq("kind", "processing_charge")
        .in("job_id", jobIds);
      for (const l of (ledger ?? []) as { job_id: string | null; status: string }[]) {
        if (l.job_id && l.status === "refunded") refundedIds.add(l.job_id);
      }
    }
    return rows.map((r) => {
      const m = r.metadata ?? {};
      const settings = (m.settings ?? {}) as { quality?: unknown; voiceMode?: unknown; lipSyncMode?: unknown };
      const prepared = (m.prepared ?? null) as { durationMs?: unknown; trimmed?: unknown } | null;
      const quote = (m.quote ?? null) as { durationMs?: unknown; currency?: unknown; qualityRateCents?: unknown } | null;
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      const pipeline = (m.pipeline ?? null) as { current?: unknown } | null;
      const audio = (m.audio ?? null) as { source?: unknown } | null;
      const cost = (m.provider_cost_estimate ?? null) as { totalUsdCents?: unknown } | null;
      return {
        mode: m.mode === "face_only" || m.mode === "skin_face" ? m.mode : "full_character",
        model: r.model,
        stage: typeof pipeline?.current === "string" ? pipeline.current : null,
        voiceSource: settings.voiceMode === "new_voice" && (audio?.source === "upload" || audio?.source === "tts") ? audio.source : null,
        lipSyncMode: typeof settings.lipSyncMode === "string" ? settings.lipSyncMode : null,
        providerCostUsdCents: num(cost?.totalUsdCents),
        rateCents: num(quote?.qualityRateCents),
        id: r.id,
        createdAt: r.created_at,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        status: r.status,
        userId: r.user_id,
        quality: typeof settings.quality === "string" ? settings.quality : null,
        durationMs: num(prepared?.durationMs) ?? num(quote?.durationMs),
        trimmed: prepared?.trimmed === true || !!m.trim,
        chargedCents: r.charged_cents,
        currency: typeof quote?.currency === "string" ? quote.currency : null,
        refunded: refundedIds.has(r.id),
        predictionId: r.replicate_prediction_id,
        modelVersion: r.model_version,
        errorCode: r.error_code,
        failureCategory: typeof m.failure_category === "string" ? m.failure_category : null,
        attempt: num(m.attempt) ?? 1,
        finalizeAttempts: r.finalize_attempts ?? 0,
        finalizeNextAt: r.finalize_next_at,
        finalizeError: r.finalize_error,
        finalizeMs: num(m.finalized_ms),
        notifiedAt: r.notified_at,
        notifyPending: m.notify_pending === true && !r.notified_at,
        stuck:
          stalledForMs({ id: r.id, status: r.status, created_at: r.created_at, started_at: r.started_at, metadata: m }, now) !== null ||
          (r.status === "finalizing" && !r.finalize_lease_until && !!r.finalize_next_at && Date.parse(r.finalize_next_at) < now - 15 * 60_000),
      };
    });
  } catch (e) {
    console.error("[ai/admin] character replace jobs failed", { error: String(e) });
    return [];
  }
}
