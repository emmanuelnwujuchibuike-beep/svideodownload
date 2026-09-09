import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — THE BALANCE, FROM THE SERVER SIDE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09, standing rule §9: "The balance must be securely maintained
 * server-side. Never trust a client-provided balance. Never perform balance
 * deductions solely in frontend code."
 *
 * ── 🔴 EVERY WRITE GOES THROUGH A SQL FUNCTION ──────────────────────────────
 *
 * Nothing in this file issues an UPDATE against `ai_balances`. It cannot: the
 * table has no write policy, the functions are `security definer`, and they are
 * REVOKEd from `anon` and `authenticated` so only the service role can call
 * them at all (migration 0149).
 *
 * That is not defensive layering for its own sake. Each of those functions does
 * its balance change and its ledger append in ONE statement pair that either
 * both happen or neither does — and an UPDATE issued from here, however
 * carefully, would be a balance change with no ledger row and no atomicity.
 * The rule is: if it moves money, it is a function.
 */

export interface AiBalanceView {
  balanceCents: number;
}

/**
 * What this member has.
 *
 * 🔴 A missing row is ZERO, not an error. `ai_balances` is written on first
 * credit, so every member who has never topped up has no row — which is the
 * overwhelmingly common case and must not read as a failure.
 */
export async function getAiBalanceCents(userId: string): Promise<number> {
  try {
    const { data, error } = await createAdminClient()
      .from("ai_balances")
      .select("balance_cents")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      /*
        🔴 A read failure is NOT zero. Returning 0 here would tell a member with
        $50 that they cannot afford a video — and, worse, would route them to
        the recharge screen to pay again. Throwing is the honest outcome: the
        caller shows "we could not check" and nothing is charged.
      */
      throw new Error(error.message);
    }
    return Number(data?.balance_cents ?? 0);
  } catch (e) {
    console.error("[ai/balance] read failed", { error: String(e) });
    throw e;
  }
}

export type AiLedgerKind = "topup" | "admin_credit" | "job_charge" | "job_refund";

export interface AiLedgerEntry {
  id: string;
  deltaCents: number;
  balanceAfterCents: number;
  kind: AiLedgerKind;
  jobId: string | null;
  note: string | null;
  createdAt: string;
}

/**
 * The member's own transaction history.
 *
 * 🔴 An allow-list of columns, like every other view in this feature.
 * `reference` is deliberately ABSENT: it is a Paystack transaction reference,
 * which is an identifier into the payment provider's system rather than
 * anything a member needs, and `actor_admin_id` is absent because who granted a
 * credit is nobody's business but ours.
 */
export async function listAiLedger(userId: string, limit = 25): Promise<AiLedgerEntry[]> {
  const { data, error } = await createAdminClient()
    .from("ai_balance_ledger")
    .select("id, delta_cents, balance_after_cents, kind, job_id, note, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)));

  if (error) {
    console.error("[ai/balance] ledger read failed", { message: error.message });
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    deltaCents: Number(row.delta_cents),
    balanceAfterCents: Number(row.balance_after_cents),
    kind: row.kind as AiLedgerKind,
    jobId: (row.job_id as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

/**
 * Add to a balance. Idempotent on `reference`.
 *
 * Used by the Paystack webhook (`topup`) and by the admin credit route
 * (`admin_credit`). Returns the new balance.
 *
 * 🔴 `reference` is the idempotency key and it is REQUIRED. A unique index on
 * (user, kind, reference) is what makes a webhook delivered three times credit
 * once — see migration 0149. A caller that passes a fresh random value on every
 * retry has disabled that guarantee, so both callers derive it from something
 * stable: the Paystack transaction reference, or an admin request id.
 */
export async function creditAiBalance(opts: {
  userId: string;
  amountCents: number;
  kind: Extract<AiLedgerKind, "topup" | "admin_credit">;
  reference: string;
  note?: string | null;
  adminId?: string | null;
}): Promise<number> {
  const { data, error } = await createAdminClient().rpc("credit_ai_balance", {
    p_user_id: opts.userId,
    p_amount: Math.round(opts.amountCents),
    p_kind: opts.kind,
    p_reference: opts.reference,
    p_note: opts.note ?? null,
    p_admin_id: opts.adminId ?? null,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/**
 * Take the price of one job. Throws when the balance will not cover it.
 *
 * 🔴 THE THROW IS THE REFUSAL, and it must not be caught and converted into
 * "let it run anyway". `charge_ai_balance` deducts with `balance_cents >=
 * p_amount` in the WHERE clause, so a member who cannot afford it matches zero
 * rows and the function raises — which is the only way two concurrent requests
 * cannot both be told they can afford the same last dollar.
 */
export async function chargeAiBalance(opts: {
  userId: string;
  jobId: string;
  amountCents: number;
}): Promise<number> {
  const { data, error } = await createAdminClient().rpc("charge_ai_balance", {
    p_user_id: opts.userId,
    p_job_id: opts.jobId,
    p_amount: Math.round(opts.amountCents),
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/**
 * Give back what a job was charged, at most once.
 *
 * Never throws: a refund that fails must not turn a failed job into a failed
 * REQUEST on top of it. A free job has nothing to refund, and that is an
 * ordinary answer rather than an error.
 */
export async function refundAiCharge(userId: string, jobId: string): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc("refund_ai_charge", {
      p_user_id: userId,
      p_job_id: jobId,
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    /*
      🔴 Worth an error line rather than a warning. A refund that silently did
      not happen is money the member paid for a video they never received, and
      it is invisible to them — the ledger simply lacks a row nobody is looking
      for. This is the log an operator searches when somebody writes in.
    */
    console.error("[ai/balance] refund failed", { userId, jobId, error: String(e) });
  }
}
