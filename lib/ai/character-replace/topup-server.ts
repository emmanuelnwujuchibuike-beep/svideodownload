import "server-only";

import { randomUUID } from "node:crypto";

import { after } from "next/server";

import { resolveCheckoutRate } from "@/lib/ai/character-replace/fx-rate-server";
import { checkoutMetadata, quoteCheckout } from "@/lib/ai/character-replace/topup-fx";
import { resolvePurchase, type PaymentMarket, type Purchase, type TopupProviderId } from "@/lib/ai/credits/wallet-config";
import { resolveHeldTopups } from "@/lib/ai/wallet/reconcile-topups";
import { createFlutterwaveCheckout, flutterwaveFailureIsDefinite } from "@/lib/flutterwave/client";
import { FLUTTERWAVE_CHECKOUT_CURRENCY } from "@/lib/flutterwave/config";
import { usableRails } from "@/lib/payments/rails";
import { newFlutterwaveReference } from "@/lib/payments/references";
import { firstRail, routePayment, type RailAttempt } from "@/lib/payments/router";
import { getLandingSettings } from "@/lib/landing/settings";
import { CHARACTER_REPLACE_TOPUP_PURPOSE, initializeAiTopup, paystackRefusedForSure } from "@/lib/paystack/paystack";
import { SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";

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
  /** The member's pick of provider (2026-10-07) — honoured only when the admin allows a choice, and only among what the route offers. */
  provider?: unknown;
}): Promise<TopupStart> {
  const settings = await getLandingSettings();
  const plans = settings.frenzAiPlans;
  const cpc = plans.credits.centsPerCredit;
  const legacyCredits = typeof opts.amountCents === "number" && Number.isFinite(opts.amountCents) ? Math.floor(opts.amountCents / Math.max(1, cpc)) : undefined;
  const purchase = resolvePurchase({ packId: opts.packId, credits: opts.credits ?? legacyCredits }, plans.wallet, cpc);
  if ("error" in purchase) return { ok: false, status: 400, error: purchase.error };

  /*
    ── WHICH RAIL ─────────────────────────────────────────────────────────
    The router orders the providers for this market; a provider is skipped
    when it is not usable (Flutterwave: the account capability gate, and a
    USD wallet — its price IS the charge). The next one is tried ONLY after
    a DEFINITE refusal (nothing was created at the provider). An unknown
    outcome — a timeout, a 5xx — ends the attempt: a checkout may exist,
    and a second rail is how somebody pays twice.
  */
  // Part 3: an earlier checkout (either rail) whose creation outcome was unknown is resolved first — never two at once
  const held = await resolveHeldTopups(opts.userId);
  if (held === "unavailable") return { ok: false, status: 503, error: "Payments aren't available right now." };
  if (held === "held") return { ok: false, status: 409, error: "Your last payment is still being confirmed. Try again in a few minutes." };

  const usable = await usableRails("wallet_topup");
  const walletUsd = settings.frenzAiCurrency.toUpperCase() === FLUTTERWAVE_CHECKOUT_CURRENCY;
  const candidates = routePayment({ purpose: "wallet_topup", market: opts.market ?? "other", routing: plans.wallet.routing, usable: (p) => usable(p) && (p !== "flutterwave" || walletUsd), preferred: plans.wallet.memberChoice ? opts.provider : undefined });
  if (!candidates.length) return { ok: false, status: 503, error: "Payments aren't available right now." };
  const out = await firstRail(
    candidates,
    (provider) => (provider === "flutterwave" ? beginFlutterwaveTopup(opts, purchase) : beginPaystackTopup(opts, settings, purchase)),
    (from, to) => console.warn("[payments] fallback_triggered", { purpose: "wallet_topup", from, to, userId: opts.userId }),
  );
  return out.ok ? out.value : { ok: false, status: out.status, error: out.error };
}

type TopupOk = Extract<TopupStart, { ok: true }>;

/**
 * 🔴 The attempt row is written BEFORE the provider is called, and synchronously (Part 2: it used
 * to be written in `after()`, so a lost insert left a paid checkout with no record to reconcile).
 * A row that can't be written stops the checkout — nothing was created anywhere, so the next
 * rail may be tried.
 */
async function insertAttempt(row: Record<string, unknown>): Promise<boolean> {
  const { error } = await createAdminClient().from("ai_topup_attempts").insert({ status: "pending", purpose: "wallet_topup", ...row });
  if (error) console.error("[ai/topup] attempt record failed — checkout not opened", { reference: row.reference, provider: row.provider, message: error.message });
  return !error;
}

/**
 * The Flutterwave rail (Part 2): USD, the exact list price, no conversion. Opened only when the
 * capability gate allowed it (the router's `usable`).
 */
async function beginFlutterwaveTopup(opts: { userId: string; email: string; returnTo: unknown }, purchase: Purchase): Promise<RailAttempt<TopupOk>> {
  const unavailable = { ok: false as const, refusal: "definite" as const, status: 503, error: "Payments aren't available right now." };

  const amount = purchase.priceUsdCents;
  const reference = newFlutterwaveReference("wallet_topup");
  const recorded = await insertAttempt({ reference, user_id: opts.userId, provider: "flutterwave", amount_cents: amount, currency: FLUTTERWAVE_CHECKOUT_CURRENCY, provider_amount: amount, provider_currency: FLUTTERWAVE_CHECKOUT_CURRENCY, fx_minor_per_usd: null, credits: purchase.credits, item_id: purchase.packId });
  if (!recorded) return unavailable;
  try {
    const url = await createFlutterwaveCheckout({ reference, amountMinor: amount, currency: FLUTTERWAVE_CHECKOUT_CURRENCY, email: opts.email, redirectUrl: `${SITE_URL}${safeReturnTo(opts.returnTo)}`, title: "Frenz AI credits", meta: { credits: purchase.credits } });
    await createAdminClient().from("ai_topup_attempts").update({ checkout_url: url, updated_at: new Date().toISOString() }).eq("reference", reference);
    console.info("[payments] checkout_created", { provider: "flutterwave", purpose: "wallet_topup", userId: opts.userId, reference });
    return { ok: true, value: { ok: true, url, credits: purchase.credits, bonusCredits: purchase.bonusCredits, priceUsdCents: amount, provider: "flutterwave" } };
  } catch (e) {
    const definite = flutterwaveFailureIsDefinite(e);
    await createAdminClient()
      .from("ai_topup_attempts")
      .update(definite ? { status: "failed", status_reason: "flutterwave refused the checkout", updated_at: new Date().toISOString() } : { status: "verification_required", status_reason: "flutterwave checkout outcome unknown", updated_at: new Date().toISOString() })
      .eq("reference", reference);
    // never the provider's message: it can carry the request back
    console.error("[ai/cr/topup] flutterwave initialize failed", { userId: opts.userId, reference, definite, error: e instanceof Error ? e.name : "unknown" });
    // 503, never 502: Cloudflare replaces an origin 502 with its own HTML page. `refusal`, not the status, decides the fallback
    return definite ? { ok: false, refusal: "definite", status: 503, error: "We couldn't start that payment. Try again." } : { ok: false, refusal: "unknown", status: 503, error: "We couldn't confirm the payment page opened. Nothing more will be charged — try again in a few minutes." };
  }
}

/** The Paystack rail — the code that has taken every top-up since 2026-09-09; since Part 2 its attempt row is written first. */
async function beginPaystackTopup(opts: { userId: string; email: string; returnTo: unknown }, settings: Awaited<ReturnType<typeof getLandingSettings>>, purchase: Purchase): Promise<RailAttempt<TopupOk>> {
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
  // `recharge.checkoutCurrency` is PAYSTACK's checkout currency (NGN: the Paystack account is in naira) — never Flutterwave's
  const paystackCurrency = cr.recharge.checkoutCurrency;
  const noRate = { ok: false as const, refusal: "definite" as const, status: 503, error: "Payments aren't set up for this currency yet. Please try again later." };
  const rate = await resolveCheckoutRate(cr, settings.frenzAiCurrency);
  if (rate && "error" in rate) {
    console.error("[ai/cr/topup] no exchange rate for a converted checkout", { wallet: settings.frenzAiCurrency, checkout: paystackCurrency });
    return noRate;
  }
  const quote = quoteCheckout({ walletAmountCents: amount, walletCurrency: settings.frenzAiCurrency, checkoutCurrency: paystackCurrency, minorPerUsd: rate?.minorPerUsd ?? 0 });
  if ("error" in quote) {
    console.error("[ai/cr/topup] no exchange rate for a converted checkout", { wallet: settings.frenzAiCurrency, checkout: paystackCurrency });
    return noRate;
  }
  if (rate) console.info("[ai/cr/topup] checkout rate", { source: rate.source, provider: rate.provider, marketPerUsd: rate.marketPerUsd, markupPercent: rate.markupPercent, minorPerUsd: rate.minorPerUsd, fetchedAt: rate.fetchedAt });

  const reference = `${CHARACTER_REPLACE_TOPUP_PURPOSE}_${randomUUID()}`;
  const recorded = await insertAttempt({ reference, user_id: opts.userId, provider: "paystack", amount_cents: amount, currency: settings.frenzAiCurrency, provider_amount: quote.amount, provider_currency: quote.currency, fx_minor_per_usd: quote.minorPerUsd, credits: purchase.credits, item_id: purchase.packId });
  if (!recorded) return { ok: false, refusal: "definite", status: 503, error: "Payments aren't available right now." };
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
    after(async () => {
      await createAdminClient().from("ai_topup_attempts").update({ checkout_url: url, updated_at: new Date().toISOString() }).eq("reference", reference);
    });
    console.info("[payments] checkout_created", { provider: "paystack", purpose: "wallet_topup", userId: opts.userId, reference });
    return { ok: true, value: { ok: true, url, credits: purchase.credits, bonusCredits: purchase.bonusCredits, priceUsdCents: amount, provider: "paystack" } };
  } catch (e) {
    // Never the provider's message: it can carry the request back, with the email in it.
    console.error("[ai/cr/topup] initialize failed", { userId: opts.userId, error: String(e) });
    /*
      Part 3: only Paystack's own 4xx answer is a refusal (nothing was created) — the attempt is closed. A timeout, a 5xx
      or an unreadable body is UNKNOWN: held as verification_required and resolved by asking Paystack about the reference
      (the cron sweep, and before this member's next checkout) — never retried on another rail.
    */
    const definite = paystackRefusedForSure(e);
    await createAdminClient()
      .from("ai_topup_attempts")
      .update(definite ? { status: "failed", status_reason: "paystack refused the checkout", updated_at: new Date().toISOString() } : { status: "verification_required", status_reason: "paystack checkout outcome unknown", updated_at: new Date().toISOString() })
      .eq("reference", reference)
      .eq("status", "pending");
    return { ok: false, refusal: definite ? "definite" : "unknown", status: 503, error: "We couldn't start that payment. Try again." };
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
