import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The record of every deposit a member started, and the once-only claims that
 * decide who gets to announce its outcome. Backed by migration 0151.
 *
 * ── 🔴 EVERY WRITE HERE IS BEST-EFFORT EXCEPT THE CLAIMS ───────────────────
 *
 * A deposit must never fail because its bookkeeping did: `recordTopupAttempt`
 * runs before checkout and a refused insert must not block the checkout;
 * `markTopupAttempt` runs after Paystack answered and a refused update must
 * not turn a credited deposit into an error. Both log and return.
 *
 * The two `claim…` functions are different. They are conditional UPDATEs on a
 * `notified_at` that starts null, and their return value IS the decision: the
 * caller whose UPDATE moved a row sends the notification, every other caller
 * sends nothing. Same shape as `claimAiNotification` (ai_jobs, 0148). A claim
 * that errors returns false — "do not send" — because sending twice is the
 * failure this exists to prevent, and sending once late is not.
 */

export type TopupAttemptStatus = "pending" | "success" | "failed" | "abandoned";

export async function recordTopupAttempt(opts: {
  reference: string;
  userId: string;
  amountCents: number;
  currency: string;
}): Promise<void> {
  const { error } = await createAdminClient().from("ai_topup_attempts").insert({
    reference: opts.reference,
    user_id: opts.userId,
    amount_cents: Math.round(opts.amountCents),
    currency: opts.currency,
    status: "pending",
  });
  if (error) console.error("[ai/topup] attempt record failed", { reference: opts.reference, message: error.message });
}

export async function markTopupAttempt(
  reference: string,
  outcome: {
    status: TopupAttemptStatus;
    /** Paystack's customer-facing line ("Approved", "Insufficient Funds"…). */
    gatewayResponse?: string | null;
    channel?: string | null;
    paidAt?: string | null;
  },
): Promise<void> {
  const { error } = await createAdminClient()
    .from("ai_topup_attempts")
    .update({
      status: outcome.status,
      gateway_response: outcome.gatewayResponse ?? null,
      channel: outcome.channel ?? null,
      paid_at: outcome.paidAt ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("reference", reference);
  if (error) console.error("[ai/topup] attempt mark failed", { reference, message: error.message });
}

/**
 * Claim the single notification for a SUCCESSFUL deposit. The claim lives on
 * the ledger row because that row exists exactly once per credited reference
 * (unique index, 0149) — whether the webhook or the verify-on-return wrote it.
 */
export async function claimTopupSuccessNotification(userId: string, reference: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("ai_balance_ledger")
    .update({ notified_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("kind", "topup")
    .eq("reference", reference)
    .is("notified_at", null)
    .select("id");
  if (error) {
    console.error("[ai/topup] success claim failed", { reference, message: error.message });
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Claim the single notification for a FAILED deposit. Lives on the attempt
 * row: there is no ledger row for money that never arrived.
 */
export async function claimTopupFailureNotification(userId: string, reference: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("ai_topup_attempts")
    .update({ notified_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("reference", reference)
    .is("notified_at", null)
    .select("reference");
  if (error) {
    console.error("[ai/topup] failure claim failed", { reference, message: error.message });
    return false;
  }
  return (data?.length ?? 0) > 0;
}
