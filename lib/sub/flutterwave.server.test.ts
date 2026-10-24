import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VerifiedCharge } from "@/lib/payments/charge";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Part 2 — a SUB purchase and a paid-verification purchase settled from a Flutterwave charge. The
 * real confirm functions over an in-memory database; Flutterwave's verify is scripted, and
 * `settle_sub_purchase` answers as scripted (its own amount/currency/idempotency rules are proven
 * in Postgres by supabase/tests/0247_*.pglite.mjs — the SAME function settles both rails).
 */

let db: FakeDb;
let apiAnswer: (ref: string) => VerifiedCharge;

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/flutterwave/client", async (orig) => ({ ...(await orig<typeof import("@/lib/flutterwave/client")>()), verifyFlutterwaveByReference: async (ref: string) => apiAnswer(ref) }));
vi.mock("@/lib/paystack/paystack", async (orig) => ({ ...(await orig<typeof import("@/lib/paystack/paystack")>()), verifyTransaction: vi.fn(async () => { throw new Error("a Flutterwave reference must never reach Paystack"); }) }));
vi.mock("@/lib/social/verification", () => ({ recordVerificationEvent: vi.fn(async () => {}) }));

const { confirmSubPayment } = await import("./server");
const { confirmVerificationPayment } = await import("@/lib/social/paid-verification");

const SUB_REF = `frenz_sub_fw_${"ab".repeat(16)}`;
const VF_REF = `frenz_vf_fw_${"cd".repeat(16)}`;
const USER = "11111111-1111-4111-8111-111111111111";
const charge = (reference: string, over: Partial<VerifiedCharge> = {}): VerifiedCharge => ({ provider: "flutterwave", reference, externalId: "88", status: "success", amountMinor: 1100, currency: "USD", channel: "card", paidAt: null, reason: null, ...over });
const settleCalls = () => (db.rpc.settle_sub_purchase as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);

beforeEach(() => {
  db = fakeDb({
    sub_purchases: [{ reference: SUB_REF, provider: "flutterwave", status: "initiated", created_at: new Date().toISOString(), failure_source: null, checkout_url: "https://checkout.flutterwave.com/s", charged_currency: "USD", charged_minor: 1100 }],
    verification_purchases: [{ id: "vp1", reference: VF_REF, user_id: USER, provider: "flutterwave", status: "initiated", created_at: new Date().toISOString(), charged_currency: "USD", charged_minor: 500, period_days: 30, checkout_url: "https://checkout.flutterwave.com/v" }],
    settings: [],
    profiles: [{ id: USER, is_verified: false }],
    verification_requests: [],
  });
  db.rpc.settle_sub_purchase = vi.fn(() => ({ data: { ok: true }, error: null }));
  apiAnswer = (ref) => charge(ref);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("SUB via Flutterwave", () => {
  it("a verified success settles through the SAME settle_sub_purchase, with Flutterwave's settled amount, currency and id", async () => {
    expect(await confirmSubPayment(SUB_REF)).toMatchObject({ ok: true, status: "paid" });
    expect(settleCalls()).toEqual([{ p_reference: SUB_REF, p_paid_minor: 1100, p_paid_currency: "USD", p_provider_ref: "88" }]);
  });
  it("Part 2.1: an UNDERpayment never reaches the settle — mismatch, nothing granted, audited for review", async () => {
    apiAnswer = (ref) => charge(ref, { amountMinor: 1000 });
    expect(await confirmSubPayment(SUB_REF)).toMatchObject({ ok: false, status: "mismatch" });
    expect(settleCalls()).toEqual([]);
    expect(db.tables.financial_audit_log?.[0]).toMatchObject({ action: "sub_payment_mismatch", reference: SUB_REF, details: expect.objectContaining({ mismatch: "underpaid" }) });
    expect(db.tables.sub_purchases![0]).toMatchObject({ status: "initiated" });
  });
  it("Part 2.1: an OVERpayment is not an ordinary payment either — held for review, no access granted (the SQL alone would accept it)", async () => {
    apiAnswer = (ref) => charge(ref, { amountMinor: 1101 });
    expect(await confirmSubPayment(SUB_REF)).toMatchObject({ ok: false, status: "mismatch" });
    expect(settleCalls()).toEqual([]);
    expect(db.tables.financial_audit_log?.[0]).toMatchObject({ details: expect.objectContaining({ mismatch: "overpaid" }) });
  });
  it("the same digits in another currency never settle", async () => {
    apiAnswer = (ref) => charge(ref, { currency: "NGN" });
    expect(await confirmSubPayment(SUB_REF)).toMatchObject({ ok: false, status: "mismatch" });
    expect(settleCalls()).toEqual([]);
  });
  it("a replayed settle is still exactly one: the SQL answers duplicate, nothing is granted twice", async () => {
    db.rpc.settle_sub_purchase = vi.fn().mockReturnValueOnce({ data: { ok: true }, error: null }).mockReturnValue({ data: { ok: true, duplicate: true }, error: null });
    expect(await confirmSubPayment(SUB_REF)).toMatchObject({ ok: true, status: "paid" });
    expect(await confirmSubPayment(SUB_REF, { flutterwaveCharge: charge(SUB_REF) })).toMatchObject({ ok: true, status: "paid" });
    expect(settleCalls()).toHaveLength(2);
    expect(settleCalls()[1]).toEqual(settleCalls()[0]);
  });
  it("a verified charge for ANOTHER reference settles nothing", async () => {
    apiAnswer = () => charge(`frenz_sub_fw_${"ee".repeat(16)}`);
    expect(await confirmSubPayment(SUB_REF)).toMatchObject({ ok: false, status: "unknown" });
    expect(settleCalls()).toEqual([]);
  });
  it("pending stays pending; nothing settles", async () => {
    apiAnswer = (ref) => charge(ref, { status: "pending" });
    expect(await confirmSubPayment(SUB_REF)).toMatchObject({ ok: false, status: "pending" });
    expect(settleCalls()).toEqual([]);
  });
  it("a checkout whose link was never handed out, unknown to Flutterwave, is closed as never created", async () => {
    db.tables.sub_purchases![0]!.checkout_url = null;
    apiAnswer = (ref) => charge(ref, { status: "not_found", amountMinor: null, currency: null });
    expect(await confirmSubPayment(SUB_REF)).toMatchObject({ ok: false, status: "failed" });
    expect(db.tables.sub_purchases![0]).toMatchObject({ status: "failed", failure_source: "init_refused" });
  });
  it("a Paystack-shaped row cannot be settled as Flutterwave (provider read from OUR row)", async () => {
    db.tables.sub_purchases![0]!.provider = "paystack";
    expect(await confirmSubPayment(SUB_REF)).toMatchObject({ ok: false, status: "unknown" });
    expect(settleCalls()).toEqual([]);
  });
  it("the webhook's already-verified charge is used as is (no second API call)", async () => {
    apiAnswer = () => {
      throw new Error("must not be called");
    };
    expect(await confirmSubPayment(SUB_REF, { flutterwaveCharge: charge(SUB_REF) })).toMatchObject({ ok: true, status: "paid" });
  });
});

describe("paid verification via Flutterwave", () => {
  it("a verified success at the stored USD price grants once; a second confirm is 'paid' with no second grant", async () => {
    apiAnswer = (ref) => charge(ref, { amountMinor: 500 });
    expect(await confirmVerificationPayment(VF_REF)).toBe("paid");
    expect(db.tables.verification_purchases![0]).toMatchObject({ status: "paid", provider_ref: "88" });
    expect(db.tables.profiles![0]).toMatchObject({ is_verified: true });
    const requests = db.tables.verification_requests!.length;
    expect(await confirmVerificationPayment(VF_REF)).toBe("paid");
    expect(db.tables.verification_requests!.length).toBe(requests);
  });
  it("Part 2.1: an overpayment grants nothing — closed for review (review_overpaid), never an ordinary payment", async () => {
    apiAnswer = (ref) => charge(ref, { amountMinor: 501 });
    expect(await confirmVerificationPayment(VF_REF)).toBe("failed");
    expect(db.tables.verification_purchases![0]).toMatchObject({ status: "failed", failure_source: "review_overpaid" });
    expect(db.tables.profiles![0]).toMatchObject({ is_verified: false });
  });
  it("a wrong amount or currency grants nothing", async () => {
    apiAnswer = (ref) => charge(ref, { amountMinor: 499 });
    expect(await confirmVerificationPayment(VF_REF)).toBe("failed");
    expect(db.tables.verification_purchases![0]).toMatchObject({ failure_source: "review_underpaid" });
    expect(db.tables.profiles![0]).toMatchObject({ is_verified: false });
    db.tables.verification_purchases![0]!.status = "initiated";
    apiAnswer = (ref) => charge(ref, { currency: "NGN", amountMinor: 750_000 });
    expect(await confirmVerificationPayment(VF_REF)).toBe("failed");
    expect(db.tables.profiles![0]).toMatchObject({ is_verified: false });
  });
  it("someone else's reference is unknown to the return page", async () => {
    expect(await confirmVerificationPayment(VF_REF, { userId: "22222222-2222-4222-8222-222222222222" })).toBe("unknown");
  });
});

describe("existing Paystack subscriptions stay with Paystack", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("new AI plans go to Flutterwave first (gate + plan id), Paystack the backup; Paystack's webhook still owns Paystack subscription events", () => {
    expect(read("app/api/ai/subscriptions/checkout/route.ts")).toContain('usable: (p) => (p === "flutterwave" ? flutterwaveOk : p === "paystack" && paystackOk)');
    expect(read("lib/payments/options.ts")).toContain('r === "paystack" && paystackOk && !!p.paystackPlanCode');
    const paystackHook = read("app/api/paystack/webhook/route.ts");
    for (const e of ["subscription.create", "subscription.disable", "subscription.not_renew", "invoice.update", "invoice.payment_failed"]) expect(paystackHook).toContain(`"${e}"`);
    // the Flutterwave webhook knows only ITS OWN plan lifecycle (payment-plan renewals, subscription.cancelled) — never a Paystack event
    const fwHook = read("app/api/flutterwave/webhook/route.ts");
    expect(fwHook).toContain('type === "subscription.cancelled"');
    for (const e of ["subscription.create", "subscription.disable", "invoice.update"]) expect(fwHook).not.toContain(e);
  });
});
