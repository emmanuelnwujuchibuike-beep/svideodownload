import "server-only";

import { randomUUID } from "node:crypto";

import { after } from "next/server";

import { resolveCheckoutRate } from "@/lib/ai/character-replace/fx-rate-server";
import { checkoutMetadata, quoteCheckout } from "@/lib/ai/character-replace/topup-fx";
import { resolvePurchase, type PaymentMarket, type Purchase, type TopupProviderId } from "@/lib/ai/credits/wallet-config";
import { beginBachsTopup } from "@/lib/ai/wallet/bachs-topup";
import { bachsConfigured } from "@/lib/payments/bachs";
import { routePayment } from "@/lib/payments/router";
import { recordTopupAttempt } from "@/lib/ai/topup-attempts";
import { getLandingSettings } from "@/lib/landing/settings";
import { CHARACTER_REPLACE_TOPUP_PURPOSE, initializeAiTopup, paystackEnabled } from "@/lib/paystack/paystack";
import { SITE_URL } from "@/lib/site";

/**
 * Begin a purchase of Frenz AI CREDITS (0184) into THE Frenz AI wallet (the
 * product wallet — one wallet since 0155). Shared by /api/ai/character-replace/topup
 * and /api/ai/balance/topup, so a member reaching either endpoint pays into
 * the same place under the same rules.
 *
 * 🔴 WHAT IS BOUGHT COMES FROM THE SERVER'S OFFER (`frenzAiPlans.wallet`),
 * never the body: a pack id names an enabled pack, a typed number of credits
 * must sit inside the custom bounds. The price is credits × centsPerCredit in
 * USD, converted to the checkout currency below. Nothing here credits
 * anything: the credit happens when the webhook or the verify-on-return route
 * confirms the payment, idempotently on the reference — and what is credited
 * is derived from the VERIFIED amount paid (wallet-config.ts `creditsForPayment`).
 */
export type TopupStart = { ok: true; url: string; credits: number; bonusCredits: number; priceUsdCents: number; provider: TopupProviderId } | { ok: false; status: number; error: string };

export async function beginCharacterReplaceTopup(opts: {
  userId: string;
  email: string;
  /** A pack id from the public offer. */
  packId?: unknown;
  /** A typed number of credits (custom amount). */
  credits?: unknown;
  /** Before 0184 the sheet sent dollars; a cached app may still. Read as that many dollars' worth of credits. */
  amountCents?: unknown;
  returnTo: unknown;
  /** The member's market, from the edge (lib/payments/router.ts `paymentMarket`) — never from the body. Absent = "other". */
  market?: PaymentMarket;
}): Promise<TopupStart> {
  const settings = await getLandingSettings();
  const plans = settings.frenzAiPlans;
  const cpc = plans.credits.centsPerCredit;
  const legacyCredits = typeof opts.amountCents === "number" && Number.isFinite(opts.amountCents) ? Math.floor(opts.amountCents / Math.max(1, cpc)) : undefined;
  const purchase = resolvePurchase({ packId: opts.packId, credits: opts.credits ?? legacyCredits }, plans.wallet, cpc);
  if ("error" in purchase) return { ok: false, status: 400, error: purchase.error };

  /*
    ── WHICH RAIL (owner, 2026-10-07) ─────────────────────────────────────
    The router orders the providers for this market; a provider is skipped
    when it is not configured. The next one is tried ONLY when the previous
    could not CREATE a checkout — the member never saw a payment page, so
    nothing can have been paid. Once a checkout URL exists it is returned and
    nothing else is opened.
  */
  const paystackOk = await paystackEnabled();
  const candidates = routePayment({ purpose: "wallet_topup", market: opts.market ?? "other", routing: plans.wallet.routing, usable: (p) => (p === "bachs" ? bachsConfigured() : paystackOk) });
  if (!candidates.length) return { ok: false, status: 503, error: "Payments aren't available right now." };
  let last: TopupStart = { ok: false, status: 503, error: "Payments aren't available right now." };
  for (const [i, provider] of candidates.entries()) {
    if (i > 0) console.warn("[payments] fallback_triggered", { purpose: "wallet_topup", from: candidates[i - 1], to: provider, userId: opts.userId });
    if (provider === "bachs") {
      const returnPath = `${SITE_URL}${safeReturnTo(opts.returnTo)}`;
      const started = await beginBachsTopup({ userId: opts.userId, email: opts.email, purchase, successUrl: returnPath, cancelUrl: returnPath });
      if (started.ok) {
        console.info("[payments] checkout_created", { provider, purpose: "wallet_topup", userId: opts.userId, credits: purchase.credits });
        return { ok: true, url: started.url, credits: purchase.credits, bonusCredits: purchase.bonusCredits, priceUsdCents: purchase.priceUsdCents, provider };
      }
      last = started;
      continue;
    }
    last = await beginPaystackTopup(opts, settings, purchase);
    if (last.ok) return last;
  }
  return last;
}

/** The Paystack rail — the code that has taken every top-up since 2026-09-09, unchanged in what it does. */
async function beginPaystackTopup(opts: { userId: string; email: string; returnTo: unknown }, settings: Awaited<ReturnType<typeof getLandingSettings>>, purchase: Purchase): Promise<TopupStart> {
  const cr = settings.frenzAiCharacterReplace;
  const amount = purchase.priceUsdCents;

  /*
    ── A USD wallet, paid for in naira (2026-09-20) ───────────────────────
    The member chose a wallet amount; Paystack is asked for the CHECKOUT
    currency at the operator's pinned rate, and the pin rides in the
    transaction's metadata so verify and the webhook credit the wallet
    amount only when the settled naira covers it. No rate configured = no
    checkout, said plainly — never a guessed exchange rate.
  */
  // 2026-09-20 (owner: "rate should be live rate"): the market rate, cached an hour, with the operator's markup; the manual rate only when nothing live or stored exists
  const rate = await resolveCheckoutRate(cr, settings.frenzAiCurrency);
  if (rate && "error" in rate) {
    console.error("[ai/cr/topup] no exchange rate for a converted checkout", { wallet: settings.frenzAiCurrency, checkout: cr.recharge.checkoutCurrency });
    return { ok: false, status: 503, error: "Payments aren't set up for this currency yet. Please try again later." };
  }
  const quote = quoteCheckout({ walletAmountCents: amount, walletCurrency: settings.frenzAiCurrency, checkoutCurrency: cr.recharge.checkoutCurrency, minorPerUsd: rate?.minorPerUsd ?? 0 });
  if ("error" in quote) {
    console.error("[ai/cr/topup] no exchange rate for a converted checkout", { wallet: settings.frenzAiCurrency, checkout: cr.recharge.checkoutCurrency });
    return { ok: false, status: 503, error: "Payments aren't set up for this currency yet. Please try again later." };
  }
  if (rate) console.info("[ai/cr/topup] checkout rate", { source: rate.source, provider: rate.provider, marketPerUsd: rate.marketPerUsd, markupPercent: rate.markupPercent, minorPerUsd: rate.minorPerUsd, fetchedAt: rate.fetchedAt });

  const reference = `${CHARACTER_REPLACE_TOPUP_PURPOSE}_${randomUUID()}`;
  try {
    const url = await initializeAiTopup({
      email: opts.email,
      userId: opts.userId,
      amount: quote.amount,
      currency: quote.currency,
      reference,
      purpose: CHARACTER_REPLACE_TOPUP_PURPOSE,
      callbackUrl: `${SITE_URL}${safeReturnTo(opts.returnTo)}`,
      // the pack and its size ride along for the statement and the bonus lookup — never as the amount credited
      pin: { ...checkoutMetadata(quote), ai_topup_pack: purchase.packId, ai_topup_credits: purchase.credits },
    });
    after(() => recordTopupAttempt({ reference, userId: opts.userId, amountCents: amount, currency: settings.frenzAiCurrency }));
    console.info("[payments] checkout_created", { provider: "paystack", purpose: "wallet_topup", userId: opts.userId, reference });
    return { ok: true, url, credits: purchase.credits, bonusCredits: purchase.bonusCredits, priceUsdCents: amount, provider: "paystack" };
  } catch (e) {
    // Never the provider's message: it can carry the request back, with the email in it.
    console.error("[ai/cr/topup] initialize failed", { userId: opts.userId, error: String(e) });
    return { ok: false, status: 502, error: "We couldn't start that payment. Try again." };
  }
}

/**
 * Where a payment page may send the member back: ALWAYS the credits page of
 * the section they were in (/ai/usage or /studio/ai/usage). That page is the
 * one that verifies the return and shows "verifying → added / still
 * confirming" — a tool page would show nothing while the webhook credits.
 * Anything else (an unknown path, a foreign host) becomes /ai/usage.
 */
export function safeReturnTo(value: unknown): string {
  return typeof value === "string" && (value === "/studio/ai" || value.startsWith("/studio/ai/")) ? "/studio/ai/usage" : "/ai/usage";
}
