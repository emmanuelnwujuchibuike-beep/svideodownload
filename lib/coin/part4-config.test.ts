import { describe, expect, it } from "vitest";

import { fundingSource } from "@/lib/admin/funding-alerts";
import { flutterwaveCheckoutGate, flutterwaveCollectionGate, resolveFlutterwaveConfig } from "@/lib/flutterwave/config";
import { aggregateCollected } from "@/lib/monetization/collected-revenue";
import { flutterwaveReferencePurpose, newFlutterwaveReference } from "@/lib/payments/references";

import { COIN_DEFAULTS, depositRulesForDb, normalizeCoinConfig } from "./config";

/**
 * Frenz Coin Part 4: the deposit settings, the deposit reference, the rail gate, and the two readers that must never
 * count a coin deposit as AI money.
 */
describe("deposit settings", () => {
  it("ship off, with the 1-hour hold (0284, owner 2026-10-25)", () => {
    expect(COIN_DEFAULTS.deposits).toEqual({ enabled: false, holdHours: 1, minCents: 100, maxCents: 500_000 });
    expect(depositRulesForDb(COIN_DEFAULTS)).toMatchObject({ enabled: false, holdHours: 1 });
  });
  it("the hold is the admin's: 0 to 2160 hours (0284), a junk value falls back to the 1-hour default", () => {
    expect(normalizeCoinConfig({ deposits: { holdHours: 0 } }).deposits.holdHours).toBe(0);
    expect(normalizeCoinConfig({ deposits: { holdHours: 1 } }).deposits.holdHours).toBe(1);
    expect(normalizeCoinConfig({ deposits: { holdHours: 24 } }).deposits.holdHours).toBe(24);
    expect(normalizeCoinConfig({ deposits: { holdHours: -5 } }).deposits.holdHours).toBe(0);
    expect(normalizeCoinConfig({ deposits: { holdHours: 99_999 } }).deposits.holdHours).toBe(2_160);
    expect(normalizeCoinConfig({ deposits: { holdHours: "0" } }).deposits.holdHours).toBe(1);
  });
  it("the deposit switch reaches the database only with the master switch", () => {
    const depOnly = { ...COIN_DEFAULTS, deposits: { ...COIN_DEFAULTS.deposits, enabled: true } };
    expect(depositRulesForDb(depOnly).enabled).toBe(false);
    expect(depositRulesForDb({ ...depOnly, enabled: true, version: 9 })).toMatchObject({ enabled: true, version: 9 });
  });
});

describe("the coin deposit reference", () => {
  it("is its own purpose, never an AI top-up's, and fits Flutterwave's 54-character limit", () => {
    const r = newFlutterwaveReference("coin_deposit");
    expect(r).toMatch(/^frenz_coin_dep_fw_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(r.length).toBeLessThanOrEqual(54);
    expect(flutterwaveReferencePurpose(r)).toBe("coin_deposit");
    expect(flutterwaveReferencePurpose(newFlutterwaveReference("wallet_topup"))).toBe("wallet_topup");
    expect(flutterwaveReferencePurpose("frenz_coin_dep_fw_not-a-uuid")).toBeNull();
  });
});

describe("the Flutterwave rail gate", () => {
  const cfg = (env: Record<string, string>) => resolveFlutterwaveConfig({ FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-k", FLUTTERWAVE_SECRET_HASH: "h", ...env }, null);
  it("the collection gate is the checkout gate without the purpose list (coins switch on in frenzCoin instead)", () => {
    expect(flutterwaveCollectionGate("USD", cfg({}))).toEqual({ ok: true });
    expect(flutterwaveCollectionGate("USD", cfg({ FLUTTERWAVE_ENABLED_PURPOSES: "none" }))).toEqual({ ok: true });
    expect(flutterwaveCheckoutGate("wallet_topup", "USD", cfg({ FLUTTERWAVE_ENABLED_PURPOSES: "none" }))).toEqual({ ok: false, reason: "purpose_disabled" });
    expect(flutterwaveCollectionGate("USD", resolveFlutterwaveConfig({}, null))).toEqual({ ok: false, reason: "not_configured" });
    expect(flutterwaveCollectionGate("USD", cfg({ FLUTTERWAVE_AMOUNT_UNIT: "unconfirmed" }))).toEqual({ ok: false, reason: "amount_unit_unconfirmed" });
  });
  it("the checkout gate answers as before: the purpose is checked before the currency", () => {
    const c = cfg({ FLUTTERWAVE_ENABLED_PURPOSES: "wallet_topup", FLUTTERWAVE_VERIFIED_CURRENCIES: "USD" });
    expect(flutterwaveCheckoutGate("ad_campaign", "EUR", c)).toEqual({ ok: false, reason: "purpose_disabled" });
    expect(flutterwaveCheckoutGate("wallet_topup", "EUR", c)).toEqual({ ok: false, reason: "currency_not_verified" });
    expect(flutterwaveCheckoutGate("wallet_topup", "USD", c)).toEqual({ ok: true });
  });
});

describe("a coin deposit is not AI money", () => {
  it("collected revenue leaves coin deposits out (they are owed back to members)", () => {
    const now = Date.parse("2026-10-25T12:00:00Z");
    const c = aggregateCollected(
      [
        { amount_cents: 1_000, currency: "USD", purpose: "wallet_topup", created_at: "2026-10-25T10:00:00Z" },
        { amount_cents: 50_000, currency: "USD", purpose: "coin_deposit", created_at: "2026-10-25T10:00:00Z" },
      ],
      now,
    );
    expect(c.currencies.USD!.all).toMatchObject({ total: 1_000, payments: 1 });
  });
  it("the admin payment alert names it a Frenz Coin deposit, not AI credit funding", () => {
    expect(fundingSource("coin_deposit")).toBe("Frenz Coin deposit");
    expect(fundingSource("wallet_topup")).toBe("AI credit funding");
  });
});
