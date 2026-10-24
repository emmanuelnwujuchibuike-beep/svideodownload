import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Part 5 — the admin payments table and "Recheck" (lib/payments/admin-transactions.ts), over an in-memory database.
 * The per-purpose settle paths are scripted here (each has its own suite): what is proven is WHICH path a reference
 * reaches, that only the reference is passed on, that a closed attempt is never re-asked, and that every recheck is
 * audited. Settling exactly once through a real path: admin-recheck.integration.server.test.ts.
 */

let db: FakeDb;
const calls: string[] = [];
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/landing/settings", () => ({ getLandingSettings: async () => ({ frenzAiPlans: { plans: {} } }) }));
vi.mock("@/lib/ai/wallet/reconcile-topups", () => ({
  TOPUP_ATTEMPT_COLUMNS: "reference, user_id, provider, status, created_at, updated_at, checkout_url",
  reconcileTopupAttempt: vi.fn(async (row: { reference: string }) => {
    calls.push(`topup:${row.reference}`);
    const r = db.tables.ai_topup_attempts!.find((x) => x.reference === row.reference)!;
    r.status = "success";
    return "settled";
  }),
}));
vi.mock("@/lib/ai/credits/plan-attempts", () => ({
  PLAN_ATTEMPT_COLUMNS: "reference, user_id, provider, status, purpose",
  reconcilePlanAttempt: vi.fn(async (row: { reference: string }, config: unknown) => (calls.push(`plan:${row.reference}:${config ? "config" : "none"}`), "pending")),
}));
vi.mock("@/lib/ads-platform/payment-server", () => ({ reconcileAdAttempt: vi.fn(async (_db: unknown, ref: string) => (calls.push(`ad:${ref}`), "checked")) }));
vi.mock("@/lib/sub/server", () => ({ confirmSubPayment: vi.fn(async (ref: string) => (calls.push(`sub:${ref}`), { ok: false, status: "pending" })) }));
vi.mock("@/lib/social/paid-verification", () => ({ confirmVerificationPayment: vi.fn(async (ref: string) => (calls.push(`ver:${ref}`), "pending")) }));

const { adminRecheckPayment, listAdminTransactions, reconciliationState, isAdminReference } = await import("./admin-transactions");

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const audit = () => db.tables.financial_audit_log ?? [];

beforeEach(() => {
  calls.length = 0;
  db = fakeDb({
    ai_topup_attempts: [
      { reference: "frenz_cr_topup_fw_1", user_id: "u1", provider: "flutterwave", status: "verification_required", purpose: "wallet_topup", amount_cents: 1000, currency: "USD", provider_amount: 1000, provider_currency: "USD", status_reason: "outcome unknown", checkout_url: null, created_at: ago(10), updated_at: ago(9) },
      { reference: "frenz_ai_plan_2", user_id: "u2", provider: "paystack", status: "pending", purpose: "ai_subscription", amount_cents: 1000, currency: "USD", provider_amount: 1500000, provider_currency: "NGN", status_reason: null, checkout_url: "https://checkout.paystack.com/x", created_at: ago(20), updated_at: ago(20) },
      { reference: "frenz_ad_3", user_id: "u3", provider: "paystack", status: "success", purpose: "ad_campaign", amount_cents: 5000, currency: "USD", provider_amount: 5000, provider_currency: "USD", status_reason: null, checkout_url: "https://checkout.paystack.com/y", created_at: ago(30), updated_at: ago(29) },
      { reference: "frenz_ad_fw_4", user_id: "u3", provider: "flutterwave", status: "pending", purpose: "ad_campaign", amount_cents: 5000, currency: "USD", provider_amount: 5000, provider_currency: "USD", status_reason: null, checkout_url: "https://checkout.flutterwave.com/z", created_at: ago(5), updated_at: ago(5) },
    ],
    sub_purchases: [{ reference: "frenz_sub_5", subscriber_id: "u5", provider: "paystack", status: "initiated", charged_minor: 1760000, charged_currency: "NGN", failure_source: null, checkout_url: null, created_at: ago(40), updated_at: ago(40) }],
    verification_purchases: [{ reference: "frenz_vf_6", user_id: "u6", provider: "flutterwave", status: "paid", charged_minor: 500, charged_currency: "USD", failure_source: null, checkout_url: "https://checkout.flutterwave.com/v", created_at: ago(50), updated_at: ago(49) }],
    payment_provider_events: [
      { provider: "flutterwave", event_id: "e1", event_type: "charge.completed", reference: "frenz_vf_6", received_at: ago(49), processed_at: ago(49), outcome: "paid" },
      { provider: "paystack", event_id: "e2", event_type: "charge.success", reference: "frenz_ad_3", received_at: ago(29), processed_at: ago(29), outcome: "ad settled" },
    ],
    financial_audit_log: [],
  });
});

describe("the reconciliation state (pure, from each ledger's own status)", () => {
  it("maps every status, and a link-less open attempt past a minute is 'needs a check'", () => {
    expect(reconciliationState("success", true, ago(5))).toBe("settled");
    expect(reconciliationState("paid", true, ago(5))).toBe("settled");
    expect(reconciliationState("verification_required", false, ago(5))).toBe("needs_check");
    expect(reconciliationState("mismatch", true, ago(5))).toBe("review");
    expect(reconciliationState("refund_due", true, ago(5))).toBe("review");
    expect(reconciliationState("pending", true, ago(5))).toBe("open");
    expect(reconciliationState("initiated", false, ago(5))).toBe("needs_check");
    // a link-less row under a minute old may still be mid-request
    expect(reconciliationState("initiated", false, new Date(Date.now() - 10_000).toISOString())).toBe("open");
    for (const s of ["failed", "abandoned", "expired", "refunded", "reversed", "disputed"]) expect(reconciliationState(s, true, ago(5))).toBe("closed");
  });
});

describe("the payments table", () => {
  it("reads all three ledgers and the webhook log into one shape, newest first", async () => {
    const out = await listAdminTransactions();
    expect(out.rows.map((r) => r.reference)).toEqual(["frenz_ad_fw_4", "frenz_cr_topup_fw_1", "frenz_ai_plan_2", "frenz_ad_3", "frenz_sub_5", "frenz_vf_6"]);
    expect(out.rows.find((r) => r.reference === "frenz_cr_topup_fw_1")).toMatchObject({ source: "ai_topup_attempts", purpose: "wallet_topup", provider: "flutterwave", state: "needs_check", amountMinor: 1000, currency: "USD", reason: "outcome unknown", hasCheckoutLink: false });
    expect(out.rows.find((r) => r.reference === "frenz_sub_5")).toMatchObject({ source: "sub_purchases", purpose: "sub_purchase", state: "needs_check", amountMinor: 1760000, currency: "NGN" });
    expect(out.rows.find((r) => r.reference === "frenz_vf_6")).toMatchObject({ source: "verification_purchases", purpose: "verification", state: "settled" });
    expect(out.events).toHaveLength(2);
    expect(out.unavailable).toEqual([]);
  });

  it("filters by provider, purpose, state and reference", async () => {
    expect((await listAdminTransactions({ provider: "flutterwave" })).rows.map((r) => r.reference).sort()).toEqual(["frenz_ad_fw_4", "frenz_cr_topup_fw_1", "frenz_vf_6"]);
    expect((await listAdminTransactions({ purpose: "sub_purchase" })).rows.map((r) => r.reference)).toEqual(["frenz_sub_5"]);
    expect((await listAdminTransactions({ state: "needs_check" })).rows.map((r) => r.reference).sort()).toEqual(["frenz_cr_topup_fw_1", "frenz_sub_5"]);
    const byRef = await listAdminTransactions({ reference: "frenz_vf_6" });
    expect(byRef.rows.map((r) => r.reference)).toEqual(["frenz_vf_6"]);
    expect(byRef.events.map((e) => e.reference)).toEqual(["frenz_vf_6"]);
  });

  it("a ledger that can't be read (a pending migration) is reported, the rest still shown", async () => {
    db.failOn = { verification_purchases: "column verification_purchases.provider does not exist" };
    const out = await listAdminTransactions();
    expect(out.unavailable).toEqual(["verification_purchases"]);
    expect(out.rows.length).toBe(5);
  });
});

describe("Recheck — by reference only, through the purpose's own path, audited", () => {
  it("dispatches each open attempt to its purpose's existing settle path", async () => {
    expect(await adminRecheckPayment("frenz_cr_topup_fw_1", ADMIN)).toMatchObject({ ok: true, source: "ai_topup_attempts", purpose: "wallet_topup", before: "verification_required", after: "success", outcome: "settled" });
    expect(await adminRecheckPayment("frenz_ai_plan_2", ADMIN)).toMatchObject({ ok: true, purpose: "ai_subscription", outcome: "pending" });
    expect(await adminRecheckPayment("frenz_ad_fw_4", ADMIN)).toMatchObject({ ok: true, purpose: "ad_campaign", outcome: "checked" });
    expect(await adminRecheckPayment("frenz_sub_5", ADMIN)).toMatchObject({ ok: true, source: "sub_purchases", outcome: "pending" });
    // the plan path receives the live plans config, never anything from the request
    expect(calls).toEqual(["topup:frenz_cr_topup_fw_1", "plan:frenz_ai_plan_2:config", "ad:frenz_ad_fw_4", "sub:frenz_sub_5"]);
  });

  it("a closed attempt is answered from the ledger and NEVER re-asked — a second recheck after settling does nothing", async () => {
    expect(await adminRecheckPayment("frenz_ad_3", ADMIN)).toMatchObject({ ok: true, before: "success", after: "success", outcome: "already_closed" });
    expect(await adminRecheckPayment("frenz_vf_6", ADMIN)).toMatchObject({ ok: true, before: "paid", after: "paid", outcome: "already_closed" });
    await adminRecheckPayment("frenz_cr_topup_fw_1", ADMIN);
    expect(await adminRecheckPayment("frenz_cr_topup_fw_1", ADMIN)).toMatchObject({ outcome: "already_closed" });
    expect(calls).toEqual(["topup:frenz_cr_topup_fw_1"]);
  });

  it("every recheck is in the financial audit log: admin, reference, before → after", async () => {
    await adminRecheckPayment("frenz_cr_topup_fw_1", ADMIN);
    expect(audit()).toEqual([expect.objectContaining({ actor_id: ADMIN, action: "admin_payment_recheck", target_type: "ai_topup_attempts", reference: "frenz_cr_topup_fw_1", details: { purpose: "wallet_topup", before: "verification_required", after: "success", outcome: "settled" } })]);
  });

  it("refuses anything that isn't our reference shape, and an unknown reference touches nothing", async () => {
    for (const bad of ["", "abc", "frenz_ x", "'; drop table x;--", "https://evil.example/frenz_1"]) {
      expect(await adminRecheckPayment(bad, ADMIN)).toMatchObject({ ok: false, code: "bad_reference" });
    }
    expect(await adminRecheckPayment("frenz_sub_unknownref", ADMIN)).toMatchObject({ ok: false, code: "not_found" });
    expect(calls).toEqual([]);
    expect(audit()).toEqual([]);
    expect(isAdminReference("frenz_vf_fw_abcdef")).toBe(true);
  });
});
