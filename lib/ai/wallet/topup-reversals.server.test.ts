import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin Part 2 (0278, H1): a refunded or charged-back wallet top-up takes its credits back.
 * What is pinned here is what the server BELIEVES before it calls reverse_wallet_topup: Paystack events are signed and
 * the original charge is re-verified; Flutterwave events are only logged for an admin; an admin's record re-verifies
 * the charge with its provider; anything uncertain is a retry, never a guess. The accounting (once per event, capped,
 * never negative, shortfall → restriction) is proven in supabase/tests/0278_financial_safety.pglite.mjs.
 */
let db: FakeDb;
let paystackCharge: Record<string, unknown> | Error;
let flutterwaveCharge: Record<string, unknown> | Error;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/paystack/paystack", () => ({
  CHARACTER_REPLACE_TOPUP_PURPOSE: "frenz_cr_topup",
  verifyTransaction: async () => {
    if (paystackCharge instanceof Error) throw paystackCharge;
    return paystackCharge;
  },
}));
vi.mock("@/lib/flutterwave/client", () => ({
  verifyFlutterwaveByReference: async () => {
    if (flutterwaveCharge instanceof Error) throw flutterwaveCharge;
    return flutterwaveCharge;
  },
}));

const m = await import("./topup-reversals");
const PS = "frenz_cr_topup_0b8b1f5e-1111-4222-8333-444455556666";
const FW = "frenz_cr_topup_fw_0b8b1f5e-1111-4222-8333-444455556666";
const reversed = (over: Record<string, unknown> = {}) => ({ data: { ok: true, id: "rev-1", state: "recovered", due: 100, recovered: 100, shortfall: 0, ...over }, error: null });

beforeEach(() => {
  db = fakeDb({ financial_audit_log: [] });
  db.rpc.reverse_wallet_topup = vi.fn(() => reversed());
  paystackCharge = { status: "success", amount: 150_000, currency: "NGN", reference: PS };
  flutterwaveCharge = { status: "success", amountMinor: 1_000, currency: "USD", reference: FW, provider: "flutterwave" };
});

const args = () => (db.rpc.reverse_wallet_topup as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as Record<string, unknown>);

describe("references", () => {
  it("Paystack and Flutterwave top-ups are told apart by our own reference shapes", () => {
    expect(m.topupProvider(PS)).toBe("paystack");
    expect(m.topupProvider(FW)).toBe("flutterwave");
    expect(m.topupProvider("frenz_sub_0123")).toBeNull();
    expect(m.topupProvider("frenz_cr_topup_not-a-uuid")).toBeNull();
  });
});

describe("Paystack refund.processed / charge.dispute.create", () => {
  it("anything that is not one of our top-ups is left to the other branches (null)", async () => {
    expect(await m.handlePaystackTopupReversal("refund.processed", { transaction_reference: "frenz_sub_abc" })).toBeNull();
    expect(args()).toEqual([]);
  });
  it("a full refund of a verified top-up reverses it once, keyed by Paystack's event id", async () => {
    const out = await m.handlePaystackTopupReversal("refund.processed", { id: 77, transaction_reference: PS, amount: 150_000, currency: "NGN" });
    expect(out).toEqual({ retry: false, outcome: "refund:recovered" });
    expect(args()).toEqual([expect.objectContaining({ p_provider: "paystack", p_event_key: "refund:77", p_kind: "refund", p_reference: PS, p_refunded_minor: 150_000, p_paid_minor: 150_000, p_paid_currency: "NGN", p_actor: null })]);
  });
  it("a partial refund passes its own amount (the SQL takes back that share, rounded up)", async () => {
    await m.handlePaystackTopupReversal("refund.processed", { id: 78, transaction: { reference: PS }, amount: 50_000, currency: "NGN" });
    expect(args()[0]).toMatchObject({ p_refunded_minor: 50_000, p_paid_minor: 150_000 });
  });
  it("a chargeback HOLDS the credits (kind dispute), with its refund_amount", async () => {
    db.rpc.reverse_wallet_topup = vi.fn(() => reversed({ state: "held" }));
    const out = await m.handlePaystackTopupReversal("charge.dispute.create", { id: 9, transaction: { reference: PS }, refund_amount: 150_000, currency: "NGN" });
    expect(out?.outcome).toBe("dispute:held");
    expect(args()[0]).toMatchObject({ p_kind: "dispute", p_event_key: "dispute:9" });
  });
  it("a shortfall is reported (the credits were already spent or sent)", async () => {
    db.rpc.reverse_wallet_topup = vi.fn(() => reversed({ recovered: 30, shortfall: 70 }));
    expect((await m.handlePaystackTopupReversal("refund.processed", { id: 1, transaction_reference: PS }))?.outcome).toBe("refund:recovered:shortfall");
  });
  it("Paystack unreachable: a RETRY, nothing reversed on the event's word", async () => {
    paystackCharge = new Error("timeout");
    expect(await m.handlePaystackTopupReversal("refund.processed", { id: 1, transaction_reference: PS })).toEqual({ retry: true, outcome: "verify_unavailable" });
    expect(args()).toEqual([]);
  });
  it("a top-up Paystack does not show as paid changes nothing and is logged for review", async () => {
    paystackCharge = { status: "abandoned", amount: 150_000, currency: "NGN", reference: PS };
    expect((await m.handlePaystackTopupReversal("refund.processed", { id: 1, transaction_reference: PS }))?.outcome).toBe("unverified");
    expect(args()).toEqual([]);
    expect(db.tables.financial_audit_log).toEqual([expect.objectContaining({ action: "wallet_topup_reversal_unverified", reference: PS })]);
  });
  it("a refund in another currency changes nothing and is logged for review", async () => {
    expect((await m.handlePaystackTopupReversal("refund.processed", { id: 1, transaction_reference: PS, amount: 100, currency: "USD" }))?.outcome).toBe("currency_review");
    expect(args()).toEqual([]);
  });
  it("a dispute's resolution is only logged — an admin records the outcome after checking the dashboard", async () => {
    expect((await m.handlePaystackTopupReversal("charge.dispute.resolve", { id: 9, transaction: { reference: PS }, resolution: "merchant-accepted" }))?.outcome).toBe("review");
    expect(args()).toEqual([]);
    expect(db.tables.financial_audit_log).toEqual([expect.objectContaining({ action: "wallet_topup_dispute_event", reference: PS })]);
  });
  it("0278 not run yet, or a database error: a RETRY (a chargeback is never dropped)", async () => {
    db.rpc.reverse_wallet_topup = vi.fn(() => ({ data: null, error: { message: "function public.reverse_wallet_topup does not exist" } }));
    expect(await m.handlePaystackTopupReversal("refund.processed", { id: 1, transaction_reference: PS })).toEqual({ retry: true, outcome: "pending_migration" });
    db.rpc.reverse_wallet_topup = vi.fn(() => ({ data: null, error: { message: "deadlock detected" } }));
    expect((await m.handlePaystackTopupReversal("refund.processed", { id: 1, transaction_reference: PS }))?.retry).toBe(true);
  });
  it("an audit row that cannot be written asks for a retry", async () => {
    db.failOn.financial_audit_log = "relation unavailable";
    paystackCharge = { status: "failed", reference: PS };
    expect((await m.handlePaystackTopupReversal("refund.processed", { id: 1, transaction_reference: PS }))?.retry).toBe(true);
  });
});

describe("Flutterwave: logged for an admin, never applied on its own", () => {
  it("a refund-shaped event about a top-up is logged, nothing is reversed", async () => {
    expect(await m.noteFlutterwaveTopupEvent("refund.completed", { id: 5, tx_ref: FW })).toBe(true);
    expect(args()).toEqual([]);
    expect(db.tables.financial_audit_log).toEqual([expect.objectContaining({ action: "wallet_topup_provider_event_review", reference: FW })]);
  });
  it("not one of our top-ups: null", async () => {
    expect(await m.noteFlutterwaveTopupEvent("refund.completed", { id: 5, tx_ref: "someone-else" })).toBeNull();
  });
});

describe("an admin records a reversal", () => {
  const record = (over: Partial<Parameters<typeof m.recordAdminTopupReversal>[0]> = {}) => m.recordAdminTopupReversal({ reference: FW, kind: "refund", refundedMinor: null, idempotencyKey: "tr_0123456789", adminId: "admin-1", note: "Refunded in the dashboard", ...over });
  it("the Flutterwave charge is re-verified first, the replay key is the event key, the admin is the actor", async () => {
    expect((await record()).ok).toBe(true);
    expect(args()[0]).toMatchObject({ p_provider: "flutterwave", p_event_key: "admin:tr_0123456789", p_paid_minor: 1_000, p_paid_currency: "USD", p_actor: "admin-1" });
  });
  it("a charge the provider does not show as paid is refused, nothing reversed", async () => {
    flutterwaveCharge = { status: "pending", amountMinor: 1_000, currency: "USD", reference: FW };
    expect(await record()).toEqual({ ok: false, reason: "not_paid" });
    expect(args()).toEqual([]);
  });
  it("a refund larger than the charge is refused", async () => {
    expect(await record({ refundedMinor: 5_000 })).toEqual({ ok: false, reason: "invalid" });
  });
  it("the provider unreachable: an error, nothing reversed", async () => {
    flutterwaveCharge = new Error("timeout");
    expect(await record()).toEqual({ ok: false, reason: "error" });
    expect(args()).toEqual([]);
  });
  it("a Paystack top-up is verified with Paystack", async () => {
    expect((await record({ reference: PS })).ok).toBe(true);
    expect(args()[0]).toMatchObject({ p_provider: "paystack", p_paid_minor: 150_000 });
  });
});

describe("wiring", () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("the Paystack webhook asks the wallet branch BEFORE the SUB / verification refund branches, and retries on uncertainty", () => {
    const w = src("app/api/paystack/webhook/route.ts");
    const wallet = w.indexOf("handlePaystackTopupReversal(event.event");
    expect(wallet).toBeGreaterThan(-1);
    expect(wallet).toBeLessThan(w.indexOf('if (ref.startsWith("frenz_sub_"))'));
    expect(w).toContain('if (out.retry) return NextResponse.json({ error: "Retry" }, { status: 500 });');
  });
  it("the admin routes are behind the money gate (fresh password)", () => {
    expect(src("app/api/admin/wallet/topup-reversals/route.ts")).toContain('requireFinancialAdmin("topup_reversal.record"');
    expect(src("app/api/admin/wallet/topup-reversals/[id]/route.ts")).toContain('requireFinancialAdmin("topup_reversal.update"');
  });
});
