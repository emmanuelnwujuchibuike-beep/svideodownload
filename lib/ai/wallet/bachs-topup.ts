import "server-only";

import { randomUUID } from "node:crypto";

import { announceCharacterReplaceRecharge, creditVerifiedCharacterReplaceRecharge } from "@/lib/ai/character-replace/recharge-server";
import { WALLET_UNIT } from "@/lib/ai/credits/units";
import type { Purchase } from "@/lib/ai/credits/wallet-config";
import { markTopupAttempt } from "@/lib/ai/topup-attempts";
import { BACHS_TOPUP_PREFIX, bachsConfigured, createBachsCheckout, decimalToMinor } from "@/lib/payments/bachs";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A CREDIT TOP-UP THROUGH BACHS — begin, and credit once when it is paid
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The same rules as the Paystack path (lib/ai/character-replace/topup-server.ts
 * and recharge-server.ts), the same one crediting function:
 *
 *   begin   the attempt row is written FIRST, with the provider, the price,
 *           the pack and its size — then the checkout is created (its id is
 *           stored on the row). No row, no checkout: a payment we could not
 *           match must never be taken.
 *   credit  only for a reference we created (the prefix and the row), for the
 *           member on the row, at the price on the row — a Bachs session
 *           cannot be created without our SECRET key, so the row is the
 *           authority for what was bought. When Bachs reports the payment in
 *           USD it must cover that price; in another currency (Bachs converts
 *           a USD price at its own page) the signed event is the proof.
 *           `credit_product_balance` is idempotent on the reference, so the
 *           webhook and the return can both run.
 */
export interface BachsAttempt {
  reference: string;
  user_id: string;
  amount_cents: number;
  currency: string;
  status: string;
  item_id: string | null;
  purpose: string;
  external_id: string | null;
}

export async function beginBachsTopup(opts: { userId: string; email: string; purchase: Purchase; successUrl: string; cancelUrl: string }): Promise<{ ok: true; url: string } | { ok: false; status: number; error: string }> {
  if (!bachsConfigured()) return { ok: false, status: 503, error: "Payments aren't available right now." };
  const reference = `${BACHS_TOPUP_PREFIX}${randomUUID()}`;
  const db = createAdminClient();
  const { error } = await db.from("ai_topup_attempts").insert({
    reference,
    user_id: opts.userId,
    amount_cents: opts.purchase.priceUsdCents,
    currency: "USD",
    status: "pending",
    provider: "bachs",
    purpose: "wallet_topup",
    item_id: opts.purchase.packId,
    credits: opts.purchase.credits,
  });
  if (error) {
    console.error("[ai/bachs] attempt not recorded — no checkout", { userId: opts.userId, message: error.message });
    return { ok: false, status: 503, error: "Payments aren't available right now." };
  }
  try {
    const join = (u: string) => `${u}${u.includes("?") ? "&" : "?"}reference=${encodeURIComponent(reference)}`;
    const checkout = await createBachsCheckout({
      amountUsdCents: opts.purchase.priceUsdCents,
      email: opts.email,
      reference,
      metadata: { user_id: opts.userId, purpose: "frenz_ai_credits", credits: String(opts.purchase.credits), pack: opts.purchase.packId ?? "custom" },
      successUrl: join(opts.successUrl),
      cancelUrl: join(opts.cancelUrl),
    });
    await db.from("ai_topup_attempts").update({ external_id: checkout.checkoutId, updated_at: new Date().toISOString() }).eq("reference", reference);
    return { ok: true, url: checkout.url };
  } catch (e) {
    console.error("[ai/bachs] checkout create failed", { reference, error: String(e).slice(0, 300) });
    await markTopupAttempt(reference, { status: "failed", gatewayResponse: "checkout could not be created" }).catch(() => null);
    return { ok: false, status: 502, error: "We couldn't start that payment. Try again." };
  }
}

export async function readBachsAttempt(reference: string): Promise<BachsAttempt | null> {
  // every Bachs reference we mint starts "frenz_bachs_" (a top-up: frenz_bachs_topup_, an AI plan: frenz_bachs_plan_)
  if (!reference.startsWith("frenz_bachs_")) return null;
  const { data, error } = await createAdminClient().from("ai_topup_attempts").select("reference, user_id, amount_cents, currency, status, purpose, item_id, external_id").eq("reference", reference).eq("provider", "bachs").maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BachsAttempt | null) ?? null;
}

/** Whether what Bachs reports covers what the row priced. Another currency cannot be compared here — the signed event is the proof then. */
export function bachsAmountCovers(attempt: Pick<BachsAttempt, "amount_cents">, reported: { amount?: unknown; currency?: unknown }): boolean {
  if (typeof reported.currency !== "string" || reported.currency.toUpperCase() !== "USD") return true;
  const paid = decimalToMinor(reported.amount);
  return paid !== null && paid + 1 >= Number(attempt.amount_cents);
}

/** Credit a paid Bachs top-up — once, whoever calls. Answers the credited facts, or null when it was not creditable. */
export async function creditBachsTopup(attempt: BachsAttempt, facts: { paidAt?: string | null; channel?: string | null; via: "webhook" | "return" }) {
  const credited = await creditVerifiedCharacterReplaceRecharge({
    userId: attempt.user_id,
    reference: attempt.reference,
    amountCents: Number(attempt.amount_cents),
    currency: "USD",
    packId: attempt.item_id,
    channel: facts.channel ?? "bachs",
    paidAt: facts.paidAt ?? null,
    gatewayResponse: `bachs ${facts.via}`,
  });
  return {
    credited,
    announce: () =>
      announceCharacterReplaceRecharge({
        userId: attempt.user_id,
        reference: attempt.reference,
        amountCents: credited.credits + credited.bonusCredits,
        currency: WALLET_UNIT,
        balanceAfterCents: credited.balanceAfterCents,
        channel: facts.channel ?? "bachs",
        paidAt: facts.paidAt ?? null,
        gatewayResponse: `bachs ${facts.via}`,
      }),
  };
}
