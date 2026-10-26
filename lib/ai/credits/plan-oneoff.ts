import "server-only";

import { markPlanCheckout, recordPlanAttempt, type OneOffPeriod, type SitePlanId } from "@/lib/ai/credits/plan-attempts";
import type { AiPlanId } from "@/lib/ai/credits/config";
import type { PaymentMarket } from "@/lib/ai/credits/wallet-config";
import { createFlutterwaveCheckout, flutterwaveFailureIsDefinite } from "@/lib/flutterwave/client";
import { FLUTTERWAVE_LOCAL_CURRENCY, flutterwaveChargeFor, localCurrencyFor } from "@/lib/payments/flutterwave-charge";
import { newFlutterwaveReference } from "@/lib/payments/references";
import type { RailAttempt } from "@/lib/payments/router";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Plans in NIGERIA as a one-off naira month (owner, 2026-10-24: "Plan doesn't show bank transfer and use Naira for only
 * Nigeria users" → "Nigeria: one-off naira month"). A subscription can only renew on a saved card, so Flutterwave offers
 * card alone on a payment plan; a member in Nigeria instead pays ONCE, in naira, for one month — bank transfer, USSD or
 * card — and pays again to continue. Nothing renews. Everyone else keeps the USD subscription.
 *
 * Returns null when a one-off month does not apply, and the caller opens the usual subscription checkout: not Nigeria,
 * no USD shown price to convert, naira unavailable (NGN not confirmed, no rate), or the member still has an
 * auto-renewing Flutterwave subscription (a one-off month must never sit beside one that keeps charging).
 *
 * The attempt is written BEFORE Flutterwave is called, with the naira amount, the rate and `one_off_period`; activation
 * (plan-attempts → activateOneOff…) grants one month only on a verified charge matching that row exactly.
 *
 * Ghana, Kenya, South Africa (2026-10-26): the same one-off month in GHS / KES / ZAR — their cards often refuse a dollar
 * subscription (lib/payments/flutterwave-charge.ts). Should Flutterwave refuse to OPEN a checkout in one of those
 * currencies, this answers null and the caller opens the USD subscription instead: the member is never left stuck.
 */
type Rail = RailAttempt<{ url: string; provider: "flutterwave" | "paystack" }>;

const NOT_STARTED = "Couldn't start checkout. Please try again in a moment.";
const NOT_CONFIRMED = "We couldn't confirm the payment page opened. Try again in a few minutes.";

export async function openOneOffPlanCheckout(i: {
  market: PaymentMarket | undefined;
  /** the edge's country (cf-ipcountry): Ghana, Kenya and South Africa pay in their own currency too */
  country?: string | null;
  purpose: "ai_subscription" | "site_subscription";
  userId: string;
  email: string;
  plan: AiPlanId | SitePlanId;
  /** the price members are SHOWN, in US cents (null: not a plain USD price → no one-off month) */
  shownUsdCents: number | null;
  title: string;
  callbackUrl: string;
  /** one month (default) or the 3-month bundle (Pro / Business in Nigeria, 2026-10-24) */
  period?: OneOffPeriod;
}): Promise<Rail | null> {
  const period = i.period ?? "monthly";
  const local = localCurrencyFor(i.market, i.country);
  if (!local || !i.shownUsdCents) return null;
  const table = i.purpose === "site_subscription" ? "subscriptions" : "ai_subscriptions";
  const { data } = await createAdminClient().from(table).select("provider, subscription_ref, cancel_at_period_end, status").eq("user_id", i.userId).maybeSingle();
  const row = data as { provider?: string | null; subscription_ref?: string | null; cancel_at_period_end?: boolean | null; status?: string | null } | null;
  if (row?.provider === "flutterwave" && row.subscription_ref && !row.cancel_at_period_end && row.status === "active") return null;

  const charge = await flutterwaveChargeFor(i.shownUsdCents, i.market, i.purpose, i.country);
  if (charge.currency !== local) return null;

  const reference = newFlutterwaveReference(i.purpose);
  const recorded = await recordPlanAttempt({ reference, userId: i.userId, plan: i.plan, listCents: i.shownUsdCents, listCurrency: "USD", providerAmount: charge.amountMinor, providerCurrency: charge.currency, provider: "flutterwave", purpose: i.purpose, oneOffPeriod: period, fxMinorPerUsd: charge.fxMinorPerUsd });
  if (!recorded) return { ok: false, refusal: "definite", status: 503, error: NOT_STARTED };
  try {
    // no payment plan: a plain one-off checkout, so every naira method the account has switched on is offered
    const url = await createFlutterwaveCheckout({ reference, amountMinor: charge.amountMinor, currency: charge.currency, email: i.email, redirectUrl: i.callbackUrl, title: `${i.title} — ${period === "quarterly" ? "3 months" : "1 month"}`, meta: { plan: i.plan, one_off: period } });
    await markPlanCheckout(reference, { url });
    return { ok: true, value: { url, provider: "flutterwave" } };
  } catch (e) {
    const definite = flutterwaveFailureIsDefinite(e);
    await markPlanCheckout(reference, { refused: definite });
    console.error("[plans] one-off month checkout failed", { purpose: i.purpose, currency: charge.currency, definite, error: e instanceof Error ? e.name : "unknown" });
    // a currency newer than naira refused for sure: nothing was created — the USD subscription opens instead
    if (definite && charge.currency !== FLUTTERWAVE_LOCAL_CURRENCY) return null;
    return definite ? { ok: false, refusal: "definite", status: 503, error: NOT_STARTED } : { ok: false, refusal: "unknown", status: 503, error: NOT_CONFIRMED };
  }
}
