import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeAiWalletConfig, transferFeeFor } from "@/lib/ai/credits/wallet-config";
import { normalizeRewardsConfig, splitWithdrawalUsdCents } from "@/lib/rewards/config";

/**
 * 0202 (owner, 2026-10-09): "deposited credits can be sent to others and withdrawn
 * but with a certain charge and rate different from others."
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const FEES = { feePercent: 5, depositedFeePercent: 10 };

describe("the transfer fee", () => {
  it("tokens and earned credits pay the normal fee", () => {
    expect(transferFeeFor(100, "usable", { withdrawable: 0, deposited: 0 }, FEES)).toBe(5);
    expect(transferFeeFor(100, "withdrawable", { withdrawable: 500, deposited: 0 }, FEES)).toBe(5);
    expect(transferFeeFor(100, "withdrawable", { withdrawable: 500, deposited: 100 }, FEES)).toBe(5); // 400 earned cover it
  });
  it("the part beyond the earned credits pays the deposited fee", () => {
    expect(transferFeeFor(100, "withdrawable", { withdrawable: 100, deposited: 100 }, FEES)).toBe(10); // all deposited
    // 50 earned: 50 at 5% (3) + 50 at 10% (5) = 8
    expect(transferFeeFor(100, "withdrawable", { withdrawable: 200, deposited: 150 }, FEES)).toBe(8);
  });
  it("defaults: deposited fee 10 %, clamped to 0–50", () => {
    expect(normalizeAiWalletConfig(null).transfers.depositedFeePercent).toBe(10);
    expect(normalizeAiWalletConfig({ transfers: { depositedFeePercent: 90 } }).transfers.depositedFeePercent).toBe(50);
  });
});

describe("the withdrawal payout", () => {
  const w = { ...normalizeRewardsConfig(null).withdrawals, creditsPerUsd: 10, deposited: { creditsPerUsd: 10, feePercent: 10 } };
  it("earned credits go first and pay at the normal rate", () => {
    expect(splitWithdrawalUsdCents(100, 300, 100, w)).toEqual({ usdCents: 1000, depositedPart: 0 });
  });
  it("the deposited part pays its own rate less its own fee", () => {
    // 50 earned → $5.00, 50 deposited → $5.00 less 10% = $4.50
    expect(splitWithdrawalUsdCents(100, 100, 50, w)).toEqual({ usdCents: 950, depositedPart: 50 });
  });
  it("defaults survive a saved config without the new block", () => {
    expect(normalizeRewardsConfig({ withdrawals: { enabled: true } }).withdrawals.deposited).toEqual({ creditsPerUsd: 10, feePercent: 10 });
  });
});

describe("0202", () => {
  const m = code("supabase/migrations/0202_deposited_credits.sql");
  /** The rule as a function of the migration, so the teeth can run it on a broken copy. */
  const holds = (s: string) =>
    s.includes("v_dep := case when p_kind = 'recharge' and p_currency = 'CREDIT' then p_amount else 0 end;") &&
    s.includes("deposited_cents = deposited_cents + v_dep_in,") &&
    s.includes("check (deposited_cents >= 0 and deposited_cents <= withdrawable_cents)") &&
    s.includes("new.deposited_cents := least(greatest(coalesce(new.deposited_cents, 0), 0), greatest(new.withdrawable_cents, 0));");
  it("a paid deposit lands as credits (deposited); a credits transfer keeps the deposited share; debits keep it in range", () => {
    expect(holds(m)).toBe(true);
  });
  it("teeth: a copy that drops the deposit or the carry fails", () => {
    expect(holds(m.replace("then p_amount else 0 end;", "then 0 else 0 end;"))).toBe(false);
    expect(holds(m.replace("deposited_cents = deposited_cents + v_dep_in,", ""))).toBe(false);
  });
  it("the server prices both with the same functions the sheet uses", () => {
    expect(code("lib/ai/wallet/transfers.ts")).toContain('const fee = transferFeeFor(amount, input.kind,');
    expect(code("lib/rewards/withdrawals.ts")).toContain("splitWithdrawalUsdCents(credits,");
    expect(code("features/ai/wallet/transfer-panel.tsx")).toContain("transferFeeFor(");
  });
});
