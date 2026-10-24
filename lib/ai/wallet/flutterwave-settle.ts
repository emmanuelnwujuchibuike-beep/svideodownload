import "server-only";

import { announceCharacterReplaceRecharge, creditVerifiedCharacterReplaceRecharge } from "@/lib/ai/character-replace/recharge-server";
import { WALLET_UNIT } from "@/lib/ai/credits/units";
import { settleUnpaidTopup } from "@/lib/ai/wallet/paystack-settle";
import { verifyFlutterwaveByReference } from "@/lib/flutterwave/client";
import { chargeMatches, type VerifiedCharge } from "@/lib/payments/charge";
import { flutterwaveReferencePurpose } from "@/lib/payments/references";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A FLUTTERWAVE WALLET TOP-UP, SETTLED FROM OUR OWN ATTEMPT ROW (Part 2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The Paystack path reads the member and the FX pin from Paystack's metadata.
 * This one does not: everything that decides the credit — the member, the
 * USD price, the credits, the pack — is the `ai_topup_attempts` row written
 * BEFORE the checkout opened. Flutterwave is asked only "did transaction
 * <our reference> succeed, for how much, in what currency?", and the answer
 * must match the row exactly (`chargeMatches`).
 *
 * Callers: the verify-on-return route (the browser sends a reference, nothing
 * else counts), and the webhook (which re-verifies by Flutterwave's
 * transaction id first). Crediting is once-only on the reference in SQL
 * (`credit_product_balance`), so both racing credits once.
 */

const CANCEL_AFTER_MS = 30 * 60_000;

export interface TopupAttemptRow {
  reference: string;
  user_id: string;
  provider: string;
  status: string;
  amount_cents: number;
  currency: string;
  provider_amount: number | null;
  provider_currency: string | null;
  item_id: string | null;
  checkout_url: string | null;
  created_at: string;
}

const ROW_COLUMNS = "reference, user_id, provider, status, amount_cents, currency, provider_amount, provider_currency, item_id, checkout_url, created_at";

export type FlutterwaveTopupSettle =
  | { kind: "credited"; balanceAfterCents: number; creditsAdded: number; announce: () => Promise<void> }
  | { kind: "pending" }
  | { kind: "failed" }
  | { kind: "not_ours" }
  | { kind: "mismatch" }
  | { kind: "unknown" };

async function loadRow(reference: string): Promise<TopupAttemptRow | null> {
  const { data, error } = await createAdminClient().from("ai_topup_attempts").select(ROW_COLUMNS).eq("reference", reference).eq("purpose", "wallet_topup").maybeSingle();
  if (error) throw new Error(`ai_topup_attempts read: ${error.message}`);
  return (data as TopupAttemptRow | null) ?? null;
}

async function setStatus(reference: string, from: string[], patch: Record<string, unknown>): Promise<void> {
  const { error } = await createAdminClient().from("ai_topup_attempts").update({ ...patch, updated_at: new Date().toISOString() }).eq("reference", reference).in("status", from);
  if (error) console.error("[ai/topup/fw] attempt update failed", { reference, message: error.message });
}

/**
 * Settle one Flutterwave top-up. `charge`, when given, is one the caller ALREADY fetched from
 * Flutterwave (the webhook verifies by id); otherwise it is fetched here by our reference.
 * `userId`, when given, must own the attempt (the return page's session).
 */
export async function settleFlutterwaveTopup(reference: string, opts: { userId?: string; charge?: VerifiedCharge } = {}): Promise<FlutterwaveTopupSettle> {
  if (flutterwaveReferencePurpose(reference) !== "wallet_topup") return { kind: "unknown" };
  const row = await loadRow(reference);
  if (!row || row.provider !== "flutterwave") return { kind: "unknown" };
  if (opts.userId && row.user_id !== opts.userId) {
    console.warn("[ai/topup/fw] reference does not belong to caller", { reference });
    return { kind: "not_ours" };
  }

  const charge = opts.charge ?? (await verifyFlutterwaveByReference(reference));
  const age = Date.now() - Date.parse(row.created_at);

  if (charge.status === "success") {
    const expected = { provider: "flutterwave" as const, reference, amountMinor: Number(row.provider_amount ?? row.amount_cents), currency: row.provider_currency ?? row.currency };
    const match = chargeMatches(charge, expected);
    if (!match.ok) {
      // money may have moved but not what we asked for: nothing is credited, a person reviews it
      console.error("[ai/topup/fw] verified charge does not match the attempt", { reference, mismatch: match.mismatch, amount: charge.amountMinor, currency: charge.currency, expected: expected.amountMinor, expectedCurrency: expected.currency });
      await setStatus(reference, ["pending", "verification_required"], { status: "mismatch", status_reason: `flutterwave ${match.mismatch}`, paid_amount: charge.amountMinor, paid_currency: charge.currency, charge_id: charge.externalId });
      return { kind: "mismatch" };
    }
    // 🔴 the credit is the price WE stored (USD cents) — never an amount from the provider or a browser
    const credited = await creditVerifiedCharacterReplaceRecharge({
      userId: row.user_id,
      reference,
      amountCents: Number(row.amount_cents),
      currency: row.currency,
      packId: row.item_id,
      channel: charge.channel,
      paidAt: charge.paidAt,
      gatewayResponse: charge.reason,
    });
    await setStatus(reference, ["pending", "verification_required"], { external_id: charge.externalId, charge_id: charge.externalId, paid_amount: charge.amountMinor, paid_currency: charge.currency, verified_at: new Date().toISOString() });
    return {
      kind: "credited",
      balanceAfterCents: credited.balanceAfterCents,
      creditsAdded: credited.credits + credited.bonusCredits,
      announce: () =>
        announceCharacterReplaceRecharge({ userId: row.user_id, reference, amountCents: credited.credits + credited.bonusCredits, currency: WALLET_UNIT, balanceAfterCents: credited.balanceAfterCents, channel: charge.channel, paidAt: charge.paidAt, gatewayResponse: charge.reason }),
    };
  }

  if (row.status === "success") return { kind: "pending" };

  // a checkout whose creation outcome was unknown, and Flutterwave holds nothing for it: nobody could have paid it
  if (charge.status === "not_found" && !row.checkout_url) {
    await setStatus(reference, ["verification_required"], { status: "failed", status_reason: "flutterwave checkout never created" });
    return { kind: "failed" };
  }
  if (charge.status === "failed" || ((charge.status === "abandoned" || charge.status === "not_found") && age >= CANCEL_AFTER_MS)) {
    const outcome = charge.status === "failed" ? "failed" : "abandoned";
    await settleUnpaidTopup({ userId: row.user_id, reference, outcome, amountCents: Number(row.amount_cents), currency: row.currency, gatewayResponse: charge.reason, channel: charge.channel });
    return { kind: "failed" };
  }
  return { kind: "pending" };
}
