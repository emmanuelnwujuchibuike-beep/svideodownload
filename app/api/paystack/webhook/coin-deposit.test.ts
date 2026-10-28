import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * 0299 — a Frenz Coin deposit paid through PAYSTACK (owner, 2026-10-27: Nigeria pays Paystack first). Drives the REAL
 * webhook route, the real settleCoinDeposit and the real provider-event log over an in-memory database; only the HMAC
 * check is bypassed, Paystack's verify is scripted, and settle_coin_deposit (proven in Postgres by
 * supabase/tests/0299_coin_paystack_deposits.pglite.mjs) answers as scripted. The event body's numbers are never used:
 * the route asks Paystack about OUR reference.
 */
let db: FakeDb;
let verify: (ref: string) => Promise<Record<string, unknown>>;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/paystack/paystack", async (orig) => ({ ...(await orig<typeof import("@/lib/paystack/paystack")>()), verifyPaystackSignature: async () => true, verifyTransaction: async (ref: string) => verify(ref), paystackEnabled: async () => true }));

const { POST } = await import("./route");

const USER = "11111111-1111-4111-8111-111111111111";
const REF = "frenz_coin_dep_2b1c8f8e-2222-4222-8222-222222222222";
const deliver = (event: string, data: Record<string, unknown>) => POST(new Request("https://frenzsave.com/api/paystack/webhook", { method: "POST", headers: { "x-paystack-signature": "t" }, body: JSON.stringify({ event, data }) }));
const success = (over: Record<string, unknown> = {}) => deliver("charge.success", { id: 901, reference: REF, amount: 1, currency: "NGN", metadata: { purpose: "frenz_coin_deposit", user_id: USER }, ...over });
const row = (over: Record<string, unknown> = {}) => ({ id: REF, reference: REF, user_id: USER, provider: "paystack", purpose: "coin_deposit", status: "pending", amount_cents: 5_000, provider_amount: 8_000_000, provider_currency: "NGN", checkout_url: "https://checkout.paystack.com/c", created_at: new Date(Date.now() - 60_000).toISOString(), updated_at: new Date(Date.now() - 60_000).toISOString(), ...over });

beforeEach(() => {
  db = fakeDb({ payment_provider_events: [], ai_topup_attempts: [row()], financial_audit_log: [] });
  db.unique.payment_provider_events = [["provider", "event_id"]];
  db.rpc.settle_coin_deposit = vi.fn(() => ({ data: { ok: true, amount: 5_000, release_at: "2026-10-28T12:00:00Z" }, error: null }));
  db.rpc.credit_product_balance = vi.fn();
  db.rpc.credit_ai_balance = vi.fn();
  verify = async (ref) => ({ id: 901, reference: ref, status: "success", amount: 8_000_000, currency: "NGN", channel: "bank_transfer" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("Paystack webhook — a Frenz Coin deposit", () => {
  it("settles the naira Paystack VERIFIED (not the body's amount) into the coin wallet only, once", async () => {
    expect((await success()).status).toBe(200);
    expect(db.rpc.settle_coin_deposit).toHaveBeenCalledWith({ p_reference: REF, p_charge_id: "901", p_paid_minor: 8_000_000, p_paid_currency: "NGN" });
    expect(db.rpc.credit_product_balance).not.toHaveBeenCalled();
    expect(db.rpc.credit_ai_balance).not.toHaveBeenCalled();
    const again = await success();
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect(db.rpc.settle_coin_deposit).toHaveBeenCalledTimes(1);
  });
  it("Paystack still says pending: 500, so Paystack redelivers; nothing settled", async () => {
    verify = async (ref) => ({ reference: ref, status: "ongoing" });
    expect((await success()).status).toBe(500);
    expect(db.rpc.settle_coin_deposit).not.toHaveBeenCalled();
  });
  it("Paystack unreachable during verify: 500, never a silent 200", async () => {
    verify = async () => {
      throw new TypeError("fetch failed");
    };
    expect((await success()).status).toBe(500);
  });
  it("a coin purpose on a reference that isn't a Paystack coin deposit is ignored — never settled", async () => {
    const res = await success({ reference: "frenz_coin_dep_fw_2b1c8f8e-2222-4222-8222-222222222222" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: true });
    expect(db.rpc.settle_coin_deposit).not.toHaveBeenCalled();
  });
  it("a refund of a coin deposit is logged for an admin to record — no coins move by code", async () => {
    expect((await deliver("refund.processed", { id: 55, transaction_reference: REF, amount: 8_000_000, currency: "NGN" })).status).toBe(200);
    expect(db.tables.financial_audit_log!.find((e) => e.action === "coin_deposit_provider_event_review")).toMatchObject({ reference: REF, details: expect.objectContaining({ provider: "paystack", event: "refund.processed" }) });
    expect(db.rpc.settle_coin_deposit).not.toHaveBeenCalled();
  });
});
