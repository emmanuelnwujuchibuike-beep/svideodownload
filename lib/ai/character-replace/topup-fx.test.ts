import { describe, expect, it } from "vitest";

import { checkoutMetadata, conversionApplies, convertUsdCents, quoteCheckout, resolveCredit } from "./topup-fx";

/**
 * A USD wallet paid for in naira (owner, 2026-09-20). The arithmetic the
 * initializer, the verify route and the webhook all share.
 */
describe("quoteCheckout", () => {
  it("a USD wallet with a naira checkout converts at the pinned rate: $5.00 at ₦1,500/$ = ₦7,500", () => {
    const q = quoteCheckout({ walletAmountCents: 500, walletCurrency: "USD", checkoutCurrency: "NGN", minorPerUsd: 150_000 });
    expect(q).toEqual({ currency: "NGN", amount: 750_000, walletAmountCents: 500, walletCurrency: "USD", minorPerUsd: 150_000 });
    expect(convertUsdCents(1, 150_000)).toBe(1_500); // one cent = ₦15.00
    expect(convertUsdCents(333, 150_000)).toBe(499_500);
  });
  it("a wallet already in the checkout currency charges the same number, no rate needed", () => {
    expect(quoteCheckout({ walletAmountCents: 45_000, walletCurrency: "NGN", checkoutCurrency: "NGN", minorPerUsd: 0 })).toEqual({ currency: "NGN", amount: 45_000, walletAmountCents: 45_000, walletCurrency: "NGN", minorPerUsd: null });
    expect(conversionApplies("NGN", "NGN")).toBe(false);
    expect(conversionApplies("usd", "ngn")).toBe(true);
  });
  it("refuses to convert without a rate — no guessed exchange rate, ever", () => {
    expect(quoteCheckout({ walletAmountCents: 500, walletCurrency: "USD", checkoutCurrency: "NGN", minorPerUsd: 0 })).toEqual({ error: "rate-missing" });
  });
  it("the pin that rides in Paystack's metadata carries the wallet amount, both currencies and the rate", () => {
    const q = quoteCheckout({ walletAmountCents: 500, walletCurrency: "USD", checkoutCurrency: "NGN", minorPerUsd: 150_000 });
    expect("error" in q ? null : checkoutMetadata(q)).toEqual({ ai_topup_cents: 500, wallet_currency: "USD", charged_currency: "NGN", fx_minor_per_usd: 150_000 });
  });
});

describe("resolveCredit — what a settled charge is worth in the wallet", () => {
  const pin = { ai_topup_cents: 500, wallet_currency: "USD", charged_currency: "NGN", fx_minor_per_usd: 150_000 };
  it("settled in the wallet currency → the settled amount (the pre-FX rule, unchanged)", () => {
    expect(resolveCredit({ amount: 45_000, currency: "NGN" }, null, "NGN")).toEqual({ ok: true, amountCents: 45_000, currency: "NGN", converted: false });
  });
  it("settled in naira for a USD wallet → the PINNED dollar amount, when the naira covers it", () => {
    expect(resolveCredit({ amount: 750_000, currency: "NGN" }, pin, "USD")).toEqual({ ok: true, amountCents: 500, currency: "USD", converted: true });
    // the provider's own rounding: one minor unit short is still fine
    expect(resolveCredit({ amount: 749_999, currency: "NGN" }, pin, "USD")).toMatchObject({ ok: true, amountCents: 500 });
  });
  it("a short, tampered or unpinned charge credits nothing", () => {
    expect(resolveCredit({ amount: 700_000, currency: "NGN" }, pin, "USD")).toEqual({ ok: false, reason: "amount-short" });
    expect(resolveCredit({ amount: 750_000, currency: "NGN" }, { ...pin, ai_topup_cents: 5_000 }, "USD")).toEqual({ ok: false, reason: "amount-short" });
    expect(resolveCredit({ amount: 750_000, currency: "NGN" }, null, "USD")).toEqual({ ok: false, reason: "no-pin" });
    expect(resolveCredit({ amount: 750_000, currency: "GHS" }, pin, "USD")).toEqual({ ok: false, reason: "currency-mismatch" });
    expect(resolveCredit({ amount: 750_000, currency: "NGN" }, { ...pin, wallet_currency: "GHS" }, "USD")).toEqual({ ok: false, reason: "currency-mismatch" });
    expect(resolveCredit({ amount: 0, currency: "NGN" }, pin, "USD")).toEqual({ ok: false, reason: "amount-short" });
    // a naira wallet must never credit a pinned dollar figure
    expect(resolveCredit({ amount: 750_000, currency: "USD" }, { ...pin, wallet_currency: "NGN", charged_currency: "USD" }, "NGN")).toEqual({ ok: false, reason: "currency-mismatch" });
  });
});
