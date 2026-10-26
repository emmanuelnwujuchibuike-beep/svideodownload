import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VerifiedCharge } from "@/lib/payments/charge";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin Part 4 — a coin deposit through the REAL Flutterwave webhook route and the REAL coin settle
 * (lib/coin/deposits.ts). Scripted: Flutterwave's verify API (no network) and the SQL settle, modelled as
 * settle_coin_deposit behaves (once per reference, the coins land pending) — the SQL itself is proven in
 * supabase/tests/0280_coin_deposits.pglite.mjs and coin_deposits_concurrency.pg.mjs.
 *
 * Pinned: a coin reference is settled ONLY by the coin settle — never the AI-credit top-up (no credits, no reward
 * path); the verified charge must match the attempt exactly; a duplicate delivery is acknowledged and credits nothing;
 * a pending payment is retried; anything refund-shaped about a coin deposit is logged for an admin, never applied.
 */

let db: FakeDb;
let apiAnswer: (id: string) => VerifiedCharge | Promise<VerifiedCharge>;
const settled = new Map<string, number>();
const aiCredits: string[] = [];

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/flutterwave/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/flutterwave/client")>()),
  verifyFlutterwaveById: async (id: string) => apiAnswer(id),
  verifyFlutterwaveByReference: async () => {
    throw new Error("the webhook verifies by id");
  },
}));
vi.mock("@/lib/ai/character-replace/recharge-server", () => ({
  creditVerifiedCharacterReplaceRecharge: async (o: { reference: string }) => (aiCredits.push(o.reference), { balanceAfterCents: 0, credits: 0, bonusCredits: 0 }),
  announceCharacterReplaceRecharge: async () => {},
}));
vi.mock("@/lib/ai/wallet/paystack-settle", () => ({ settleUnpaidTopup: async () => {} }));
vi.mock("@/lib/sub/server", () => ({ confirmSubPayment: vi.fn(async () => ({ ok: true, status: "paid" })) }));
vi.mock("@/lib/social/paid-verification", () => ({ confirmVerificationPayment: vi.fn(async () => "paid") }));
vi.mock("@/lib/ads-platform/payment-server", () => ({ handleFlutterwaveAdCharge: vi.fn(async () => "ad settled") }));

process.env.FLUTTERWAVE_SECRET_HASH = "the-secret-hash";
process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK_TEST-k";

const { POST } = await import("./route");

const USER = "11111111-1111-4111-8111-111111111111";
const REF = "frenz_coin_dep_fw_2b1c8f8e-1111-4111-8111-111111111111";
const TX = "5151";
const success = (over: Partial<VerifiedCharge> = {}): VerifiedCharge => ({ provider: "flutterwave", reference: REF, externalId: TX, status: "success", amountMinor: 5000, currency: "USD", channel: "card", paidAt: null, reason: "Approved", ...over });
const deliver = (opts: { id?: string; event?: string; data?: Record<string, unknown> } = {}) =>
  POST(new Request("https://frenzsave.com/api/flutterwave/webhook", { method: "POST", headers: { "content-type": "application/json", "verif-hash": "the-secret-hash" }, body: JSON.stringify({ event: opts.event ?? "charge.completed", data: opts.data ?? { id: Number(opts.id ?? TX), tx_ref: REF, status: "successful" } }) }));

beforeEach(() => {
  db = fakeDb({
    payment_provider_events: [],
    financial_audit_log: [],
    ai_topup_attempts: [{ reference: REF, user_id: USER, provider: "flutterwave", purpose: "coin_deposit", status: "pending", amount_cents: 5000, currency: "USD", provider_amount: 5000, provider_currency: "USD", checkout_url: "https://checkout.flutterwave.com/c", created_at: new Date(Date.now() - 60_000).toISOString(), updated_at: new Date(Date.now() - 60_000).toISOString() }],
  });
  db.unique.payment_provider_events = [["provider", "event_id"]];
  settled.clear();
  aiCredits.length = 0;
  apiAnswer = () => success();
  // settle_coin_deposit: once per reference, the paid amount checked against the attempt, the coins pending
  db.rpc.settle_coin_deposit = vi.fn((args: Record<string, unknown>) => {
    const a = args as { p_reference: string; p_paid_minor: number; p_paid_currency: string };
    if (settled.has(a.p_reference)) return { data: { ok: true, duplicate: true, amount: settled.get(a.p_reference), release_at: "2026-10-28T12:00:00Z" }, error: null };
    if (a.p_paid_minor !== 5000 || a.p_paid_currency !== "USD") return { data: { ok: false, reason: "mismatch" }, error: null };
    settled.set(a.p_reference, 5000);
    return { data: { ok: true, amount: 5000, release_at: "2026-10-28T12:00:00Z" }, error: null };
  });
  db.rpc.reverse_coin_deposit = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("Flutterwave webhook → a Frenz Coin deposit", () => {
  it("a verified payment settles into the coin wallet — never the AI-credit top-up", async () => {
    const res = await deliver();
    expect(res.status).toBe(200);
    expect(db.rpc.settle_coin_deposit).toHaveBeenCalledWith(expect.objectContaining({ p_reference: REF, p_charge_id: TX, p_paid_minor: 5000, p_paid_currency: "USD" }));
    expect(settled.get(REF)).toBe(5000);
    expect(aiCredits).toEqual([]);
  });
  it("the same delivery again is acknowledged and settles nothing more", async () => {
    await deliver();
    const again = await deliver();
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect(db.rpc.settle_coin_deposit).toHaveBeenCalledTimes(1);
  });
  it("another transaction id for the same reference (a second delivery shape) is the same deposit: credited once", async () => {
    await deliver();
    apiAnswer = () => success({ externalId: "5152" });
    expect((await deliver({ id: "5152" })).status).toBe(200);
    expect(settled.size).toBe(1);
    expect((db.rpc.settle_coin_deposit as ReturnType<typeof vi.fn>).mock.results[1]!.value.data).toMatchObject({ duplicate: true });
  });
  it.each([
    ["an underpayment", { amountMinor: 4999 }],
    ["an overpayment", { amountMinor: 5001 }],
    ["another currency", { currency: "NGN" }],
  ])("%s is a mismatch: nothing is credited, a person reviews it", async (_why, over) => {
    apiAnswer = () => success(over);
    expect((await deliver()).status).toBe(200);
    expect(db.rpc.settle_coin_deposit).not.toHaveBeenCalled();
    expect(db.tables.ai_topup_attempts![0]!.status).toBe("mismatch");
    expect(db.tables.financial_audit_log!.some((r) => r.action === "coin_deposit_mismatch")).toBe(true);
  });
  it("a payment still pending asks Flutterwave to retry; nothing is credited", async () => {
    apiAnswer = () => success({ status: "pending" });
    expect((await deliver()).status).toBe(500);
    expect(db.rpc.settle_coin_deposit).not.toHaveBeenCalled();
  });
  it("a failed payment closes the attempt; nothing is credited", async () => {
    apiAnswer = () => success({ status: "failed" });
    expect((await deliver()).status).toBe(200);
    expect(db.tables.ai_topup_attempts![0]!.status).toBe("failed");
    expect(db.rpc.settle_coin_deposit).not.toHaveBeenCalled();
  });
  it("Flutterwave unreachable: retried, nothing decided", async () => {
    apiAnswer = () => {
      throw new Error("timeout");
    };
    expect((await deliver()).status).toBe(500);
    expect(db.rpc.settle_coin_deposit).not.toHaveBeenCalled();
  });
  it("a database error while settling asks for a retry (the delivery stays open)", async () => {
    db.rpc.settle_coin_deposit = vi.fn(() => ({ data: null, error: { message: "connection reset" } }));
    expect((await deliver()).status).toBe(500);
  });
  it("a verified transaction for ANOTHER reference settles nothing", async () => {
    apiAnswer = () => success({ reference: "frenz_coin_dep_fw_99999999-1111-4111-8111-111111111111" });
    expect((await deliver()).status).toBe(200);
    expect(db.rpc.settle_coin_deposit).not.toHaveBeenCalled();
  });
  it("a refund- or chargeback-shaped event about a coin deposit is logged for an admin and changes nothing", async () => {
    for (const event of ["refund.completed", "charge.dispute.create", "chargeback.created"]) {
      expect((await deliver({ event, data: { id: 77, tx_ref: REF } })).status).toBe(200);
    }
    expect(db.tables.financial_audit_log!.filter((r) => r.action === "coin_deposit_provider_event_review")).toHaveLength(3);
    expect(db.rpc.reverse_coin_deposit).not.toHaveBeenCalled();
    expect(db.rpc.settle_coin_deposit).not.toHaveBeenCalled();
  });
  it("a failed audit write asks for a retry (the signal is never dropped)", async () => {
    db.failOn.financial_audit_log = "unavailable";
    expect((await deliver({ event: "refund.completed", data: { id: 77, tx_ref: REF } })).status).toBe(500);
  });
});
