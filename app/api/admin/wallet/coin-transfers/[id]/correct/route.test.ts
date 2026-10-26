import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin closeout — the transfer-correction route. The accounting is proven against real functions in
 * supabase/tests/0283_coin_closeout.pglite.mjs; pinned here: administrators only, a fresh password, a reason and a
 * replay key; the admin's id from the session; every outcome audited.
 */
let db: FakeDb;
let admin: { id: string } | null;
let fresh = true;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/admin/guard", () => ({ getAdminUser: async () => admin }));
vi.mock("@/lib/admin/reauth", () => ({ hasRecentReauth: async () => fresh }));
const { POST } = await import("./route");
const T = "11111111-1111-4111-8111-111111111111";
const call = (body: unknown, id = T) => POST(new Request("https://frenzsave.com/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  admin = { id: "admin-1" };
  fresh = true;
  db = fakeDb({ financial_audit_log: [] });
  db.rpc.correct_coin_transfer = vi.fn(() => ({ data: { ok: true, id: "c1", amount: 600 }, error: null }));
});

describe("POST /api/admin/wallet/coin-transfers/[id]/correct", () => {
  it("a member (not an administrator): 403, nothing corrected", async () => {
    admin = null;
    expect((await call({ kind: "fee_refund", reason: "charged in error", idempotencyKey: "corr-key-01" })).status).toBe(403);
    expect(db.rpc.correct_coin_transfer).not.toHaveBeenCalled();
  });
  it("no fresh password: REAUTH_REQUIRED, nothing corrected", async () => {
    fresh = false;
    expect((await call({ kind: "fee_refund", reason: "charged in error", idempotencyKey: "corr-key-01" })).status).toBe(403);
    expect(db.rpc.correct_coin_transfer).not.toHaveBeenCalled();
  });
  it("a reason and a replay key are required; a recipient debit is not a correction kind", async () => {
    for (const b of [{ kind: "fee_refund", idempotencyKey: "corr-key-01" }, { kind: "fee_refund", reason: "x", idempotencyKey: "corr-key-01" }, { kind: "fee_refund", reason: "ok reason" }, { kind: "recipient_debit", reason: "ok reason", idempotencyKey: "corr-key-01", amountCents: 100 }]) {
      expect((await call(b)).status).toBe(400);
    }
    expect(db.rpc.correct_coin_transfer).not.toHaveBeenCalled();
  });
  it("records it with the admin's id from the session, and audits it", async () => {
    const res = await call({ kind: "sender_credit", amountCents: 600, reason: "sent to the wrong wallet", idempotencyKey: "corr-key-02" });
    expect(res.status).toBe(200);
    expect(db.rpc.correct_coin_transfer).toHaveBeenCalledWith({ p_transfer: T, p_kind: "sender_credit", p_amount: 600, p_reason: "sent to the wrong wallet", p_admin: "admin-1", p_idempotency: "corr-key-02" });
    expect(db.tables.financial_audit_log!.some((r) => r.action === "admin_coin_transfer_corrected" && r.actor_id === "admin-1")).toBe(true);
  });
  it("the database's refusal is said plainly and audited", async () => {
    db.rpc.correct_coin_transfer = vi.fn(() => ({ data: { ok: false, reason: "already_refunded" }, error: null }));
    const res = await call({ kind: "fee_refund", reason: "again", idempotencyKey: "corr-key-03" });
    expect(res.status).toBe(409);
    expect(db.tables.financial_audit_log!.some((r) => r.action === "admin_coin_transfer_correction_refused")).toBe(true);
  });
});
