import "server-only";

import type { CharacterReplaceAdminJob } from "@/lib/ai/admin-job-view";
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

// The row type and the glance summary live in lib/ai/admin-job-view.ts (pure) since 0166 — the job monitor is a client component now.
export { summarizeCharacterReplaceJobs, type CharacterReplaceAdminJob } from "@/lib/ai/admin-job-view";

export async function listCharacterReplaceAdminJobs(limit = 30): Promise<CharacterReplaceAdminJob[]> {
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("ai_jobs")
      .select("id, user_id, status, charged_cents, replicate_prediction_id, model, model_version, error_code, created_at, started_at, completed_at, notified_at, finalize_attempts, finalize_lease_until, finalize_next_at, finalize_error, metadata, batch_id, batch_index")
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
      batch_id?: string | null;
      batch_index?: number | null;
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
      const batch = (m.batch ?? null) as { size?: unknown } | null;
      const queue = (m.queue ?? null) as { queued_at?: unknown; admitted_at?: unknown } | null;
      const queuedAt = typeof queue?.queued_at === "string" ? Date.parse(queue.queued_at) : NaN;
      const admittedAt = typeof queue?.admitted_at === "string" ? Date.parse(queue.admitted_at) : NaN;
      const billing = (m.billing ?? null) as { type?: unknown } | null;
      return {
        batchId: r.batch_id ?? null,
        batchIndex: typeof r.batch_index === "number" ? r.batch_index : null,
        batchSize: num(batch?.size),
        audience: typeof m.audience === "string" ? m.audience : null,
        waitedMs: Number.isFinite(queuedAt) ? Math.max(0, (Number.isFinite(admittedAt) ? admittedAt : r.status === "waiting" ? now : queuedAt) - queuedAt) : null,
        fileName: typeof m.source_name === "string" ? m.source_name : null,
        billing: billing?.type === "FREE_TRIAL" ? "FREE_TRIAL" : billing?.type === "PAID" ? "PAID" : null,
        mode: m.mode === "face_only" || m.mode === "skin_face" || m.mode === "upper_body" ? m.mode : "full_character",
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


/* ───────────────────── Part 11 §19: complimentary creations & anti-abuse ── */

export interface CharacterReplaceFreeAccessStats {
  accountsGranted: number;
  creationsGranted: number;
  creationsConsumed: number;
  creationsSettled: number;
  creationsRestored: number;
  accountsAtDeviceLimit: number;
  devicesAtLimit: number;
  /** Members who used at least one complimentary creation AND later recharged. */
  freeToPaidAccounts: number;
  /** The normal price of every complimentary creation that was delivered — what the offer "cost" in retail terms, minor units. */
  deliveredNormalPriceCents: number;
  currency: string;
  /** Paid Character Replace charges settled, all time, minor units — with the operator's provider cost estimate beside it. */
  revenueCents: number;
  providerCostUsdCents: number;
}

export async function getCharacterReplaceFreeAccessStats(currency: string): Promise<CharacterReplaceFreeAccessStats | null> {
  try {
    const admin = createAdminClient();
    const [ent, uses, devices, ledger, costs] = await Promise.all([
      admin.from("ai_free_entitlements").select("user_id, granted, used, restored, eligibility"),
      admin.from("ai_free_uses").select("user_id, status, normal_price_cents").limit(5000),
      admin.from("ai_device_associations").select("device_hash, risk_state").eq("risk_state", "limit_reached"),
      admin.from("ai_product_ledger").select("user_id, kind, status, delta_cents").in("kind", ["recharge", "processing_charge"]).limit(5000),
      admin.from("ai_jobs").select("metadata").eq("feature", "ai_character_replace").eq("status", "completed").not("metadata->provider_cost_estimate", "is", null).limit(2000),
    ]);
    const rows = (ent.data ?? []) as { user_id: string; granted: number; used: number; restored: number; eligibility: string }[];
    const useRows = (uses.data ?? []) as { user_id: string; status: string; normal_price_cents: number }[];
    const rechargers = new Set(((ledger.data ?? []) as { user_id: string; kind: string }[]).filter((l) => l.kind === "recharge").map((l) => l.user_id));
    const freeUsers = new Set(useRows.map((u) => u.user_id));
    let freeToPaid = 0;
    for (const u of freeUsers) if (rechargers.has(u)) freeToPaid += 1;
    const revenueCents = ((ledger.data ?? []) as { kind: string; status: string; delta_cents: number }[])
      .filter((l) => l.kind === "processing_charge" && l.status === "settled")
      .reduce((a, l) => a + Math.abs(Number(l.delta_cents)), 0);
    const providerCostUsdCents = ((costs.data ?? []) as { metadata: { provider_cost_estimate?: { totalUsdCents?: unknown } } }[])
      .reduce((a, r) => a + (typeof r.metadata?.provider_cost_estimate?.totalUsdCents === "number" ? r.metadata.provider_cost_estimate.totalUsdCents : 0), 0);
    return {
      accountsGranted: rows.filter((r) => r.granted > 0).length,
      creationsGranted: rows.reduce((a, r) => a + Number(r.granted), 0),
      creationsConsumed: useRows.filter((u) => u.status !== "restored").length,
      creationsSettled: useRows.filter((u) => u.status === "settled").length,
      creationsRestored: useRows.filter((u) => u.status === "restored").length,
      accountsAtDeviceLimit: rows.filter((r) => r.eligibility === "device_limit").length,
      devicesAtLimit: new Set(((devices.data ?? []) as { device_hash: string }[]).map((d) => d.device_hash)).size,
      freeToPaidAccounts: freeToPaid,
      deliveredNormalPriceCents: useRows.filter((u) => u.status === "settled").reduce((a, u) => a + Number(u.normal_price_cents), 0),
      currency,
      revenueCents,
      providerCostUsdCents,
    };
  } catch (e) {
    console.error("[ai/admin-stats] free access stats failed", { error: String(e).slice(0, 160) });
    return null;
  }
}
