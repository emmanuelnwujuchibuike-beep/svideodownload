import "server-only";

import { resolveCheckoutRate } from "@/lib/ai/character-replace/fx-rate-server";
import { quoteCheckout } from "@/lib/ai/character-replace/topup-fx";
import type { PaymentMarket } from "@/lib/ai/credits/wallet-config";
import { FLUTTERWAVE_CHECKOUT_CURRENCY, flutterwaveCheckoutGate, getFlutterwaveConfig, type FlutterwavePurpose } from "@/lib/flutterwave/config";
import { getLandingSettings } from "@/lib/landing/settings";

/**
 * What a ONE-OFF Flutterwave checkout charges (owner, 2026-10-24: "I set up bank transfer on Flutterwave but it's showing
 * only card and PayPal" → "NGN for Nigeria, USD elsewhere").
 *
 * Flutterwave offers the methods of the CURRENCY charged: bank transfer, USSD, account, OPay… exist only for NGN; a USD
 * checkout can show card / PayPal only. So a member in Nigeria (the edge's country, never the browser's word) is charged in
 * NGN at the SAME live rate Paystack uses (resolveCheckoutRate + quoteCheckout, the operator's markup included); everyone
 * else in USD, as before. The amount and currency are written on the attempt row BEFORE the checkout, and every settle
 * path matches the provider's verified charge against that row — so a naira charge settles, credits or grants exactly as
 * a dollar one did (the credit is still the USD price stored on the row).
 *
 * Naira is used only when NGN is confirmed for the purpose (the capability gate — on by default) and a rate exists;
 * otherwise the charge stays USD: never a guessed rate, never a closed checkout. Subscriptions are NOT here: Flutterwave
 * payment plans are card-only whatever the currency, and stay USD.
 */
export const FLUTTERWAVE_LOCAL_CURRENCY = "NGN";

export interface FlutterwaveCharge {
  currency: string;
  amountMinor: number;
  /** minor units of `currency` per USD, when converted (null = USD as it is) */
  fxMinorPerUsd: number | null;
}

export async function flutterwaveChargeFor(usdCents: number, market: PaymentMarket | undefined, purpose: FlutterwavePurpose): Promise<FlutterwaveCharge> {
  const usd: FlutterwaveCharge = { currency: FLUTTERWAVE_CHECKOUT_CURRENCY, amountMinor: usdCents, fxMinorPerUsd: null };
  if (market !== "NG") return usd;
  if (!flutterwaveCheckoutGate(purpose, FLUTTERWAVE_LOCAL_CURRENCY, await getFlutterwaveConfig()).ok) return usd;
  try {
    const cr = (await getLandingSettings()).frenzAiCharacterReplace;
    // the rate service converts into Paystack's checkout currency: used only when that IS naira (never another currency's rate)
    if (String(cr.recharge.checkoutCurrency).toUpperCase() !== FLUTTERWAVE_LOCAL_CURRENCY) return usd;
    const rate = await resolveCheckoutRate(cr, "USD");
    if (!rate || "error" in rate) return usd;
    const q = quoteCheckout({ walletAmountCents: usdCents, walletCurrency: "USD", checkoutCurrency: FLUTTERWAVE_LOCAL_CURRENCY, minorPerUsd: rate.minorPerUsd });
    if ("error" in q || q.currency !== FLUTTERWAVE_LOCAL_CURRENCY || !(q.amount > 0)) return usd;
    return { currency: q.currency, amountMinor: q.amount, fxMinorPerUsd: q.minorPerUsd || null };
  } catch {
    return usd;
  }
}
