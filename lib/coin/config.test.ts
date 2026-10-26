import { describe, expect, it } from "vitest";

import { COIN_DEFAULTS, coinTransferFee, coinWithdrawalFee, normalizeCoinConfig, percentOfCeil, transferRulesForDb, versionCoinConfig, withdrawalRulesForDb } from "./config";

/**
 * Frenz Coin Part 3: the confirmed fee schedule, in integer cents. The SAME cases run against the database's own formula
 * (0279 coin_transfer_fee) in supabase/tests/0279_frenz_coin.pglite.mjs — this file is the app's preview twin.
 */
const t = COIN_DEFAULTS.transfers;

describe("transfer fee: 10% (rounded UP to the cent) + the bracket's flat fee, paid by the sender on top", () => {
  it.each([
    // [amount¢, percent¢, flat¢, bracket]
    [1, 1, 100, "below"],
    [99, 10, 100, "below"],
    [5_000, 500, 100, "below"],
    [9_999, 1_000, 100, "below"],
    [10_000, 1_000, 0, "mid"],
    [10_001, 1_001, 0, "mid"],
    [25_000, 2_500, 0, "mid"],
    [49_999, 5_000, 0, "mid"],
    [50_000, 5_000, 0, "mid"],
    [50_001, 5_001, 500, "above"],
    [60_000, 6_000, 500, "above"],
  ] as const)("%i¢ → %i¢ + %i¢ (%s)", (amount, pct, flat, bracket) => {
    expect(coinTransferFee(amount, t)).toEqual({ percentCents: pct, flatCents: flat, feeCents: pct + flat, totalDebitCents: amount + pct + flat, bracket });
  });
  it("the owner's worked examples: $50 → $56, $250 → $275, $600 → $665", () => {
    expect(coinTransferFee(5_000, t).totalDebitCents).toBe(5_600);
    expect(coinTransferFee(25_000, t).totalDebitCents).toBe(27_500);
    expect(coinTransferFee(60_000, t).totalDebitCents).toBe(66_500);
  });
  it("$100 and $500 are both in the middle bracket (no flat fee)", () => {
    expect(coinTransferFee(10_000, t).bracket).toBe("mid");
    expect(coinTransferFee(50_000, t).bracket).toBe("mid");
  });
  it("integers only — no floating point near a large amount", () => {
    expect(percentOfCeil(99_999_999, 1_000)).toBe(10_000_000);
    expect(percentOfCeil(3, 3_333)).toBe(1);
    expect(percentOfCeil(0, 1_000)).toBe(0);
    expect(percentOfCeil(1.5, 1_000)).toBe(0);
  });
});

describe("withdrawal fee: its own setting (6%, no flat fee), taken FROM the amount", () => {
  it("$100 → $6 fee, $94 paid out; 6% of $10.01 rounds up to 61¢", () => {
    expect(coinWithdrawalFee(10_000, COIN_DEFAULTS.withdrawals)).toEqual({ grossCents: 10_000, percentCents: 600, flatCents: 0, feeCents: 600, netCents: 9_400 });
    expect(coinWithdrawalFee(1_001, COIN_DEFAULTS.withdrawals).percentCents).toBe(61);
  });
  it("a configured flat fee is added, never the AI-credit / SUB 0258 tiers", () => {
    expect(coinWithdrawalFee(1_001, { percentBp: 600, flatCents: 50 })).toMatchObject({ feeCents: 111, netCents: 890 });
  });
});

describe("configuration", () => {
  it("ships OFF, in USD cents, with the confirmed schedule and the middle flat fee at zero", () => {
    const c = normalizeCoinConfig(null);
    expect(c.enabled).toBe(false);
    expect(c.currency).toBe("USD");
    expect(c.transfers).toMatchObject({ percentBp: 1_000, lowThresholdCents: 10_000, highThresholdCents: 50_000, flatBelowCents: 100, flatMidCents: 0, flatAboveCents: 500 });
    expect(c.withdrawals).toMatchObject({ percentBp: 600, flatCents: 0, payoutMinorPerUsd: null });
  });
  it("clamps out-of-bounds values the database would refuse, and keeps thresholds ordered", () => {
    const c = normalizeCoinConfig({ transfers: { percentBp: 99_999, lowThresholdCents: 60_000, highThresholdCents: 10_000, minCents: 0 }, withdrawals: { payoutMinorPerUsd: 1.5 } });
    expect(c.transfers.percentBp).toBe(5_000);
    expect(c.transfers.highThresholdCents).toBeGreaterThanOrEqual(c.transfers.lowThresholdCents);
    expect(c.transfers.minCents).toBe(1);
    expect(c.withdrawals.payoutMinorPerUsd).toBeNull();
  });
  it("the version bumps when a money rule changes, not otherwise", () => {
    const a = normalizeCoinConfig(null);
    expect(versionCoinConfig(a, a).version).toBe(a.version);
    expect(versionCoinConfig(a, normalizeCoinConfig({ transfers: { flatMidCents: 25 } })).version).toBe(a.version + 1);
  });
  it("the rules handed to the database carry the version and are off unless the master switch is on", () => {
    expect(transferRulesForDb(COIN_DEFAULTS)).toMatchObject({ enabled: false, version: 1, percentBp: 1_000 });
    expect(withdrawalRulesForDb({ ...COIN_DEFAULTS, enabled: true })).toMatchObject({ enabled: true, percentBp: 600 });
  });
});
