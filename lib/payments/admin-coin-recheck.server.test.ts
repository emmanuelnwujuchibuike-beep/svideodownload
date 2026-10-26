import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VerifiedCharge } from "@/lib/payments/charge";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin Part 4.1 — coin deposits in Admin → Payments: listed under their own purpose, and "Recheck" through the
 * REAL coin path (lib/coin/deposits.ts reconcileCoinDepositAttempt → settleCoinDeposit). Scripted: Flutterwave's verify
 * API (no network) and the SQL settle, modelled as settle_coin_deposit behaves (once per reference, coins pending — its
 * rules are proven in supabase/tests/0280_coin_deposits.pglite.mjs). Pinned: the admin names a reference and nothing
 * else; the attempt row decides the member, amount, currency and provider; a closed attempt is never re-asked; a
 * mismatch or an unsupported provider settles nothing; nothing here releases a hold; every recheck is audited.
 */
let db: FakeDb;
let charge: (ref: string) => Promise<VerifiedCharge>;
const asked: string[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/landing/settings", () => ({ getLandingSettings: async () => ({ frenzAiPlans: { plans: {} } }) }));
vi.mock("@/lib/ai/wallet/reconcile-topups", () => ({ TOPUP_ATTEMPT_COLUMNS: "reference", reconcileTopupAttempt: vi.fn(async () => "settled") }));
vi.mock("@/lib/ai/credits/plan-attempts", () => ({ PLAN_ATTEMPT_COLUMNS: "reference", reconcilePlanAttempt: vi.fn(async () => "pending") }));
vi.mock("@/lib/ads-platform/payment-server", () => ({ reconcileAdAttempt: vi.fn(async () => "checked") }));
vi.mock("@/lib/sub/server", () => ({ confirmSubPayment: vi.fn(async () => ({ ok: false, status: "pending" })) }));
vi.mock("@/lib/social/paid-verification", () => ({ confirmVerificationPayment: vi.fn(async () => "pending") }));
vi.mock("@/lib/flutterwave/client", async (orig) => ({ ...(await orig<typeof import("@/lib/flutterwave/client")>()), verifyFlutterwaveByReference: async (ref: string) => (asked.push(ref), charge(ref)) }));
process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK_TEST-k";
process.env.FLUTTERWAVE_SECRET_HASH = "h";

const { adminRecheckPayment, listAdminTransactions, ADMIN_PAYMENT_PURPOSES } = await import("./admin-transactions");

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER = "11111111-1111-4111-8111-111111111111";
const REF = "frenz_coin_dep_fw_2b1c8f8e-1111-4111-8111-111111111111";
const ok = (over: Partial<VerifiedCharge> = {}): VerifiedCharge => ({ provider: "flutterwave", reference: REF, externalId: "991", status: "success", amountMinor: 5_000, currency: "USD", channel: "card", paidAt: null, reason: "Approved", ...over });
const attempt = (over: Record<string, unknown> = {}) => ({ id: REF, reference: REF, user_id: OWNER, provider: "flutterwave", purpose: "coin_deposit", status: "pending", amount_cents: 5_000, currency: "USD", provider_amount: 5_000, provider_currency: "USD", checkout_url: "https://checkout.flutterwave.com/c", status_reason: null, created_at: new Date(Date.now() - 20 * 60_000).toISOString(), updated_at: new Date(Date.now() - 10 * 60_000).toISOString(), ...over });
const settled = new Set<string>();

beforeEach(() => {
  db = fakeDb({ ai_topup_attempts: [attempt()], financial_audit_log: [], payment_provider_events: [], sub_purchases: [], verification_purchases: [] });
  asked.length = 0;
  settled.clear();
  charge = async () => ok();
  db.rpc.settle_coin_deposit = vi.fn((args: Record<string, unknown>) => {
    const ref = String(args.p_reference);
    if (settled.has(ref)) return { data: { ok: true, duplicate: true, amount: 5_000, release_at: "2026-10-28T12:00:00Z" }, error: null };
    settled.add(ref);
    db.tables.ai_topup_attempts!.find((r) => r.reference === ref)!.status = "success";
    return { data: { ok: true, amount: 5_000, release_at: "2026-10-28T12:00:00Z" }, error: null };
  });
  db.rpc.release_coin_deposit = vi.fn();
  db.rpc.release_due_coin_deposits = vi.fn();
  db.rpc.credit_product_balance = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("the admin payments list", () => {
  it("shows a coin deposit as a Frenz Coin deposit, never 'unknown', and filters by it", async () => {
    expect(ADMIN_PAYMENT_PURPOSES).toContain("coin_deposit");
    const all = await listAdminTransactions({});
    expect(all.rows.find((r) => r.reference === REF)).toMatchObject({ purpose: "coin_deposit", amountMinor: 5_000, currency: "USD", provider: "flutterwave", state: "open" });
    const only = await listAdminTransactions({ purpose: "coin_deposit" });
    expect(only.rows.map((r) => r.reference)).toEqual([REF]);
  });
});

describe("Recheck a coin deposit", () => {
  it("asks Flutterwave about THIS reference and settles it once, into the coin path (on hold — nothing released)", async () => {
    const out = await adminRecheckPayment(REF, ADMIN);
    expect(out).toMatchObject({ ok: true, purpose: "coin_deposit", before: "pending", after: "success", outcome: "settled" });
    expect(asked).toEqual([REF]);
    expect(db.rpc.settle_coin_deposit).toHaveBeenCalledWith({ p_reference: REF, p_charge_id: "991", p_paid_minor: 5_000, p_paid_currency: "USD" });
    expect(db.rpc.release_coin_deposit).not.toHaveBeenCalled();
    expect(db.rpc.release_due_coin_deposits).not.toHaveBeenCalled();
    expect(db.rpc.credit_product_balance).not.toHaveBeenCalled();
    expect(db.tables.financial_audit_log!.find((r) => r.action === "admin_payment_recheck")).toMatchObject({ actor_id: ADMIN, reference: REF, details: { purpose: "coin_deposit", before: "pending", after: "success", outcome: "settled" } });
  });
  it("a settled deposit is answered from the database: never re-asked, never credited again", async () => {
    await adminRecheckPayment(REF, ADMIN);
    const again = await adminRecheckPayment(REF, ADMIN);
    expect(again).toMatchObject({ ok: true, outcome: "already_closed" });
    expect(asked).toHaveLength(1);
    expect(db.rpc.settle_coin_deposit).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["a short payment", { amountMinor: 4_999 }],
    ["an overpayment", { amountMinor: 5_001 }],
    ["another currency", { currency: "NGN" }],
    ["another reference", { reference: "frenz_coin_dep_fw_99999999-1111-4111-8111-111111111111" }],
    ["another provider", { provider: "paystack" as const }],
  ])("%s settles nothing and is held for review", async (_why, over) => {
    charge = async () => ok(over);
    const out = await adminRecheckPayment(REF, ADMIN);
    expect(out).toMatchObject({ ok: true, outcome: "mismatched", after: "mismatch" });
    expect(db.rpc.settle_coin_deposit).not.toHaveBeenCalled();
    expect(db.tables.financial_audit_log!.some((r) => r.action === "coin_deposit_mismatch")).toBe(true);
  });
  it("still pending at Flutterwave: nothing is decided", async () => {
    charge = async () => ok({ status: "pending" });
    expect(await adminRecheckPayment(REF, ADMIN)).toMatchObject({ ok: true, outcome: "pending", after: "pending" });
    expect(db.rpc.settle_coin_deposit).not.toHaveBeenCalled();
  });
  it("Flutterwave unreachable: verification_failed, the attempt stays open", async () => {
    charge = async () => {
      throw new Error("timeout");
    };
    expect(await adminRecheckPayment(REF, ADMIN)).toMatchObject({ ok: true, outcome: "verification_failed", after: "pending" });
  });
  it("a coin attempt on another provider is unsupported — never guessed at", async () => {
    db.tables.ai_topup_attempts = [attempt({ provider: "paystack" })];
    expect(await adminRecheckPayment(REF, ADMIN)).toMatchObject({ ok: true, outcome: "unsupported" });
    expect(asked).toEqual([]);
  });
  it("an attempt another worker holds (webhook, cron) is skipped, not worked twice", async () => {
    db.tables.ai_topup_attempts = [attempt({ updated_at: new Date(Date.now() + 60_000).toISOString() })];
    expect(await adminRecheckPayment(REF, ADMIN)).toMatchObject({ ok: true, outcome: "skipped" });
    expect(asked).toEqual([]);
  });
  it("the settlement belongs to the attempt's own member — the admin cannot name one", async () => {
    await adminRecheckPayment(REF, ADMIN);
    // settle_coin_deposit takes no member: the SQL credits the attempt row's user_id
    expect(Object.keys((db.rpc.settle_coin_deposit as ReturnType<typeof vi.fn>).mock.calls[0]![0] as object).sort()).toEqual(["p_charge_id", "p_paid_currency", "p_paid_minor", "p_reference"]);
  });
});
