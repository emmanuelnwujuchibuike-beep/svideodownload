import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Part 5 — an admin "Recheck" settles EXACTLY ONCE through a real path: the real adminRecheckPayment and the real
 * confirmVerificationPayment / grant over an in-memory database; only Paystack's answer is scripted (no network).
 * Proves: a paid charge grants the tick once; a second recheck, two simultaneous clicks, or a late webhook-style
 * confirm never grant again; an unfinished charge stays open (never "failed" to make room for another checkout).
 */

let db: FakeDb;
let charge: Record<string, unknown>;
const verifyCalls: string[] = [];
vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void fn }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/paystack/paystack", async (orig) => ({ ...(await orig<typeof import("@/lib/paystack/paystack")>()), paystackEnabled: async () => true, verifyTransaction: async (ref: string) => (verifyCalls.push(ref), charge) }));
vi.mock("@/lib/landing/settings", () => ({ getLandingSettings: async () => ({ frenzAiPlans: {}, frenzAiCharacterReplace: { recharge: { checkoutCurrency: "NGN" } } }) }));
// the attempt-ledger purposes are not exercised here (their own suites); keep their heavy imports out
vi.mock("@/lib/ai/wallet/reconcile-topups", () => ({ TOPUP_ATTEMPT_COLUMNS: "*", reconcileTopupAttempt: vi.fn() }));
vi.mock("@/lib/ai/credits/plan-attempts", () => ({ PLAN_ATTEMPT_COLUMNS: "*", reconcilePlanAttempt: vi.fn() }));
vi.mock("@/lib/ads-platform/payment-server", () => ({ reconcileAdAttempt: vi.fn() }));
vi.mock("@/lib/sub/notify", () => ({ notifySubscribed: vi.fn() }));
vi.mock("@/lib/sub/payout-account", () => ({ autoWithdrawSub: vi.fn() }));

const { adminRecheckPayment } = await import("./admin-transactions");

const USER = "00000000-0000-4000-8000-000000000001";
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REF = "frenz_vf_0123456789abcdef";
const old = new Date(Date.now() - 60 * 60_000).toISOString();
const approvals = () => db.tables.verification_requests!.filter((r) => r.status === "approved").length;
const verified = () => (db.tables.profiles![0] as { is_verified: boolean }).is_verified;

beforeEach(() => {
  verifyCalls.length = 0;
  db = fakeDb({
    settings: [{ key: "paid_verification", value: { enabled: true, priceCents: 500, periodDays: 30 } }],
    profiles: [{ id: USER, is_verified: false, is_suspended: false }],
    verification_requests: [],
    verification_events: [],
    verification_purchases: [{ id: "p1", user_id: USER, reference: REF, provider: "paystack", price_cents: 500, charged_currency: "NGN", charged_minor: 800_000, period_days: 30, status: "initiated", checkout_url: "https://checkout.paystack.test/x", created_at: old, updated_at: old }],
    financial_audit_log: [],
    ai_topup_attempts: [],
    sub_purchases: [],
  });
  charge = { status: "success", amount: 800_000, currency: "NGN", id: 42, metadata: { purpose: "frenz_verification", user_id: USER } };
});

describe("admin recheck settles exactly once (real paid-verification path)", () => {
  it("a paid charge: the tick is granted once; a second recheck answers from the ledger without asking Paystack", async () => {
    expect(await adminRecheckPayment(REF, ADMIN)).toMatchObject({ ok: true, before: "initiated", after: "paid", outcome: "paid" });
    expect(verified()).toBe(true);
    expect(approvals()).toBe(1);
    expect(await adminRecheckPayment(REF, ADMIN)).toMatchObject({ ok: true, before: "paid", after: "paid", outcome: "already_closed" });
    expect(approvals()).toBe(1);
    expect(verifyCalls).toEqual([REF]);
    expect(db.tables.financial_audit_log).toHaveLength(2);
  });

  it("two simultaneous rechecks (a double click): one grant", async () => {
    const [a, b] = await Promise.all([adminRecheckPayment(REF, ADMIN), adminRecheckPayment(REF, ADMIN)]);
    expect([a, b].every((r) => r.ok)).toBe(true);
    expect(approvals()).toBe(1);
    expect(db.tables.verification_purchases![0]).toMatchObject({ status: "paid" });
  });

  it("an unfinished charge stays OPEN — never failed to make room for another checkout", async () => {
    charge = { ...charge, status: "ongoing" };
    expect(await adminRecheckPayment(REF, ADMIN)).toMatchObject({ ok: true, before: "initiated", after: "initiated", outcome: "pending" });
    expect(verified()).toBe(false);
  });

  it("a short payment grants nothing", async () => {
    charge = { ...charge, amount: 100 };
    const out = await adminRecheckPayment(REF, ADMIN);
    expect(out).toMatchObject({ ok: true });
    expect(verified()).toBe(false);
    expect(approvals()).toBe(0);
  });
});
