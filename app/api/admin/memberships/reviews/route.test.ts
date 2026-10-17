import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/** Part 12 follow-up — the admin money reviews: admin only, and reviewing never moves money. */

let db: FakeDb;
let admin: { id: string } | null = { id: "admin-1" };
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/admin/guard", () => ({ getAdminUser: async () => admin }));

const route = await import("./route");
const REF = `frenz_sub_${"ab".repeat(16)}`;
const post = (body: unknown) => route.POST(new Request("https://frenzsave.com/api/admin/memberships/reviews", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  admin = { id: "admin-1" };
  db = fakeDb({
    financial_audit_log: [{ id: 41, action: "sub_partial_refund", reference: REF, details: { refunded_minor: 15000, currency: "NGN", charged_minor: 165000, charged_currency: "NGN" }, created_at: "2026-10-16T10:00:00Z" }],
    sub_purchases: [{ id: "p1", reference: REF, status: "paid", price_cents: 1000, charged_minor: 165000, charged_currency: "NGN" }],
    sub_balances: [{ creator_id: "c1", available_cents: 1000 }],
  });
  db.rpc.restore_disputed_sub_purchase = vi.fn(() => ({ data: { ok: true }, error: null }));
});

describe("admin money reviews", () => {
  it("not an admin: 403 for reading and for every action, nothing written", async () => {
    admin = null;
    expect((await route.GET()).status).toBe(403);
    expect((await post({ action: "close_refund_review", id: "41", note: "done" })).status).toBe(403);
    expect((await post({ action: "restore_dispute", reference: REF, note: "won" })).status).toBe(403);
    expect(db.tables.financial_audit_log).toHaveLength(1);
    expect(db.rpc.restore_disputed_sub_purchase).not.toHaveBeenCalled();
  });

  it("lists a partial refund with what was charged and refunded, open until reviewed", async () => {
    const j = await (await route.GET()).json();
    expect(j.refundReviews).toEqual([expect.objectContaining({ id: "41", kind: "partial", reference: REF, chargedMinor: 165000, refundedMinor: 15000, refundedCurrency: "NGN", reviewed: null })]);
  });

  it("'Mark reviewed' writes an audit row only — no purchase, balance or access changes — and a second click is a duplicate", async () => {
    const before = JSON.stringify([db.tables.sub_purchases, db.tables.sub_balances]);
    expect((await post({ action: "close_refund_review", id: "41", note: "Refunded the fee by hand" })).status).toBe(200);
    expect(await (await post({ action: "close_refund_review", id: "41", note: "again" })).json()).toMatchObject({ duplicate: true });
    expect(JSON.stringify([db.tables.sub_purchases, db.tables.sub_balances])).toBe(before);
    expect(db.tables.financial_audit_log!.filter((r) => r.action === "sub_refund_review_closed")).toEqual([expect.objectContaining({ actor_id: "admin-1", reference: REF, details: expect.objectContaining({ review_id: "41" }) })]);
    expect((await (await route.GET()).json()).refundReviews[0].reviewed).toBeTruthy();
  });

  it("only a refund-review row can be closed (not any audit id)", async () => {
    db.tables.financial_audit_log!.push({ id: 42, action: "sub_purchase_refunded", reference: REF, details: {} });
    expect((await post({ action: "close_refund_review", id: "42", note: "nope" })).status).toBe(404);
  });

  it("'Dispute won' calls the restore with the ADMIN's id and their note; a short note is refused", async () => {
    expect((await post({ action: "restore_dispute", reference: REF, note: "no" })).status).toBe(400);
    expect((await post({ action: "restore_dispute", reference: REF, note: "Won: Paystack dispute 123" })).status).toBe(200);
    expect(db.rpc.restore_disputed_sub_purchase).toHaveBeenCalledWith({ p_reference: REF, p_actor: "admin-1", p_note: "Won: Paystack dispute 123" });
  });
});
