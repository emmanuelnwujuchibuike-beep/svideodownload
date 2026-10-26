import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VerifiedCharge } from "@/lib/payments/charge";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin Part 4 — lib/coin/deposits.ts over an in-memory database. Flutterwave is scripted (no network, no real
 * checkout); the SQL functions are scripted at their documented answers (their rules are proven against real
 * PostgreSQL in supabase/tests/0280_coin_deposits.pglite.mjs and coin_deposits_concurrency.pg.mjs).
 */
let db: FakeDb;
let checkout: (input: Record<string, unknown>) => Promise<string>;
let byReference: (ref: string) => Promise<VerifiedCharge>;
const checkouts: Record<string, unknown>[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/flutterwave/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/flutterwave/client")>()),
  createFlutterwaveCheckout: async (input: Record<string, unknown>) => (checkouts.push(input), checkout(input)),
  verifyFlutterwaveByReference: async (ref: string) => byReference(ref),
  // Flutterwave's live rate (2026-10-26): GH₵12.21 per dollar
  readFlutterwaveUsdRate: async (cur: string) => (cur === "GHS" ? 1221 : null),
}));
vi.mock("@/lib/landing/settings", () => ({ getLandingSettings: async () => ({ frenzAiCharacterReplace: { recharge: { checkoutCurrency: "NGN" } } }) }));
process.env.FLUTTERWAVE_SECRET_HASH = "the-secret-hash";
process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK_TEST-k";

const { COIN_DEFAULTS } = await import("./config");
const dep = await import("./deposits");
const { FlutterwaveHttpError } = await import("@/lib/flutterwave/client");

const USER = "11111111-1111-4111-8111-111111111111";
const on = { ...COIN_DEFAULTS, enabled: true, version: 7, deposits: { ...COIN_DEFAULTS.deposits, enabled: true } };
const begin = (over: Partial<Parameters<typeof dep.beginCoinDeposit>[0]> = {}) => dep.beginCoinDeposit({ userId: USER, email: "a@b.test", amountCents: 5_000, idempotencyKey: "dep_0123456789", config: on, ...over });
const REF = "frenz_coin_dep_fw_2b1c8f8e-1111-4111-8111-111111111111";
const charge = (over: Partial<VerifiedCharge> = {}): VerifiedCharge => ({ provider: "flutterwave", reference: REF, externalId: "77", status: "success", amountMinor: 5_000, currency: "USD", channel: "card", paidAt: null, reason: "Approved", ...over });
const attempt = (over: Record<string, unknown> = {}) => ({ reference: REF, user_id: USER, provider: "flutterwave", purpose: "coin_deposit", status: "pending", amount_cents: 5_000, provider_amount: 5_000, provider_currency: "USD", checkout_url: "https://checkout.flutterwave.com/c", created_at: new Date(Date.now() - 60_000).toISOString(), updated_at: new Date(Date.now() - 10 * 60_000).toISOString(), ...over });

beforeEach(() => {
  db = fakeDb({ ai_topup_attempts: [], financial_audit_log: [], coin_deposit_reversals: [] });
  checkouts.length = 0;
  checkout = async () => "https://checkout.flutterwave.com/new";
  byReference = async () => charge();
  db.rpc.begin_coin_deposit = vi.fn((a: Record<string, unknown>) => {
    // an id per row: the fake's update finds rows by id
    db.tables.ai_topup_attempts!.push(attempt({ id: a.p_reference, reference: a.p_reference, checkout_url: null }));
    return { data: { ok: true, reference: a.p_reference, hold_hours: 72 }, error: null };
  });
  db.rpc.settle_coin_deposit = vi.fn(() => ({ data: { ok: true, amount: 5_000, release_at: "2026-10-28T12:00:00Z" }, error: null }));
  db.rpc.release_due_coin_deposits = vi.fn(() => ({ data: { ok: true, released: 0, cents: 0 }, error: null }));
  db.rpc.reverse_coin_deposit = vi.fn(() => ({ data: { ok: true, id: "r1", state: "recovered", phase: "held", due: 5_000, recovered: 5_000, shortfall: 0 }, error: null }));
  db.rpc.credit_product_balance = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

/*
  Owner, 2026-10-26: "It should also take effect for the Frenz coin deposit". A member in Ghana deposits in cedis — the
  coins credited stay the dollar amount asked for; the row pins exactly what Flutterwave must collect.
*/
describe("beginCoinDeposit — the member's own currency", () => {
  it("Ghana: a cedi checkout for the dollar amount at Flutterwave's rate; the coins are still $50.00", async () => {
    const out = await begin({ market: "other", country: "GH" });
    expect(out).toMatchObject({ ok: true, amountCents: 5_000 });
    const args = (db.rpc.begin_coin_deposit as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(args).toMatchObject({ p_amount_cents: 5_000, p_provider_amount: 61_050, p_provider_currency: "GHS" });
    expect(checkouts[0]).toMatchObject({ amountMinor: 61_050, currency: "GHS" });
  });
  it("a deposit paid in cedis settles only on exactly that cedi amount", async () => {
    db.tables.ai_topup_attempts = [attempt({ id: REF, provider_amount: 61_050, provider_currency: "GHS" })];
    byReference = async () => charge({ amountMinor: 61_050, currency: "GHS", channel: "mobilemoneygh" });
    await dep.settleCoinDeposit(REF);
    expect(db.rpc.settle_coin_deposit).toHaveBeenCalledWith(expect.objectContaining({ p_paid_minor: 61_050, p_paid_currency: "GHS" }));
  });
  it("anywhere without a local currency here: dollars, exactly as before", async () => {
    await begin({ market: "other", country: "US" });
    expect(checkouts[0]).toMatchObject({ amountMinor: 5_000, currency: "USD" });
  });
});

describe("beginCoinDeposit", () => {
  it("records the attempt with the server's rules BEFORE the checkout, then opens a USD checkout for exactly the amount", async () => {
    const out = await begin();
    expect(out).toMatchObject({ ok: true, url: "https://checkout.flutterwave.com/new", amountCents: 5_000, holdHours: 72, reused: false });
    const args = (db.rpc.begin_coin_deposit as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(args).toMatchObject({ p_user: USER, p_amount_cents: 5_000, p_provider: "flutterwave", p_provider_amount: 5_000, p_provider_currency: "USD", p_idempotency: "dep_0123456789" });
    expect(args.p_rules).toMatchObject({ enabled: true, version: 7, holdHours: 1, minCents: 100, maxCents: 500_000 });
    expect(String(args.p_reference)).toMatch(/^frenz_coin_dep_fw_[0-9a-f-]{36}$/);
    expect(checkouts[0]).toMatchObject({ reference: args.p_reference, amountMinor: 5_000, currency: "USD" });
    expect(db.tables.ai_topup_attempts![0]!.checkout_url).toBe("https://checkout.flutterwave.com/new");
  });
  it.each([
    ["the master switch off", { config: { ...on, enabled: false } }, "disabled"],
    ["deposits off", { config: { ...on, deposits: { ...on.deposits, enabled: false } } }, "disabled"],
    ["below the minimum", { amountCents: 99 }, "amount_out_of_range"],
    ["above the maximum", { amountCents: 500_001 }, "amount_out_of_range"],
    ["a fraction of a cent", { amountCents: 50.5 }, "invalid"],
    ["a string amount", { amountCents: "5000" }, "invalid"],
    ["a bad key", { idempotencyKey: "x" }, "invalid"],
  ])("refused before anything is written: %s", async (_why, over, reason) => {
    expect(await begin(over as never)).toMatchObject({ ok: false, reason });
    expect(db.rpc.begin_coin_deposit).not.toHaveBeenCalled();
    expect(checkouts).toHaveLength(0);
  });
  it("Flutterwave not configured: no attempt, no checkout", async () => {
    const key = process.env.FLUTTERWAVE_SECRET_KEY;
    delete process.env.FLUTTERWAVE_SECRET_KEY;
    try {
      expect(await begin()).toMatchObject({ ok: false, reason: "rail_unavailable" });
    } finally {
      process.env.FLUTTERWAVE_SECRET_KEY = key;
    }
    expect(db.rpc.begin_coin_deposit).not.toHaveBeenCalled();
  });
  it("the database's refusal stops the checkout (suspended, rules, a replayed key for another amount)", async () => {
    for (const reason of ["suspended", "rules_invalid", "idempotency_conflict", "disabled"]) {
      db.rpc.begin_coin_deposit = vi.fn(() => ({ data: { ok: false, reason }, error: null }));
      expect(await begin()).toMatchObject({ ok: false, reason });
    }
    expect(checkouts).toHaveLength(0);
  });
  it("a replayed key or a checkout still open hands back its link — never a second checkout", async () => {
    db.rpc.begin_coin_deposit = vi.fn(() => ({ data: { ok: false, reason: "open", reference: REF, status: "pending", checkout_url: "https://checkout.flutterwave.com/c" }, error: null }));
    expect(await begin()).toMatchObject({ ok: true, url: "https://checkout.flutterwave.com/c", reference: REF, reused: true });
    db.rpc.begin_coin_deposit = vi.fn(() => ({ data: { ok: false, reason: "existing", reference: REF, status: "verification_required", checkout_url: null }, error: null }));
    expect(await begin()).toMatchObject({ ok: false, status: 409, reason: "in_progress" });
    expect(checkouts).toHaveLength(0);
  });
  it("0280 not applied: 'not available', and no checkout", async () => {
    db.rpc.begin_coin_deposit = vi.fn(() => ({ data: null, error: { message: "Could not find the function public.begin_coin_deposit in the schema cache" } }));
    expect(await begin()).toMatchObject({ ok: false, status: 503, reason: "not_available" });
    expect(checkouts).toHaveLength(0);
  });
  it("Flutterwave refuses the checkout: the attempt is closed; an unknown outcome is held for verification", async () => {
    checkout = async () => {
      throw new FlutterwaveHttpError("bad", 400);
    };
    expect(await begin()).toMatchObject({ ok: false, reason: "checkout_refused" });
    expect(db.tables.ai_topup_attempts![0]!.status).toBe("failed");
    checkout = async () => {
      throw new Error("socket hang up");
    };
    expect(await begin({ idempotencyKey: "dep_another_1" })).toMatchObject({ ok: false, reason: "checkout_unknown" });
    expect(db.tables.ai_topup_attempts![1]!.status).toBe("verification_required");
  });
});

describe("settleCoinDeposit (return page, sweep)", () => {
  beforeEach(() => {
    db.tables.ai_topup_attempts = [attempt()];
  });
  it("asks Flutterwave about OUR reference and settles the exact payment into the coin wallet only", async () => {
    expect(await dep.settleCoinDeposit(REF, { userId: USER })).toEqual({ kind: "credited", amountCents: 5_000, releaseAt: "2026-10-28T12:00:00Z", duplicate: false });
    expect(db.rpc.settle_coin_deposit).toHaveBeenCalledWith({ p_reference: REF, p_charge_id: "77", p_paid_minor: 5_000, p_paid_currency: "USD" });
    expect(db.rpc.credit_product_balance).not.toHaveBeenCalled();
  });
  it("another member's reference is not theirs to settle", async () => {
    expect(await dep.settleCoinDeposit(REF, { userId: "22222222-2222-4222-8222-222222222222" })).toEqual({ kind: "not_ours" });
    expect(db.rpc.settle_coin_deposit).not.toHaveBeenCalled();
  });
  it("an AI top-up or a made-up reference is not a coin deposit", async () => {
    expect(await dep.settleCoinDeposit("frenz_cr_topup_fw_2b1c8f8e-1111-4111-8111-111111111111")).toEqual({ kind: "unknown" });
    expect(await dep.settleCoinDeposit("frenz_coin_dep_fw_nope")).toEqual({ kind: "unknown" });
    db.tables.ai_topup_attempts = [attempt({ purpose: "wallet_topup" })];
    expect(await dep.settleCoinDeposit(REF)).toEqual({ kind: "unknown" });
  });
  it("a mismatched charge credits nothing and is held for a person", async () => {
    byReference = async () => charge({ amountMinor: 4_000 });
    expect(await dep.settleCoinDeposit(REF)).toEqual({ kind: "mismatch" });
    expect(db.rpc.settle_coin_deposit).not.toHaveBeenCalled();
    expect(db.tables.ai_topup_attempts![0]!.status).toBe("mismatch");
  });
  it("pending stays open; failed closes; abandoned closes only after 30 minutes", async () => {
    byReference = async () => charge({ status: "pending" });
    expect(await dep.settleCoinDeposit(REF)).toEqual({ kind: "pending" });
    byReference = async () => charge({ status: "abandoned" });
    expect(await dep.settleCoinDeposit(REF)).toEqual({ kind: "pending" });
    db.tables.ai_topup_attempts = [attempt({ created_at: new Date(Date.now() - 31 * 60_000).toISOString() })];
    expect(await dep.settleCoinDeposit(REF)).toEqual({ kind: "failed" });
    expect(db.tables.ai_topup_attempts![0]!.status).toBe("abandoned");
    expect(db.rpc.settle_coin_deposit).not.toHaveBeenCalled();
  });
  it("a settled deposit the provider no longer calls paid is logged for review — nothing is taken back by code", async () => {
    db.tables.ai_topup_attempts = [attempt({ status: "success" })];
    byReference = async () => charge({ status: "failed" });
    expect(await dep.settleCoinDeposit(REF)).toEqual({ kind: "review" });
    expect(db.tables.financial_audit_log!.some((r) => r.action === "coin_deposit_provider_status_review")).toBe(true);
    expect(db.rpc.reverse_coin_deposit).not.toHaveBeenCalled();
  });
  it("Flutterwave unreachable: it throws (the caller retries), nothing is settled", async () => {
    byReference = async () => {
      throw new Error("timeout");
    };
    await expect(dep.settleCoinDeposit(REF)).rejects.toThrow();
    expect(db.rpc.settle_coin_deposit).not.toHaveBeenCalled();
  });
});

describe("reconcileCoinDeposits (the cron)", () => {
  it("settles an open attempt nobody came back for, then releases what is due", async () => {
    db.tables.ai_topup_attempts = [attempt()];
    db.rpc.release_due_coin_deposits = vi.fn(() => ({ data: { ok: true, released: 2, cents: 9_000 }, error: null }));
    const out = await dep.reconcileCoinDeposits();
    expect(out).toMatchObject({ examined: 1, settled: 1, released: 2 });
    expect(db.rpc.release_due_coin_deposits).toHaveBeenCalledWith({ p_user: null, p_limit: 200 });
  });
  it("an attempt another worker holds (its lease is ahead) is skipped", async () => {
    db.tables.ai_topup_attempts = [attempt({ updated_at: new Date(Date.now() + 60_000).toISOString() })];
    expect(await dep.reconcileCoinDeposits()).toMatchObject({ examined: 0, settled: 0 });
    expect(db.rpc.settle_coin_deposit).not.toHaveBeenCalled();
  });
});

describe("recordAdminCoinDepositReversal", () => {
  const record = (over: Partial<Parameters<typeof dep.recordAdminCoinDepositReversal>[0]> = {}) => dep.recordAdminCoinDepositReversal({ reference: REF, kind: "refund", refundedMinor: null, idempotencyKey: "rev_0123456789", adminId: "admin-1", note: "refunded in dashboard", ...over });
  it("re-verifies the original charge, then records it once under the admin's replay key", async () => {
    expect(await record()).toMatchObject({ ok: true, id: "r1", recovered: 5_000, shortfall: 0 });
    expect(db.rpc.reverse_coin_deposit).toHaveBeenCalledWith(expect.objectContaining({ p_provider: "flutterwave", p_event_key: "admin:rev_0123456789", p_kind: "refund", p_reference: REF, p_paid_minor: 5_000, p_paid_currency: "USD", p_actor: "admin-1" }));
  });
  it("Flutterwave does not show it as paid: nothing is taken back", async () => {
    byReference = async () => charge({ status: "failed" });
    expect(await record()).toEqual({ ok: false, reason: "not_paid" });
    expect(db.rpc.reverse_coin_deposit).not.toHaveBeenCalled();
  });
  it("a refund larger than the charge, or not a coin deposit reference, is refused", async () => {
    expect(await record({ refundedMinor: 6_000 })).toEqual({ ok: false, reason: "invalid" });
    expect(await record({ reference: "frenz_cr_topup_fw_2b1c8f8e-1111-4111-8111-111111111111" })).toEqual({ ok: false, reason: "invalid" });
    expect(db.rpc.reverse_coin_deposit).not.toHaveBeenCalled();
  });
});
