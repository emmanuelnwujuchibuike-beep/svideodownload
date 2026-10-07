import "server-only";

import { creditCharacterReplaceBalance } from "@/lib/ai/character-replace/wallet";
import { creditsForPayment } from "@/lib/ai/credits/wallet-config";
import { getLandingSettings } from "@/lib/landing/settings";
import { markTopupAttempt } from "@/lib/ai/topup-attempts";
import { notifyTopupSuccess } from "@/lib/ai/topup-notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/site";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A VERIFIED CHARACTER REPLACE RECHARGE, CREDITED ONCE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Called from the two places a verified Paystack charge with
 * `purpose = frenz_cr_topup` can arrive — the webhook and the verify-on-return
 * route — with the charge ALREADY verified by them (signature or
 * /transaction/verify, ownership, currency, amount). This module only routes
 * the credit to the product wallet and announces it once.
 *
 * Both callers may run for the same reference; `credit_product_balance` is
 * idempotent on it, and the announcement claims `notified_at` on the product
 * ledger row so exactly one push and one receipt go out.
 */
export interface CreditedRecharge {
  /** The wallet after the credit, in credits. */
  balanceAfterCents: number;
  credits: number;
  bonusCredits: number;
}

/**
 * 🔴 0184: the wallet holds CREDITS. `amountCents` is the VERIFIED amount paid
 * in the list currency (USD cents — the callers have already checked the
 * settled checkout currency against the pin). What it buys is derived here and
 * only here (`creditsForPayment`): ⌊paid ÷ centsPerCredit⌋ credits, plus the
 * bonus of a configured pack of exactly that size. The bonus is its own
 * `bonus` row on the same reference, so a replay can add neither twice.
 */
export async function creditVerifiedCharacterReplaceRecharge(opts: {
  userId: string;
  reference: string;
  /** Verified, in USD cents. */
  amountCents: number;
  /** The list currency the amount is in (USD). Recorded on the row's metadata; the row itself is in credits. */
  currency: string;
  /** The pack named at checkout (metadata) — consulted for a bonus only, never for the amount. */
  packId?: unknown;
  channel?: string | null;
  paidAt?: string | null;
  gatewayResponse?: string | null;
}): Promise<CreditedRecharge> {
  const plans = (await getLandingSettings()).frenzAiPlans;
  const bought = creditsForPayment({ paidUsdCents: opts.amountCents, packId: opts.packId }, plans.wallet, plans.credits.centsPerCredit);
  if (bought.credits <= 0) throw new Error(`a payment of ${opts.amountCents} ${opts.currency} cents buys no credits at ${plans.credits.centsPerCredit}¢ each`);
  const meta = { channel: opts.channel ?? null, paid_at: opts.paidAt ?? null, paid_cents: opts.amountCents, paid_currency: opts.currency, cents_per_credit: plans.credits.centsPerCredit, pack: bought.packId };
  let balance = await creditCharacterReplaceBalance({ userId: opts.userId, amountCents: bought.credits, kind: "recharge", reference: opts.reference, metadata: meta });
  if (bought.bonusCredits > 0) {
    balance = await creditCharacterReplaceBalance({ userId: opts.userId, amountCents: bought.bonusCredits, kind: "bonus", reference: opts.reference, note: "Pack bonus", metadata: { pack: bought.packId } });
  }
  return { balanceAfterCents: balance, credits: bought.credits, bonusCredits: bought.bonusCredits };
}

/** The off-the-money-path work: the attempt row and the once-only announcement. */
export async function announceCharacterReplaceRecharge(opts: {
  userId: string;
  reference: string;
  amountCents: number;
  currency: string;
  balanceAfterCents: number;
  channel?: string | null;
  paidAt?: string | null;
  gatewayResponse?: string | null;
}): Promise<void> {
  await markTopupAttempt(opts.reference, {
    status: "success",
    gatewayResponse: opts.gatewayResponse ?? null,
    channel: opts.channel ?? null,
    paidAt: opts.paidAt ?? null,
  });
  await notifyTopupSuccess({
    userId: opts.userId,
    reference: opts.reference,
    amountCents: opts.amountCents,
    currency: opts.currency,
    balanceAfterCents: opts.balanceAfterCents,
    channel: opts.channel ?? null,
    paidAt: opts.paidAt ?? null,
    claim: () => claimRechargeNotification(opts.userId, opts.reference),
    productLabel: "Frenz AI",
    ctaUrl: `${SITE_URL}/ai/usage`,
  });
}

/**
 * The once-only claim: a conditional UPDATE on the product ledger row's
 * `notified_at`. Whichever of the two callers lands first claims it; the
 * other finds it set and sends nothing.
 */
async function claimRechargeNotification(userId: string, reference: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("ai_product_ledger")
    .update({ notified_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("product", "character_replace")
    .eq("kind", "recharge")
    .eq("reference", reference)
    .is("notified_at", null)
    .select("id");
  if (error) {
    console.error("[cr/recharge] notification claim failed", { userId, reference, error: error.message });
    return false;
  }
  return (data ?? []).length > 0;
}
