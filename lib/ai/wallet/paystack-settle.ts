import "server-only";

import { resolveCredit } from "@/lib/ai/character-replace/topup-fx";
import { announceCharacterReplaceRecharge, creditVerifiedCharacterReplaceRecharge } from "@/lib/ai/character-replace/recharge-server";
import { WALLET_UNIT } from "@/lib/ai/credits/units";
import { markTopupAttempt } from "@/lib/ai/topup-attempts";
import { notifyTopupCancelled, notifyTopupFailed } from "@/lib/ai/topup-notify";
import { getLandingSettings } from "@/lib/landing/settings";
import { CHARACTER_REPLACE_TOPUP_PURPOSE, type PaystackVerifiedCharge } from "@/lib/paystack/paystack";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ONE WAY TO SETTLE A VERIFIED PAYSTACK WALLET TOP-UP
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Shared by the verify-on-return route and the reconciler
 * (lib/ai/wallet/reconcile-topups.ts). The charge has already been read FROM
 * PAYSTACK with the secret key — nothing here comes from a browser. The same
 * checks either way: our purpose marker, the member's own id echoed back by
 * Paystack, the settled amount against the pinned rate. Crediting is once-only
 * on the reference (the webhook uses the same one), and the announcement is
 * claimed once on the ledger row.
 */
export type SettleResult =
  | { kind: "credited"; balanceAfterCents: number; creditsAdded: number; announce: () => Promise<void> }
  | { kind: "not_ours" }
  | { kind: "not_creditable" };

export async function settleCharacterReplaceCharge(userId: string, reference: string, charge: PaystackVerifiedCharge): Promise<SettleResult> {
  if (charge.status !== "success" || charge.metadata?.purpose !== CHARACTER_REPLACE_TOPUP_PURPOSE) return { kind: "not_creditable" };
  if (charge.metadata?.user_id !== userId) {
    console.warn("[ai/topup] cr reference does not belong to caller", { userId, reference });
    return { kind: "not_ours" };
  }
  const { frenzAiCurrency } = await getLandingSettings();
  // a USD wallet paid for in naira: the settled naira is checked against the pin Paystack stored at initialize
  const credit = resolveCredit({ amount: Number(charge.amount), currency: charge.currency }, charge.metadata, frenzAiCurrency);
  if (!credit.ok) {
    console.error("[ai/topup] cr charge not creditable", { reference, reason: credit.reason, got: charge.currency, amount: charge.amount, wallet: frenzAiCurrency });
    return { kind: "not_creditable" };
  }
  const credited = await creditVerifiedCharacterReplaceRecharge({
    userId,
    reference,
    amountCents: credit.amountCents,
    currency: frenzAiCurrency,
    packId: charge.metadata?.ai_topup_pack,
    channel: charge.channel ?? null,
    paidAt: charge.paid_at ?? null,
    gatewayResponse: charge.gateway_response ?? null,
  });
  return {
    kind: "credited",
    balanceAfterCents: credited.balanceAfterCents,
    creditsAdded: credited.credits + credited.bonusCredits,
    announce: () =>
      announceCharacterReplaceRecharge({
        userId,
        reference,
        amountCents: credited.credits + credited.bonusCredits,
        currency: WALLET_UNIT,
        balanceAfterCents: credited.balanceAfterCents,
        channel: charge.channel ?? null,
        paidAt: charge.paid_at ?? null,
        gatewayResponse: charge.gateway_response ?? null,
      }),
  };
}

/**
 * A top-up that did not go through: recorded on the attempt row so the
 * statement is complete, and announced ONCE (claimed on the attempt row).
 * "failed" = Paystack refused the charge; "abandoned" = the checkout was closed
 * without paying (owner 2026-10-07: the member is told it was cancelled and
 * nothing was charged).
 */
export async function settleUnpaidTopup(opts: {
  userId: string;
  reference: string;
  outcome: "failed" | "abandoned";
  amountCents: number;
  currency: string;
  gatewayResponse?: string | null;
  channel?: string | null;
}): Promise<void> {
  await markTopupAttempt(opts.reference, { status: opts.outcome, gatewayResponse: opts.gatewayResponse ?? null, channel: opts.channel ?? null });
  if (!(Number.isFinite(opts.amountCents) && opts.amountCents > 0)) return;
  if (opts.outcome === "failed") {
    await notifyTopupFailed({ userId: opts.userId, reference: opts.reference, amountCents: opts.amountCents, currency: opts.currency, reason: opts.gatewayResponse ?? null, channel: opts.channel ?? null });
  } else {
    await notifyTopupCancelled({ userId: opts.userId, reference: opts.reference, amountCents: opts.amountCents, currency: opts.currency });
  }
}
