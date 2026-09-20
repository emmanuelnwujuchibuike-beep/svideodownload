/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE WALLET IN ONE CURRENCY, THE CHECKOUT IN ANOTHER (2026-09-20)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner: "Make the AI top-up show USD as the currency, but when clicked it
 * converts the USD price to naira on Paystack, because my Paystack is naira.
 * The shortcut amounts, the custom amount and the balance should all show in
 * USD; on Proceed it converts to naira on the Paystack checkout."
 *
 * So there are two currencies and one rule between them:
 *
 *   · the WALLET currency (`frenzAiCurrency`, e.g. USD) — every price, every
 *     balance, every ledger line, every amount a member types;
 *   · the CHECKOUT currency (`recharge.checkoutCurrency`, e.g. NGN) — the
 *     currency Paystack is asked to collect in;
 *   · the RATE (`localMinorUnitsPerUsd`) — checkout minor units per one US
 *     dollar, set by the operator (₦1,500 = 150,000 kobo per $1).
 *
 * `quoteCheckout` turns a wallet amount into the checkout amount and pins the
 * rate; that pin travels in the transaction's metadata, which Paystack
 * stores at initialize (server-set — a browser never writes it) and hands
 * back at verify and in the webhook. `resolveCredit` is then the ONE rule
 * for what a settled charge is worth in the wallet:
 *
 *   · settled in the wallet currency → the settled amount, as always;
 *   · settled in the checkout currency with a pinned conversion → the wallet
 *     amount that was pinned, but only when the settled amount covers what
 *     that pin says it should (a partial or tampered charge credits nothing);
 *   · anything else → nothing, and the caller logs it.
 *
 * Pure. Same file for the initializer, the verify route and the webhook so
 * the three can never disagree on the arithmetic.
 */

export interface CheckoutQuote {
  /** The currency Paystack collects in. */
  currency: string;
  /** Minor units of that currency. */
  amount: number;
  /** The wallet amount this pays for, wallet minor units. */
  walletAmountCents: number;
  walletCurrency: string;
  /** Checkout minor units per one USD, when a conversion applies; null when none. */
  minorPerUsd: number | null;
}

/** Only a USD wallet converts today; every other pairing must match Paystack's currency exactly. */
export function conversionApplies(walletCurrency: string, checkoutCurrency: string): boolean {
  return walletCurrency.toUpperCase() === "USD" && checkoutCurrency.toUpperCase() !== "USD";
}

/** USD cents → checkout minor units, rounded to the nearest unit. */
export function convertUsdCents(usdCents: number, minorPerUsd: number): number {
  return Math.round((usdCents * minorPerUsd) / 100);
}

export function quoteCheckout(input: { walletAmountCents: number; walletCurrency: string; checkoutCurrency: string; minorPerUsd: number }): CheckoutQuote | { error: "rate-missing" } {
  const walletCurrency = input.walletCurrency.toUpperCase();
  const checkoutCurrency = input.checkoutCurrency.toUpperCase();
  if (!conversionApplies(walletCurrency, checkoutCurrency)) {
    return { currency: walletCurrency, amount: input.walletAmountCents, walletAmountCents: input.walletAmountCents, walletCurrency, minorPerUsd: null };
  }
  if (!Number.isInteger(input.minorPerUsd) || input.minorPerUsd <= 0) return { error: "rate-missing" };
  return {
    currency: checkoutCurrency,
    amount: convertUsdCents(input.walletAmountCents, input.minorPerUsd),
    walletAmountCents: input.walletAmountCents,
    walletCurrency,
    minorPerUsd: input.minorPerUsd,
  };
}

/** What the initializer pins beside the charge. Read back by verify and the webhook. */
export interface TopupMetadata {
  ai_topup_cents?: unknown;
  wallet_currency?: unknown;
  charged_currency?: unknown;
  fx_minor_per_usd?: unknown;
}

export function checkoutMetadata(q: CheckoutQuote): { ai_topup_cents: number; wallet_currency: string; charged_currency: string; fx_minor_per_usd: number | null } {
  return { ai_topup_cents: q.walletAmountCents, wallet_currency: q.walletCurrency, charged_currency: q.currency, fx_minor_per_usd: q.minorPerUsd };
}

export type CreditResolution = { ok: true; amountCents: number; currency: string; converted: boolean } | { ok: false; reason: "currency-mismatch" | "amount-short" | "no-pin" };

/**
 * The one rule for what a settled charge is worth in the wallet. `settled`
 * is Paystack's own record (amount in the settled currency's minor units);
 * `meta` is the metadata Paystack stored at initialize.
 */
export function resolveCredit(settled: { amount: number; currency: string | null | undefined }, meta: TopupMetadata | null | undefined, walletCurrency: string): CreditResolution {
  const wallet = walletCurrency.toUpperCase();
  const cur = (settled.currency ?? "").toUpperCase();
  if (!Number.isFinite(settled.amount) || settled.amount <= 0) return { ok: false, reason: "amount-short" };
  if (cur === wallet) return { ok: true, amountCents: Math.round(settled.amount), currency: wallet, converted: false };

  const pinnedWallet = typeof meta?.wallet_currency === "string" ? meta.wallet_currency.toUpperCase() : null;
  const pinnedCharged = typeof meta?.charged_currency === "string" ? meta.charged_currency.toUpperCase() : null;
  const pinnedCents = typeof meta?.ai_topup_cents === "number" ? meta.ai_topup_cents : Number(meta?.ai_topup_cents);
  const fx = typeof meta?.fx_minor_per_usd === "number" ? meta.fx_minor_per_usd : Number(meta?.fx_minor_per_usd);
  if (pinnedWallet !== wallet || pinnedCharged !== cur || !Number.isInteger(pinnedCents) || pinnedCents <= 0 || !Number.isInteger(fx) || fx <= 0) {
    return { ok: false, reason: pinnedWallet && pinnedCharged ? "currency-mismatch" : "no-pin" };
  }
  if (!conversionApplies(wallet, cur)) return { ok: false, reason: "currency-mismatch" };
  // one minor unit of tolerance for the provider's own rounding, never more
  if (settled.amount + 1 < convertUsdCents(pinnedCents, fx)) return { ok: false, reason: "amount-short" };
  return { ok: true, amountCents: pinnedCents, currency: wallet, converted: true };
}
