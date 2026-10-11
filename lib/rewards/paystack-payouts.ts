import "server-only";

import { marketRate } from "@/lib/ai/character-replace/fx-rate-server";
import { paystackRequest } from "@/lib/paystack/paystack";
import { createAdminClient } from "@/lib/supabase/admin";

import { koboFor } from "./paystack-banks";
import { resolveWithdrawal } from "./withdrawals";

/**
 * Paystack payouts — the money-out rail for withdrawals (owner, 2026-10-11:
 * "users who want to withdraw their paid subscription … can withdraw through
 * Paystack").
 *
 * A withdrawal still starts and is reviewed exactly as before (0187, manual by
 * an admin in v1). What changes is the payout: instead of an admin sending a
 * bank transfer by hand and typing a reference, the server sends it through
 * Paystack Transfers to the bank account the member chose, and Paystack's own
 * webhook says whether it landed:
 *
 *   member     picks a bank, types an account number; Paystack names the
 *              account holder before anything is saved (no typo payouts)
 *   admin      approves → "Pay with Paystack" (or auto, if the admin enabled it
 *              for withdrawals that need no review)
 *   server     creates the transfer recipient, sends the transfer with the
 *              reference frenz_wd_<id> (Paystack refuses a reused reference,
 *              so a retry can never pay twice), moves the withdrawal to
 *              "processing"
 *   webhook    transfer.success → completed · transfer.failed / reversed →
 *              rejected, and resolve_withdrawal returns the credits
 *   cron       a transfer whose webhook never came is verified by reference
 *
 * Amount: the withdrawal's USD value (fixed at request) at the live NGN market
 * rate — the same rate source the top-ups use, without their checkout markup —
 * recorded on the withdrawal so the payout can always be explained.
 *
 * Paystack account requirements: Transfers enabled on a verified business, and
 * "OTP for transfers" turned OFF in the Paystack dashboard, or each transfer
 * waits for an OTP there (this file reports that state instead of hiding it).
 */

export const PAYSTACK_METHOD = "paystack";
const REF = (withdrawalId: string) => `frenz_wd_${withdrawalId.replace(/-/g, "")}`;

type Row = Record<string, unknown>;

/**
 * Send one approved withdrawal through Paystack. Safe to call twice: the
 * reference is fixed per withdrawal, and Paystack refuses a second transfer with it.
 */
export async function payWithdrawalViaPaystack(withdrawalId: string, adminId: string | null): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const db = createAdminClient();
  const { data } = await db.from("withdrawal_requests").select("*").eq("id", withdrawalId).maybeSingle();
  const w = data as Row | null;
  if (!w) return { ok: false, error: "Not found." };
  if (w.payout_method !== PAYSTACK_METHOD) return { ok: false, error: "This withdrawal isn't set up for Paystack." };
  if (!["pending", "reviewing", "approved"].includes(w.status as string)) return { ok: false, error: `It is already ${w.status as string}.` };
  const details = (w.payout_details ?? {}) as Row;
  const bankCode = String(details.bankCode ?? "");
  const accountNumber = String(details.accountNumber ?? "");
  const accountName = String(details.accountName ?? "");
  if (!bankCode || !accountNumber || !accountName) return { ok: false, error: "The bank details are incomplete." };

  const rate = await marketRate("NGN");
  if (!rate) return { ok: false, error: "No naira rate is available right now. Try again shortly." };
  const kobo = koboFor(Number(w.amount_usd_cents ?? 0), rate.rate.perUsd);
  if (kobo < 10_000) return { ok: false, error: "The payout is below Paystack's minimum transfer." };

  // approved first, so a failure from here on is a withdrawal waiting to be paid, never lost credits
  if (w.status !== "approved") {
    const moved = await resolveWithdrawal({ id: withdrawalId, status: "approved", adminId, note: "Approved for Paystack payout" });
    if (!moved.ok) return { ok: false, error: "Couldn't approve it." };
  }
  let recipient: string;
  try {
    const r = await paystackRequest<{ data: { recipient_code: string } }>("/transferrecipient", { method: "POST", body: { type: "nuban", name: accountName, account_number: accountNumber, bank_code: bankCode, currency: "NGN", metadata: { user_id: w.user_id } } });
    recipient = r.data.recipient_code;
  } catch (e) {
    return { ok: false, error: `Paystack refused the account: ${e instanceof Error ? e.message : "unknown"}` };
  }
  const reference = REF(withdrawalId);
  let status = "pending";
  try {
    const t = await paystackRequest<{ data: { status: string; transfer_code: string } }>("/transfer", {
      method: "POST",
      body: { source: "balance", amount: kobo, recipient, reference, reason: "Frenz withdrawal", currency: "NGN" },
    });
    status = t.data?.status ?? "pending";
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    // a reused reference means it was already sent: that is the idempotency working, not a failure
    if (!/reference/i.test(msg)) return { ok: false, error: `Paystack didn't send it: ${msg}` };
  }
  const note = `Paystack transfer of NGN ${(kobo / 100).toFixed(2)} at ${rate.rate.perUsd} per USD (${rate.source})${status === "otp" ? " - waiting for the OTP in the Paystack dashboard" : ""}`;
  const out = await resolveWithdrawal({ id: withdrawalId, status: status === "success" ? "completed" : "processing", adminId, note, payoutReference: reference });
  return out.ok ? { ok: true, status } : { ok: false, error: "Sent, but the withdrawal didn't update. The webhook will finish it." };
}

/** Paystack's webhook: a transfer landed, failed or came back. */
export async function settlePaystackTransfer(event: "transfer.success" | "transfer.failed" | "transfer.reversed", reference: string | undefined): Promise<boolean> {
  if (!reference?.startsWith("frenz_wd_")) return false;
  const db = createAdminClient();
  const { data } = await db.from("withdrawal_requests").select("id, status").eq("payout_reference", reference).maybeSingle();
  const w = data as { id: string; status: string } | null;
  if (!w || ["completed", "rejected", "cancelled"].includes(w.status)) return true;
  const to = event === "transfer.success" ? "completed" : "rejected";
  const out = await resolveWithdrawal({ id: w.id, status: to, adminId: null, note: event === "transfer.success" ? "Paystack confirmed the transfer" : `Paystack: ${event.replace("transfer.", "")}. The credits were returned.` });
  return out.ok;
}

/** The reconcile cron: transfers still processing after their webhook should have come. */
export async function verifyProcessingPayouts(limit = 20): Promise<{ checked: number; settled: number }> {
  const db = createAdminClient();
  const { data, error } = await db.from("withdrawal_requests").select("id, payout_reference, updated_at").eq("status", "processing").eq("payout_method", PAYSTACK_METHOD).lte("updated_at", new Date(Date.now() - 15 * 60_000).toISOString()).limit(limit);
  if (error || !data?.length) return { checked: 0, settled: 0 };
  let settled = 0;
  for (const w of data as { payout_reference: string | null }[]) {
    if (!w.payout_reference) continue;
    try {
      const r = await paystackRequest<{ data: { status: string } }>(`/transfer/verify/${encodeURIComponent(w.payout_reference)}`);
      const s = r.data?.status;
      if (s === "success" || s === "failed" || s === "reversed") {
        if (await settlePaystackTransfer(s === "success" ? "transfer.success" : s === "failed" ? "transfer.failed" : "transfer.reversed", w.payout_reference)) settled++;
      }
    } catch {
      /* the next run tries again */
    }
  }
  return { checked: data.length, settled };
}
