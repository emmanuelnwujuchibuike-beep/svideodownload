import "server-only";

import { creditCharacterReplaceBalance } from "@/lib/ai/character-replace/wallet";
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
export async function creditVerifiedCharacterReplaceRecharge(opts: {
  userId: string;
  reference: string;
  amountCents: number;
  currency: string;
  channel?: string | null;
  paidAt?: string | null;
  gatewayResponse?: string | null;
}): Promise<number> {
  const balanceAfterCents = await creditCharacterReplaceBalance({
    userId: opts.userId,
    amountCents: opts.amountCents,
    kind: "recharge",
    reference: opts.reference,
    currency: opts.currency,
    metadata: { channel: opts.channel ?? null, paid_at: opts.paidAt ?? null },
  });
  return balanceAfterCents;
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
    productLabel: "Character Replace",
    ctaUrl: `${SITE_URL}/ai/character-replace`,
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
