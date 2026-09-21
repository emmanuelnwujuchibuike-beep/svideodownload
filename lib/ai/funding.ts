import "server-only";

import { chargeAiBalance, refundAiCharge } from "@/lib/ai/balance";
import { restoreFreeUse } from "@/lib/ai/character-replace/free-access";
import { requestQueuePump } from "@/lib/ai/character-replace/queue-signal";
import { refundCharacterReplaceCharge } from "@/lib/ai/character-replace/wallet";
import { recordJobEvent } from "@/lib/ai/job-events";
import { getLandingSettings } from "@/lib/landing/settings";
import { decideFunding, type AiFundingSource } from "@/lib/ai/economy";
import type { AiFeature, AiJobRow } from "@/lib/ai/jobs";
import type { AiSubject } from "@/lib/ai/subject";
import { releaseAiUsage, reserveAiUsage } from "@/lib/ai/usage";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — TAKING PAYMENT FOR ONE JOB, AND GIVING IT BACK
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09, standing rule §12: "AI balance deduction must be
 * server-side and atomic… Never deduct money twice because of retries."
 *
 * ── 🔴 WHY BOTH HALVES LIVE IN ONE FILE ─────────────────────────────────────
 *
 * A job is funded one of two ways and undoing it is DIFFERENT for each:
 *
 *     free    → give back the daily slot   (release_ai_usage)
 *     balance → give back the money        (refund_ai_charge)
 *
 * FOUR places undo a job — this route's own failure paths, the finalizer, the
 * reconcile sweep and the stall sweep — and none of them was present when the
 * decision was made. Every one of them calling the wrong undo is a real,
 * expensive bug in a direction that is easy to miss:
 *
 *   · releasing usage on a PAID job hands back a free daily slot the member
 *     never spent. `release_ai_usage` decrements `reserved_jobs` bounded by
 *     `greatest(0, …)`, so on a member with another job running today it takes
 *     the slot off THAT one — a free video created silently, on every paid
 *     failure.
 *   · refunding a FREE job is harmless: `refund_ai_charge` finds no charge and
 *     no-ops. That asymmetry is why the money side can be called blindly and
 *     the usage side cannot.
 *
 * So `reserveJobFunding` writes the decision onto the job row and
 * `releaseJobFunding` reads it back. Neither caller has to remember which.
 */

export type JobFunding =
  | { ok: true; source: AiFundingSource; chargedCents: number; usedToday: number }
  | { ok: false; reason: "daily_limit"; usedToday: number }
  | { ok: false; reason: "insufficient_balance"; balanceCents: number; priceCents: number };

/**
 * Take payment for one job, atomically, by whichever route applies.
 *
 * ── 🔴 THE ORDER IS FREE FIRST, AND IT IS NOT NEGOTIABLE ────────────────────
 *
 * A member holding both allowance and balance spends the allowance. Charging
 * somebody who had a free video available is invisible in aggregate and
 * unforgivable individually.
 *
 * ── 🔴 THE DAILY RESERVATION IS STILL THE ATOMIC ONE ────────────────────────
 *
 * `decideFunding` is a pure decision made from values read a moment earlier, so
 * two concurrent requests can both decide "free". What stops them both getting
 * one is `reserve_ai_usage`, which is a single SQL statement — exactly as it
 * was before this file existed. The decision only chooses WHICH atomic
 * operation to attempt; it never replaces one.
 *
 * The paid path is atomic for the same reason: `charge_ai_balance` deducts with
 * `balance_cents >= amount` in its WHERE clause, so two requests cannot both be
 * told they can afford the same last dollar.
 *
 * ⚠️ The WEEKLY ceiling is the one thing here that is not enforced atomically.
 * It is read, compared, and acted on — so a member firing several requests in
 * the same instant could cross it by one or two. That is a deliberate trade:
 * making it atomic means another SQL function and another migration for a
 * ceiling whose whole purpose is to be a soft brake over seven days, and the
 * DAILY cap — which is atomic — already bounds how fast anybody can get there.
 */
export async function reserveJobFunding(opts: {
  subject: AiSubject;
  feature: AiFeature;
  jobId: string;
  dailyLimit: number;
  weeklyLimit: number;
  usedToday: number;
  usedThisWeek: number;
  balanceCents: number;
  priceCents: number;
  ipCeiling: { key: string; limit: number } | null;
}): Promise<JobFunding> {
  const decision = decideFunding(
    {
      usedToday: opts.usedToday,
      usedThisWeek: opts.usedThisWeek,
      dailyLimit: opts.dailyLimit,
      weeklyLimit: opts.weeklyLimit,
      balanceCents: opts.balanceCents,
    },
    opts.priceCents,
  );

  if (!decision.ok) {
    return {
      ok: false,
      reason: "insufficient_balance",
      balanceCents: decision.balanceCents,
      priceCents: decision.priceCents,
    };
  }

  if (decision.source === "free") {
    const reservation = await reserveAiUsage(opts.subject, opts.feature, opts.dailyLimit, opts.ipCeiling);
    if (!reservation.allowed) {
      /*
        🔴 THE ATOMIC CHECK DISAGREED WITH THE READ, AND IT WINS. Between the
        counter being read and this statement running, another request took the
        last slot. Reporting the daily limit is correct and it is NOT a fallback
        to the paid path: a member whose allowance just ran out in the last
        millisecond should be told, not silently charged.
      */
      return { ok: false, reason: "daily_limit", usedToday: reservation.used };
    }
    return { ok: true, source: "free", chargedCents: 0, usedToday: reservation.used };
  }

  /*
    The paid path. `charge_ai_balance` THROWS when the balance will not cover
    it — see the note on `chargeAiBalance` for why that throw is the refusal and
    must not be converted into "run it anyway".
  */
  try {
    await chargeAiBalance({
      userId: subjectUserId(opts.subject),
      jobId: opts.jobId,
      amountCents: opts.priceCents,
    });
  } catch (e) {
    console.warn("[ai/funding] charge refused", { jobId: opts.jobId, error: String(e) });
    return {
      ok: false,
      reason: "insufficient_balance",
      balanceCents: opts.balanceCents,
      priceCents: opts.priceCents,
    };
  }

  return { ok: true, source: "balance", chargedCents: opts.priceCents, usedToday: opts.usedToday };
}

/**
 * Undo whatever was taken for this job.
 *
 * 🔴 Reads `funding_source` FROM THE ROW rather than being told. Every caller
 * is somewhere else in time — a webhook, a sweep, a finalizer minutes later —
 * and the row is the only thing all of them can see. A parameter would be a
 * fact each caller had to derive again, which is four chances to derive it
 * differently.
 *
 * Safe to call more than once: `release_ai_usage` is capped by
 * `released_jobs`, and `refund_ai_charge` is idempotent on the job id. A retry
 * cannot hand back two refunds.
 */
export async function releaseJobFunding(opts: {
  job: Pick<AiJobRow, "id" | "user_id" | "funding_source">;
  subject: AiSubject;
  feature: AiFeature;
  dailyLimit: number;
  /**
   * 0166: WHY the job is being undone. `failure` = the job ended without a
   * result (provider, worker, stall); `cancel` = the member stopped it;
   * `undo` = nothing ever ran (a refused hand-off, a reverted claim). The
   * operator's "Failed-job refund" switch applies to `failure` ONLY — a
   * cancelled or never-run job always gets its money back. Absent = `undo`,
   * the safe direction for any caller written before the switch existed.
   */
  cause?: "failure" | "cancel" | "undo";
}): Promise<void> {
  /*
    ── 🔴 CHARACTER REPLACE IS FUNDED FROM THE PRODUCT WALLET (Part 4, §13) ──
    Its charge is a RESERVATION on `ai_product_ledger` (0154), and
    `refund_product_charge` is idempotent per job: the first call flips the
    row to `refunded` and credits the balance, every later call finds no
    reserved row and returns the balance unchanged. So the six places that
    undo a job — /start's catch, the webhook, the reconciler, the stall
    sweep, the finalizer and cancel — can all call this without ever
    refunding twice. It never touches the daily allowance: this tool has none.
  */
  if (opts.feature === "ai_character_replace") {
    try {
      /*
        ── 0166: THE OPERATOR'S "FAILED-JOB REFUND" SWITCH ────────────────────
        On (the default, and the Part 4 rule): every failure refunds, once.
        Off: a FAILED job's reservation is left on the ledger as `reserved`
        for the operator to refund by hand (the admin "refund" action), and
        the audit row says so. Cancels and never-run jobs are not failures
        and always come back — the switch cannot keep a member's money for
        work that was never attempted.
      */
      if (opts.cause === "failure") {
        const settings = await getLandingSettings().catch(() => null);
        if (settings && settings.frenzAiCharacterReplace.processing.refundFailedJobs === false) {
          await recordJobEvent(opts.job.id, "refund.withheld", { reason: "processing.refundFailedJobs is off — refund by hand from the admin monitor", funding: opts.job.funding_source });
          console.warn("[ai/funding] refund WITHHELD by the operator's switch", { jobId: opts.job.id, funding: opts.job.funding_source });
          return;
        }
      }
      // Part 11: a complimentary creation comes back as an ENTITLEMENT, once (restore_free_use); a paid one as money, once. Never both.
      if (opts.job.funding_source === "free") {
        await restoreFreeUse(opts.job.id, "job undone");
        return;
      }
      if (opts.job.user_id) await refundCharacterReplaceCharge(opts.job.user_id, opts.job.id);
      return;
    } finally {
      // 0166: a slot just freed for this member — their next waiting video may start (never awaited, never throws into the undo).
      if (opts.job.user_id) requestQueuePump(opts.job.user_id, `release:${opts.cause ?? "undo"}`);
    }
  }
  const source = opts.job.funding_source;

  if (source === "balance") {
    // Money back. The daily slot was never taken, so releasing one here would
    // CREATE a free video — see the note at the top of this file.
    if (opts.job.user_id) await refundAiCharge(opts.job.user_id, opts.job.id);
    return;
  }

  /*
    'free', or NULL for a row that predates migration 0150.
    🔴 Null is treated as FREE, and that is the safe direction: every job before
    this column existed was funded by the daily allowance, so releasing a slot
    is exactly right for them. Treating null as paid would attempt a refund that
    finds no charge — harmless — but would SKIP the release those rows do need.
  */
  await releaseAiUsage(opts.subject, opts.feature, opts.dailyLimit);
}

/** The owner id, for the money calls. Guests cannot reach this path. */
function subjectUserId(subject: AiSubject): string {
  if (subject.kind !== "user") {
    /*
      🔴 Unreachable, and it throws rather than returning a placeholder. Frenz
      AI is signed-in only since 2026-09-09 (`resolveAiSubject` refuses a guest
      outright), so a guest here means the auth gate has been bypassed — and a
      balance operation with a fabricated owner id is the last thing that should
      happen quietly.
    */
    throw new Error("paid AI funding requires a signed-in member");
  }
  return subject.userId;
}
