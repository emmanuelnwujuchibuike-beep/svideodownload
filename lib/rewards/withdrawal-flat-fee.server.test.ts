import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Owner, 2026-10-17: "add an additional flat $0.2 fee for every withdraw, balance must cover before withdraw
 * can be made … flat fee covers below $300, above flat fee is 0.5, above 500 is flat of $1" — for private-post
 * money AND AI credits, ON TOP of the amount, adjustable by the admin. The SQL side (0258) is proven in
 * supabase/tests/sub_financial_invariants.pglite.mjs §29 and the journey; this is the server code above it.
 */

let db: FakeDb;
vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/landing/settings", async () => {
  const { SUB_DEFAULTS } = await import("@/lib/rewards/config");
  return { getLandingSettings: async () => ({ frenzRewards: { sub: { ...SUB_DEFAULTS, autoPayout: false } } }) };
});
vi.mock("@/lib/rewards/paystack-banks", async (orig) => ({ ...(await orig<typeof import("@/lib/rewards/paystack-banks")>()), resolveAccount: async () => "ADA OBI" }));

const cfg = await import("./config");
const { requestSubWithdrawal } = await import("@/lib/sub/server");
const { requestWithdrawal } = await import("./withdrawals");

const U = "00000000-0000-4000-8000-000000000001";
const details = { bankCode: "058", bankName: "Guaranty Trust Bank", accountNumber: "0123456789" };

beforeEach(() => {
  db = fakeDb({ profiles: [{ id: U, is_suspended: false }], withdrawal_requests: [], ai_product_balances: [{ user_id: U, product: "character_replace", withdrawable_cents: 100_000, deposited_cents: 0 }] });
  db.rpc.request_sub_withdrawal = vi.fn(() => ({ data: { ok: true, id: "w1", net: 1, fee: 1 }, error: null }));
  db.rpc.request_withdrawal = vi.fn(() => ({ data: { ok: true, id: "w2" }, error: null }));
});

describe("the tiers (defaults $0.20 below $300, $0.50 from $300 to $500, $1.00 above)", () => {
  const f = cfg.FLAT_FEE_DEFAULTS;
  it.each([
    [500, 20],
    [29_999, 20],
    [30_000, 50],
    [50_000, 50],
    [50_001, 100],
    [1_000_000, 100],
  ])("%i cents → %i cents", (amount, fee) => expect(cfg.withdrawalFlatFeeCents(amount, f)).toBe(fee));

  it("the admin's values are kept, clamped, and the second limit is never below the first", () => {
    expect(cfg.normalizeFlatFees({ underCents: 30, midCents: 75, overCents: 150, midFromCents: 20_000, overAboveCents: 40_000 })).toEqual({ underCents: 30, midCents: 75, overCents: 150, midFromCents: 20_000, overAboveCents: 40_000 });
    expect(cfg.normalizeFlatFees({ underCents: -5, midFromCents: 60_000, overAboveCents: 10 })).toMatchObject({ underCents: 0, midFromCents: 60_000, overAboveCents: 60_000 });
    expect(cfg.normalizeFlatFees(null)).toEqual(cfg.FLAT_FEE_DEFAULTS);
  });

  it("an admin save of the SUB settings keeps them (the whole rewards config round-trips)", () => {
    const saved = cfg.normalizeRewardsConfig({ sub: { flatFees: { underCents: 25, midCents: 60, overCents: 120, midFromCents: 30_000, overAboveCents: 50_000 } } });
    expect(saved.sub.flatFees).toMatchObject({ underCents: 25, midCents: 60, overCents: 120 });
    expect(cfg.normalizeRewardsConfig(null).sub.flatFees).toEqual(cfg.FLAT_FEE_DEFAULTS);
  });

  it("the AI withdraw form is told the tiers (public config)", () => {
    const pub = cfg.publicRewardsConfig({ ...cfg.normalizeRewardsConfig(null), withdrawals: { ...cfg.normalizeRewardsConfig(null).withdrawals, enabled: true } });
    expect(pub.withdrawals?.flatFees).toEqual(cfg.FLAT_FEE_DEFAULTS);
  });
});

describe("private-post withdrawals pass the right flat fee to the database", () => {
  it.each([
    [1_000, 20],
    [30_000, 50],
    [60_000, 100],
  ])("withdrawing %i cents sends p_flat_fee_cents %i", async (amount, fee) => {
    const out = await requestSubWithdrawal({ userId: U, grossCents: amount, details, idempotencyKey: `k-flat-${amount}` });
    expect(out.ok).toBe(true);
    expect(db.rpc.request_sub_withdrawal).toHaveBeenCalledWith(expect.objectContaining({ p_gross_cents: amount, p_flat_fee_cents: fee }));
  });

  it("before 0258 runs (no such argument), the withdrawal still goes through without the flat fee — never broken", async () => {
    db.rpc.request_sub_withdrawal = vi.fn((a: Record<string, unknown>) =>
      "p_flat_fee_cents" in a ? { data: null, error: { message: "Could not find the function public.request_sub_withdrawal(p_details, p_fee_bp, p_flat_fee_cents, …) in the schema cache" } } : { data: { ok: true, id: "w1", net: 1, fee: 1 }, error: null },
    );
    const out = await requestSubWithdrawal({ userId: U, grossCents: 1_000, details, idempotencyKey: "k-legacy-1" });
    expect(out.ok).toBe(true);
    expect(db.rpc.request_sub_withdrawal).toHaveBeenCalledTimes(2);
  });

  it("'insufficient' names the fee (the balance must cover the amount and the fee)", async () => {
    db.rpc.request_sub_withdrawal = vi.fn(() => ({ data: { ok: false, reason: "insufficient" }, error: null }));
    const out = await requestSubWithdrawal({ userId: U, grossCents: 1_000, details, idempotencyKey: "k-insuff-1" });
    expect(out).toMatchObject({ ok: false, status: 409 });
    expect(out.ok ? "" : out.error).toMatch(/\$0\.20 withdrawal fee/);
  });
});

describe("AI-credit withdrawals reserve the flat fee in credits, on top", () => {
  const config = () => {
    const c = cfg.normalizeRewardsConfig(null);
    return { ...c, enabled: true, withdrawals: { ...c.withdrawals, enabled: true, creditsPerUsd: 10, minCredits: 100, maxCredits: 100_000, maxRequestsPerDay: 5, maxCreditsPerMonth: 1_000_000, methods: ["paystack"] } };
  };

  it.each([
    [1_000, 2], // $100 → $0.20 → 2 credits
    [3_000, 5], // $300 → $0.50 → 5 credits
    [6_000, 10], // $600 → $1.00 → 10 credits
  ])("withdrawing %i credits reserves %i more for the fee; the payout is worth the requested credits only", async (credits, feeCredits) => {
    const out = await requestWithdrawal({ userId: U, credits, method: "paystack", details, config: config() });
    expect(out.ok).toBe(true);
    const args = (db.rpc.request_withdrawal as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(args.p_credits).toBe(credits + feeCredits);
    expect(args.p_usd_cents).toBe(credits * 10); // 10 credits = $1
    expect(args.p_snapshot).toMatchObject({ requestedCredits: credits, flatFeeCredits: feeCredits });
  });

  it("not enough withdrawable credits for the amount AND the fee: refused, saying so", async () => {
    db.rpc.request_withdrawal = vi.fn(() => ({ data: { ok: false, reason: "insufficient_withdrawable" }, error: null }));
    const out = await requestWithdrawal({ userId: U, credits: 1_000, method: "paystack", details, config: config() });
    expect(out).toMatchObject({ ok: false, status: 409 });
    expect(out.ok ? "" : out.error).toMatch(/2-credit withdrawal fee/);
  });
});
