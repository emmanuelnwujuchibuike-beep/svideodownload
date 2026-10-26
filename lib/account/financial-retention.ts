import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ACCOUNT DELETION AND MONEY (Frenz Coin Part 2, H3 — migration 0278)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Deleting an account used to CASCADE through the financial tables: the member's ledger, their withdrawals and both
 * sides of every transfer they took part in disappeared with them — the counterparty's history included. Since 0278
 * those tables keep their rows (keyed by the deleted account's id, a pseudonymous identifier), and:
 *
 *   · a deletion is refused while the account still holds money or has money moving: withdrawable credits, SUB money
 *     or SUB debt, an open withdrawal, a payment still being confirmed, a refund/chargeback shortfall or a held dispute
 *     (`account_financial_blockers`). Tokens (non-withdrawable credits) do not block: they are closed with a ledger row.
 *   · right before the purge, `retain_financial_records` re-checks under the wallet lock, redacts bank details on past
 *     withdrawals (bank name and last four digits stay, for reconciliation), closes a token-only balance and audits it.
 *     If it refuses, the purge waits for the next run.
 */

export type BlockerReason = "withdrawable_balance" | "sub_balance" | "sub_debt" | "open_withdrawal" | "payment_in_flight" | "recovery_due" | "coin_balance" | "coin_recovery_due";

export const BLOCKER_COPY: Record<BlockerReason, string> = {
  withdrawable_balance: "You still have withdrawable credits. Withdraw them first.",
  sub_balance: "You still have private-post earnings. Withdraw them first.",
  sub_debt: "A refunded subscription payment is still being settled on your earnings.",
  open_withdrawal: "A withdrawal is still in progress. Wait for it to finish.",
  payment_in_flight: "A payment is still being confirmed. Try again once it has finished.",
  recovery_due: "A refunded or disputed payment is still being settled. Contact support.",
  // 0279
  coin_balance: "You still have Frenz Coins. Withdraw or send them first.",
  // 0280
  coin_recovery_due: "A refunded or disputed Frenz Coin deposit is still being settled. Contact support.",
};

const MISSING = (m: string) => /account_financial_blockers|retain_financial_records|schema cache|does not exist/i.test(m);

/** `null` = it could not be checked (the caller decides; the purge never proceeds on null). */
export async function accountFinancialBlockers(userId: string): Promise<{ ok: boolean; reasons: BlockerReason[]; tokens: number; pendingMigration?: true } | null> {
  const { data, error } = await createAdminClient().rpc("account_financial_blockers", { p_user: userId });
  if (error) {
    if (MISSING(error.message)) return { ok: false, reasons: [], tokens: 0, pendingMigration: true };
    console.error("[account/delete] financial check failed", { userId, code: error.code });
    return null;
  }
  const r = (data ?? {}) as { ok?: boolean; reasons?: string[]; tokens?: number };
  return { ok: !!r.ok, reasons: (r.reasons ?? []).filter((x): x is BlockerReason => x in BLOCKER_COPY), tokens: Number(r.tokens ?? 0) };
}

/** Right before `auth.admin.deleteUser`: true only when the records were retained and nothing blocks the purge. */
export async function retainFinancialRecords(userId: string): Promise<{ ok: true; tokensClosed: number } | { ok: false; reason: string }> {
  const { data, error } = await createAdminClient().rpc("retain_financial_records", { p_user: userId });
  if (error) return { ok: false, reason: MISSING(error.message) ? "pending_migration" : "error" };
  const r = (data ?? {}) as { ok?: boolean; reason?: string; reasons?: string[]; tokens_closed?: number };
  if (!r.ok) return { ok: false, reason: r.reason === "blocked" ? `blocked:${(r.reasons ?? []).join(",")}` : (r.reason ?? "error") };
  return { ok: true, tokensClosed: Number(r.tokens_closed ?? 0) };
}
