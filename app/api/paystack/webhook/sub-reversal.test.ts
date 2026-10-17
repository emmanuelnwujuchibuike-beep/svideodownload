import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Exclusive Part 2 (audit S2) — a SUB refund or dispute that fails to apply must be
 * RETRIED by Paystack, not acknowledged. This drives the REAL webhook route, the real
 * `reverseSub` and the real provider-event log (`claimProviderEvent` / `markProviderEvent`)
 * over an in-memory database; only the HMAC check is bypassed and `reverse_sub_purchase`
 * (whose own idempotency is proven in Postgres by supabase/tests/0247_*.pglite.mjs) answers
 * as scripted.
 */

let db: FakeDb;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/paystack/paystack", async (orig) => ({ ...(await orig<typeof import("@/lib/paystack/paystack")>()), verifyPaystackSignature: async () => true }));

const { POST } = await import("./route");

const REF = `frenz_sub_${"ef".repeat(16)}`;
const deliver = (event: string) => POST(new Request("https://frenzsave.com/api/paystack/webhook", { method: "POST", headers: { "x-paystack-signature": "t" }, body: JSON.stringify({ event, data: { id: 7, reference: REF, transaction_reference: REF } }) }));
const reversals = () => (db.rpc.reverse_sub_purchase as ReturnType<typeof vi.fn>).mock.calls.length;
const logged = (event: string) => db.tables.payment_provider_events?.find((e) => e.event_id === `${event}:${REF}`);

beforeEach(() => {
  db = fakeDb({ payment_provider_events: [] });
  db.unique.payment_provider_events = [["provider", "event_id"]];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("SUB refund / dispute webhook", () => {
  it("a successful refund is acknowledged and the delivery is marked processed", async () => {
    db.rpc.reverse_sub_purchase = vi.fn(() => ({ data: { ok: true, debt_after: 0 }, error: null }));
    const res = await deliver("refund.processed");
    expect(res.status).toBe(200);
    expect(db.rpc.reverse_sub_purchase).toHaveBeenCalledWith({ p_reference: REF, p_status: "refunded", p_actor: null, p_note: "Paystack refund.processed" });
    expect(logged("refund.processed")?.processed_at).toBeTruthy();
  });

  it("a database failure is a 500 (Paystack retries) and the delivery stays unprocessed — it used to be a 200", async () => {
    db.rpc.reverse_sub_purchase = vi.fn(() => ({ data: null, error: { message: "connection reset" } }));
    const res = await deliver("refund.processed");
    expect(res.status).toBe(500);
    expect(logged("refund.processed")?.processed_at ?? null).toBeNull();
  });

  it("the retry after that temporary failure is processed, once", async () => {
    let n = 0;
    db.rpc.reverse_sub_purchase = vi.fn(() => (++n === 1 ? { data: null, error: { message: "timeout" } } : { data: { ok: true, debt_after: 0 }, error: null }));
    expect((await deliver("refund.processed")).status).toBe(500);
    expect((await deliver("refund.processed")).status).toBe(200);
    expect(reversals()).toBe(2);
    expect(logged("refund.processed")?.processed_at).toBeTruthy();
  });

  it("a duplicate delivery of a processed refund is acknowledged without reversing again", async () => {
    db.rpc.reverse_sub_purchase = vi.fn(() => ({ data: { ok: true, debt_after: 0 }, error: null }));
    await deliver("refund.processed");
    const res = await deliver("refund.processed");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true });
    expect(reversals()).toBe(1);
  });

  it("an already-reversed purchase (the SQL answers duplicate) is acknowledged", async () => {
    db.rpc.reverse_sub_purchase = vi.fn(() => ({ data: { ok: true, duplicate: true }, error: null }));
    expect((await deliver("refund.processed")).status).toBe(200);
  });

  it("a dispute that fails is retried, then recovers", async () => {
    let n = 0;
    db.rpc.reverse_sub_purchase = vi.fn(() => (++n === 1 ? { data: null, error: { message: "deadlock" } } : { data: { ok: true, debt_after: 500 }, error: null }));
    expect((await deliver("charge.dispute.create")).status).toBe(500);
    expect((await deliver("charge.dispute.create")).status).toBe(200);
    expect((db.rpc.reverse_sub_purchase as ReturnType<typeof vi.fn>).mock.calls[1]![0]).toMatchObject({ p_status: "disputed" });
  });

  it("a permanently invalid event (a reference we don't know) is acknowledged, not retried forever", async () => {
    db.rpc.reverse_sub_purchase = vi.fn(() => ({ data: { ok: false, reason: "not_found" }, error: null }));
    const res = await deliver("refund.processed");
    expect(res.status).toBe(200);
    expect(logged("refund.processed")?.outcome).toBe("ignored:not_found");
  });
});

/*
  Part 12 (financial audit): a PARTIAL refund used to be applied as a full one — the creator lost the
  whole earning and the subscriber lost access for, say, a refunded fee. Paystack's refund.processed
  carries the refunded amount; only a refund of the whole charge reverses the purchase.
*/
describe("Part 12 — a partial refund is not a full reversal", () => {
  const refund = (amount: number | undefined, currency = "NGN") =>
    POST(new Request("https://frenzsave.com/api/paystack/webhook", { method: "POST", headers: { "x-paystack-signature": "t" }, body: JSON.stringify({ event: "refund.processed", data: { id: 8, transaction_reference: REF, ...(amount === undefined ? {} : { amount }), currency } }) }));
  beforeEach(() => {
    db.tables.sub_purchases = [{ id: "p1", reference: REF, status: "paid", charged_minor: 165000, charged_currency: "NGN", creator_id: "c1", subscriber_id: "s1" }];
    db.tables.financial_audit_log = [];
    db.rpc.reverse_sub_purchase = vi.fn(() => ({ data: { ok: true, debt_after: 0 }, error: null }));
  });

  it("a refund of part of the charge reverses NOTHING and is put on the audit log for an admin", async () => {
    const res = await refund(15000);
    expect(res.status).toBe(200);
    expect(reversals()).toBe(0);
    expect(db.tables.financial_audit_log).toEqual([expect.objectContaining({ action: "sub_partial_refund", reference: REF, details: expect.objectContaining({ refunded_minor: 15000, charged_minor: 165000, currency: "NGN" }) })]);
    expect(logged("refund.processed")?.processed_at).toBeTruthy();
  });

  it("a refund of the whole charge reverses it", async () => {
    await refund(165000);
    expect(reversals()).toBe(1);
  });

  it("a refund without an amount (older payloads) is treated as full, as before", async () => {
    await refund(undefined);
    expect(reversals()).toBe(1);
  });

  it("a refund in another currency than the charge is not guessed at: nothing reversed, an admin reviews it", async () => {
    await refund(100, "USD");
    expect(reversals()).toBe(0);
    expect(db.tables.financial_audit_log).toEqual([expect.objectContaining({ action: "sub_refund_unrecognised", details: expect.objectContaining({ currency: "USD", charged_currency: "NGN" }) })]);
  });
});
