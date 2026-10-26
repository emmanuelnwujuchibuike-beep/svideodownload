import "server-only";

import { resolveCheckoutRate } from "@/lib/ai/character-replace/fx-rate-server";
import { quoteCheckout } from "@/lib/ai/character-replace/topup-fx";
import type { PaymentMarket } from "@/lib/ai/credits/wallet-config";
import { readFlutterwaveUsdRate } from "@/lib/flutterwave/client";
import { FLUTTERWAVE_CHECKOUT_CURRENCY, flutterwaveCheckoutGate, flutterwaveCollectionGate, getFlutterwaveConfig, type FlutterwavePurpose } from "@/lib/flutterwave/config";
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
 *
 * ── 🔴 OTHER AFRICAN MARKETS (2026-10-26) ──────────────────────────────────
 * The first Pro subscription from outside Nigeria — a Visa issued in GHANA — was refused by its bank: "Restricted Card:
 * we cannot charge your card due to bank restrictions" (a dollar, card-not-present, recurring charge; Flutterwave
 * processed it correctly). A Nigerian Mastercard got the same answer on the dollar plan the day before. Many African
 * cards cannot pay in dollars at all. So a member in GHANA, KENYA or SOUTH AFRICA is offered the Nigerian shape in their
 * own currency — one month paid once in GHS / KES / ZAR, with that currency's methods (mobile money, M-Pesa, local card),
 * at Flutterwave's own live rate (readFlutterwaveUsdRate). The USD card subscription stays beside it. The account holds
 * balances in all three; the currency must also pass the capability gate, and with no rate the charge stays USD.
 */
export const FLUTTERWAVE_LOCAL_CURRENCY = "NGN";

/** Countries charged in their own currency on a one-off checkout, beyond Nigeria (two-decimal currencies only). */
export const LOCAL_CHECKOUT_CURRENCY: Readonly<Record<string, string>> = { GH: "GHS", KE: "KES", ZA: "ZAR" };

/** The member's own currency for a one-off checkout (NGN for Nigeria), or null — the edge's country only. */
export function localCurrencyFor(market: PaymentMarket | undefined, country: string | null | undefined): string | null {
  if (market === "NG") return FLUTTERWAVE_LOCAL_CURRENCY;
  return LOCAL_CHECKOUT_CURRENCY[(country ?? "").toUpperCase()] ?? null;
}

export interface FlutterwaveCharge {
  currency: string;
  amountMinor: number;
  /** minor units of `currency` per USD, when converted (null = USD as it is) */
  fxMinorPerUsd: number | null;
}

/**
 * `purpose`: a checkout purpose (its own switch in the capability gate), or "coin_deposit" — Frenz Coin's switch is its
 * own audited setting, so only the rail half of the gate applies (the same rule lib/coin/deposits.ts uses).
 */
export async function flutterwaveChargeFor(usdCents: number, market: PaymentMarket | undefined, purpose: FlutterwavePurpose | "coin_deposit", country?: string | null): Promise<FlutterwaveCharge> {
  const usd: FlutterwaveCharge = { currency: FLUTTERWAVE_CHECKOUT_CURRENCY, amountMinor: usdCents, fxMinorPerUsd: null };
  const local = localCurrencyFor(market, country);
  if (!local) return usd;
  const cfg = await getFlutterwaveConfig();
  if (!(purpose === "coin_deposit" ? flutterwaveCollectionGate(local, cfg) : flutterwaveCheckoutGate(purpose, local, cfg)).ok) return usd;
  try {
    let minorPerUsd: number | null = null;
    if (local === FLUTTERWAVE_LOCAL_CURRENCY) {
      const cr = (await getLandingSettings()).frenzAiCharacterReplace;
      // the rate service converts into Paystack's checkout currency: used only when that IS naira (never another currency's rate)
      if (String(cr.recharge.checkoutCurrency).toUpperCase() !== FLUTTERWAVE_LOCAL_CURRENCY) return usd;
      const rate = await resolveCheckoutRate(cr, "USD");
      if (!rate || "error" in rate) return usd;
      minorPerUsd = rate.minorPerUsd;
    } else {
      minorPerUsd = await readFlutterwaveUsdRate(local);
    }
    if (!minorPerUsd) return usd;
    const q = quoteCheckout({ walletAmountCents: usdCents, walletCurrency: "USD", checkoutCurrency: local, minorPerUsd });
    if ("error" in q || q.currency !== local || !(q.amount > 0)) return usd;
    return { currency: q.currency, amountMinor: q.amount, fxMinorPerUsd: q.minorPerUsd || null };
  } catch {
    return usd;
  }
}
