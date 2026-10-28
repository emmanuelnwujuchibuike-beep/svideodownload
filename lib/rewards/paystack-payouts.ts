import "server-only";

import { verifyFlutterwaveTransfer } from "@/lib/flutterwave/client";
import { PaystackHttpError, paystackRefusedForSure, paystackRequest } from "@/lib/paystack/paystack";
import { createAdminClient } from "@/lib/supabase/admin";

import { isFlutterwavePayoutRef, isPayoutRef, PAYSTACK_REF } from "./payout-refs";
import { payoutQuote } from "./payout-quote";
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
const REF = PAYSTACK_REF;
const railName = (reference: string) => (isFlutterwavePayoutRef(reference) ? "Flutterwave" : "Paystack");

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

  // closeout: credits / SUB at the live market rate as before; a Frenz Coin payout at its approved, recorded rate
  const quote = await payoutQuote(w);
  if (!quote.ok) return { ok: false, error: quote.error };
  const kobo = quote.kobo;
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
  let uncertain = false;
  try {
    const t = await paystackRequest<{ data: { status: string; transfer_code: string } }>("/transfer", {
      method: "POST",
      body: { source: "balance", amount: kobo, recipient, reference, reason: "Frenz withdrawal", currency: "NGN" },
    });
    status = t.data?.status ?? "pending";
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (/reference/i.test(msg)) {
      // a reused reference means it was already sent: that is the idempotency working, not a failure
    } else if (paystackRefusedForSure(e)) {
      // Paystack answered 4xx: no transfer exists. Nothing is recorded; the withdrawal stays approved.
      return { ok: false, error: `Paystack didn't send it: ${msg}` };
    } else {
      /*
        🔴 Part 12 follow-up: a timeout, a dropped connection, a 5xx or a body that isn't JSON is NOT
        proof the transfer failed — Paystack may have accepted it. The withdrawal moves to processing
        WITH its reference, so the money stays held, no second transfer can start (payWithdrawalViaPaystack
        only sends from pending / reviewing / approved), an admin can't release it without Paystack's
        word (rejectPaystackWithdrawal), and the reconcile sweep asks /transfer/verify by reference.
      */
      uncertain = true;
    }
  }
  const note = uncertain
    ? `Outcome unknown: the transfer request to Paystack didn't get a clear answer. Held until Paystack confirms by reference ${reference}.`
    : `Paystack transfer of NGN ${(kobo / 100).toFixed(2)} at ${quote.label}${status === "otp" ? " - waiting for the OTP in the Paystack dashboard" : ""}`;
  const out = await resolveWithdrawal({ id: withdrawalId, status: status === "success" && !uncertain ? "completed" : "processing", adminId, note, payoutReference: reference });
  if (uncertain) return out.ok ? { ok: true, status: "unknown" } : { ok: false, error: "The transfer's outcome is unknown and the withdrawal didn't update. Don't pay it again: check the reference in Paystack." };
  return out.ok ? { ok: true, status } : { ok: false, error: "Sent, but the withdrawal didn't update. The webhook will finish it." };
}

type TransferVerdict = { kind: "success" } | { kind: "failed"; status: string } | { kind: "not_found" } | { kind: "unknown"; status?: string };

/**
 * What the PROVIDER THAT SENT IT says about a transfer reference, right now (2026-10-24: a frenz_fwd_ reference is a
 * Flutterwave transfer). Only success / failed / reversed / not found are verdicts.
 */
export async function verifyTransferReference(reference: string): Promise<TransferVerdict> {
  if (isFlutterwavePayoutRef(reference)) return verifyFlutterwaveTransfer(reference);
  try {
    const r = await paystackRequest<{ data: { status: string } }>(`/transfer/verify/${encodeURIComponent(reference)}`);
    const st = r.data?.status;
    if (st === "success") return { kind: "success" };
    if (st === "failed" || st === "reversed") return { kind: "failed", status: st };
    return { kind: "unknown", status: st };
  } catch (e) {
    if (e instanceof PaystackHttpError && e.httpStatus === 404) return { kind: "not_found" };
    return { kind: "unknown" };
  }
}

/**
 * How long a withdrawal must sit untouched after its transfer attempt before "Paystack has no transfer
 * with this reference" may release it. A transfer Paystack is still accepting (a slow or timed-out
 * request) may not be listed yet, so a fresh 404 is not proof it was never sent.
 */
export const NOT_SENT_MIN_AGE_MS = 60 * 60_000;

/**
 * An admin rejecting (or cancelling) a withdrawal. 🔴 Part 12 follow-up: once a transfer may exist, the
 * withdrawal can only be released on PAYSTACK's word — never on an admin's guess that it failed, or the
 * creator gets the money back AND the bank transfer. Paystack says:
 *   success            -> it is completed instead (the money left)
 *   failed / reversed  -> rejected, the money returns
 *   no such transfer   -> only once the attempt is NOT_SENT_MIN_AGE_MS old; for a RECORDED reference
 *                         also only with the admin's explicit confirmation and a reason, audited first
 *                         (an audit that can't be written releases nothing)
 *   anything else      -> refused: still processing, OTP pending, Paystack unreachable or ambiguous
 * "A transfer may exist" = a frenz_wd_ reference is recorded, OR a Paystack withdrawal reached approved /
 * processing (sending and recording the reference are two steps; the reference is fixed per withdrawal,
 * so Paystack is asked by it). Anything else was never sent and is rejected as before.
 */
export async function rejectPaystackWithdrawal(input: { id: string; status: "rejected" | "cancelled"; adminId: string; note: string | null; confirmNotSent?: boolean }): Promise<{ ok: true; outcome: "rejected" | "completed_instead" } | { ok: false; error: string; reason: string }> {
  const db = createAdminClient();
  const { data, error } = await db.from("withdrawal_requests").select("id, status, payout_method, payout_reference, updated_at").eq("id", input.id).maybeSingle();
  if (error) return { ok: false, error: "Couldn't read the withdrawal. Nothing was changed.", reason: "error" };
  const w = data as { id: string; status: string; payout_method: string | null; payout_reference: string | null; updated_at: string | null } | null;
  if (!w) return { ok: false, error: "Not found.", reason: "not_found" };
  const recorded = isPayoutRef(w.payout_reference) ? w.payout_reference : null;
  const maybeSent = !recorded && w.payout_method === PAYSTACK_METHOD && (w.status === "approved" || w.status === "processing");
  if (!recorded && !maybeSent) {
    const out = await resolveWithdrawal({ id: input.id, status: input.status, adminId: input.adminId, note: input.note });
    return out.ok ? { ok: true, outcome: "rejected" } : { ok: false, error: "Couldn't update it.", reason: out.reason ?? "error" };
  }
  const reference = recorded ?? REF(w.id);
  // a Flutterwave payout records its frenz_fwd_ reference BEFORE sending (flutterwave-payouts.ts), so an unrecorded one
  // can only ever have been a Paystack attempt — asked by Paystack's fixed reference, as before
  const v = await verifyTransferReference(reference);
  if (v.kind === "success") {
    const out = await resolveWithdrawal({ id: input.id, status: "completed", adminId: input.adminId, note: `${railName(reference)} confirms this transfer was paid, so it can't be rejected`, payoutReference: reference });
    return out.ok ? { ok: true, outcome: "completed_instead" } : { ok: false, error: "Paystack says it was paid, but the withdrawal didn't update.", reason: out.reason ?? "error" };
  }
  if (v.kind === "failed") {
    const out = await resolveWithdrawal({ id: input.id, status: "rejected", adminId: input.adminId, note: `${input.note ?? "Rejected"} (${railName(reference)}: ${v.status})`, payoutReference: recorded ?? undefined });
    return out.ok ? { ok: true, outcome: "rejected" } : { ok: false, error: "Couldn't update it.", reason: out.reason ?? "error" };
  }
  if (v.kind === "not_found") {
    const age = Date.now() - Date.parse(w.updated_at ?? "");
    if (!(age >= NOT_SENT_MIN_AGE_MS)) {
      // the guard stays (returning the coins while Paystack may still pay would pay twice) — but it says WHEN (owner, 2026-10-28)
      const mins = Number.isFinite(age) ? Math.max(1, Math.ceil((NOT_SENT_MIN_AGE_MS - age) / 60_000)) : null;
      return { ok: false, error: `${railName(reference)} doesn't list this transfer, but it was attempted less than an hour ago and could still go through — rejecting now could pay the member AND return the coins. Reject opens ${mins ? `in about ${mins} minute${mins === 1 ? "" : "s"}` : "an hour after the attempt"}; the coins stay held until then.`, reason: "too_soon" };
    }
    if (recorded) {
      if (!input.confirmNotSent) return { ok: false, error: "Paystack has no transfer with this reference. Confirm it was never sent to release the money.", reason: "confirm_not_sent" };
      const why = (input.note ?? "").trim();
      if (why.length < 3) return { ok: false, error: "Give the reason before confirming it was never sent.", reason: "reason_required" };
      const { error: auditError } = await db.from("financial_audit_log").insert({ actor_id: input.adminId, action: "withdrawal_transfer_not_found_confirmed", target_type: "withdrawal", target_id: input.id, reference, details: { note: why, from: w.status, checked_at: new Date().toISOString() } });
      if (auditError) return { ok: false, error: "The audit record couldn't be written, so nothing was released.", reason: "audit_failed" };
    }
    const out = await resolveWithdrawal({ id: input.id, status: "rejected", adminId: input.adminId, note: recorded ? `${(input.note ?? "").trim()} (${railName(reference)} has no transfer with this reference; confirmed by an admin)` : `${input.note ?? "Rejected"} (${railName(reference)} has no transfer with reference ${reference})`, payoutReference: recorded ?? undefined });
    return out.ok ? { ok: true, outcome: "rejected" } : { ok: false, error: out.reason === "final" ? "This withdrawal is already finished." : "Couldn't update it.", reason: out.reason ?? "error" };
  }
  return { ok: false, error: `${railName(reference)} hasn't settled this transfer yet${v.status ? ` (${v.status})` : ""}. It stays held until ${railName(reference)} confirms.`, reason: "outcome_unknown" };
}

/** Paystack's webhook: a transfer landed, failed or came back. */
export async function settlePaystackTransfer(event: "transfer.success" | "transfer.failed" | "transfer.reversed", reference: string | undefined): Promise<boolean> {
  // 2026-10-24: Flutterwave transfers (frenz_fwd_) settle through the same rules; every check asks the rail that sent it
  if (!isPayoutRef(reference)) return false;
  const db = createAdminClient();
  const { data } = await db.from("withdrawal_requests").select("id, status").eq("payout_reference", reference).maybeSingle();
  const w = data as { id: string; status: string } | null;
  /*
    🔴 Part 12 follow-up: a transfer that SUCCEEDED and then came back (the bank returned it). It used
    to be ignored, so the money returned to the platform and the creator was never credited. Now the
    event is re-checked with /transfer/verify (it must say "reversed") and applied once by
    reverse_paid_withdrawal (0254). Anything less certain throws, so the webhook answers 500 and
    Paystack redelivers; a reversal before 0254 runs is also a retry, never a silent drop.
  */
  if (w && w.status === "completed" && event === "transfer.reversed") {
    const v = await verifyTransferReference(reference);
    if (!(v.kind === "failed" && v.status === "reversed")) throw new Error("reversal not confirmed by Paystack yet");
    const { data: r, error } = await db.rpc("reverse_paid_withdrawal", { p_id: w.id, p_actor: null, p_note: `${railName(reference)}: the transfer was reversed (verified)` });
    if (error) throw new Error("reverse_paid_withdrawal failed");
    const out = r as { ok?: boolean; reason?: string } | null;
    // 'manual' = an AI-credit payout: audited for an admin, nothing more to do here
    return !!out?.ok || out?.reason === "manual";
  }
  /*
    A transfer that LANDED after the withdrawal was released (rejected / cancelled): the creator has the
    money back AND the bank transfer. Nothing here can claw it back automatically, so it is confirmed
    with Paystack (a stale "success" after a reversal is not this), recorded once for an admin
    (the SUB "Needs review" list) and logged loudly. Unconfirmed -> throw, so the webhook is retried.
  */
  if (w && (w.status === "rejected" || w.status === "cancelled") && event === "transfer.success") {
    const v = await verifyTransferReference(reference);
    if (v.kind === "failed") return true;
    if (v.kind !== "success") throw new Error("late transfer.success not confirmed by Paystack yet");
    const { data: seen, error: seenError } = await db.from("financial_audit_log").select("id").eq("action", "withdrawal_paid_after_release").eq("target_id", w.id).limit(1);
    if (seenError) throw new Error("couldn't check the paid-after-release record");
    if (!seen?.length) {
      const { error: auditError } = await db.from("financial_audit_log").insert({ actor_id: null, action: "withdrawal_paid_after_release", target_type: "withdrawal", target_id: w.id, reference, details: { status: w.status } });
      if (auditError) throw new Error("couldn't record the paid-after-release transfer");
      console.error("[rewards/payout] 🔴 a transfer landed AFTER its withdrawal was released — the creator was paid twice; recover it manually", { withdrawal: w.id, reference, status: w.status });
    }
    return true;
  }
  if (!w || ["completed", "rejected", "cancelled", "reversed"].includes(w.status)) return true;
  const to = event === "transfer.success" ? "completed" : "rejected";
  const out = await resolveWithdrawal({ id: w.id, status: to, adminId: null, note: event === "transfer.success" ? `${railName(reference)} confirmed the transfer` : `${railName(reference)}: ${event.replace("transfer.", "")}. The credits were returned.` });
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
      const v = await verifyTransferReference(w.payout_reference);
      if (v.kind === "success" || v.kind === "failed") {
        const ev = v.kind === "success" ? "transfer.success" : v.status === "reversed" ? "transfer.reversed" : "transfer.failed";
        if (await settlePaystackTransfer(ev, w.payout_reference)) settled++;
      }
    } catch {
      /* the next run tries again */
    }
  }
  return { checked: data.length, settled };
}
