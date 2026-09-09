import "server-only";

import { AI_JOB_STATUSES, type AiJobStatus } from "@/lib/ai/jobs";
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
