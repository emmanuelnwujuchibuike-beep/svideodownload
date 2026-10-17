import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Part 12 follow-up — payout safety. The REAL payout code (lib/rewards/paystack-payouts.ts) and the
 * real admin route, on an in-memory database. Paystack is a script: no request leaves the test and
 * nothing is paid. `resolve_withdrawal` is a small stand-in with the SQL's legal moves (the SQL
 * itself, and reverse_paid_withdrawal, are proven in supabase/tests/sub_financial_invariants.pglite.mjs).
 */

let db: FakeDb;
let admin: { id: string } | null = { id: "admin-1" };
type Handler = (path: string, body?: unknown) => unknown;
let paystack: Handler;
const calls: string[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/admin/guard", () => ({ getAdminUser: async () => admin }));
vi.mock("@/lib/ai/character-replace/fx-rate-server", () => ({ marketRate: async () => ({ rate: { perUsd: 1500 }, source: "stored" }) }));
vi.mock("@/lib/notifications/smart-delivery", () => ({ sendSmartPush: async () => {} }));
vi.mock("@/lib/email/member-email", () => ({ emailMember: async () => "sent" }));
vi.mock("@/lib/paystack/paystack", async (orig) => {
  const real = await orig<typeof import("@/lib/paystack/paystack")>();
  return {
    ...real,
    paystackRequest: async (path: string, init?: { body?: unknown }) => {
      calls.push(path);
      return paystack(path, init?.body);
    },
  };
});

const { PaystackHttpError } = await import("@/lib/paystack/paystack");
const payouts = await import("./paystack-payouts");
const route = await import("@/app/api/admin/rewards/withdrawals/[id]/route");

const ID = "11111111-2222-4333-8444-555555555555";
const REF = `frenz_wd_${ID.replace(/-/g, "")}`;
const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
const ok = (data: unknown) => ({ status: true, data });

const LEGAL: Record<string, string[]> = {
  pending: ["reviewing", "approved", "processing", "rejected", "cancelled"],
  reviewing: ["approved", "rejected", "cancelled"],
  approved: ["processing", "completed", "rejected", "cancelled"],
  processing: ["completed", "rejected"],
};

beforeEach(() => {
  admin = { id: "admin-1" };
  calls.length = 0;
  paystack = () => {
    throw new Error("unscripted");
  };
  db = fakeDb({
    withdrawal_requests: [{ id: ID, user_id: "u1", credits: 0, status: "approved", source: "sub", payout_method: "paystack", amount_usd_cents: 900, gross_cents: 1000, net_cents: 900, payout_reference: null, payout_details: { bankCode: "058", accountNumber: "0123456789", accountName: "ADA OBI" } }],
    financial_audit_log: [],
  });
  // the SQL's legal moves, and the reference / note it records
  db.rpc.resolve_withdrawal = (a) => {
    const w = db.tables.withdrawal_requests!.find((x) => x.id === a.p_id)!;
    if (["completed", "rejected", "cancelled", "reversed"].includes(String(w.status))) return { data: { ok: false, reason: "final" }, error: null };
    if (!LEGAL[String(w.status)]?.includes(String(a.p_status))) return { data: { ok: false, reason: "invalid_transition" }, error: null };
    w.status = a.p_status;
    if (a.p_payout_ref) w.payout_reference = a.p_payout_ref;
    if (a.p_note) w.review_note = a.p_note;
    return { data: { ok: true }, error: null };
  };
  db.rpc.reverse_paid_withdrawal = vi.fn((a: Record<string, unknown>) => {
    const w = db.tables.withdrawal_requests!.find((x) => x.id === a.p_id)!;
    if (w.status === "reversed") return { data: { ok: true, duplicate: true }, error: null };
    if (w.status !== "completed") return { data: { ok: false, reason: "not_completed" }, error: null };
    w.status = "reversed";
    return { data: { ok: true }, error: null };
  });
});

const row = () => db.tables.withdrawal_requests![0]!;
const transfer = (outcome: () => unknown) => {
  paystack = (path) => {
    if (path === "/transferrecipient") return ok({ recipient_code: "RCP_1" });
    if (path === "/transfer") return outcome();
    throw new Error("unscripted " + path);
  };
};

describe("an uncertain transfer is held, never treated as failed", () => {
  it("a TIMEOUT after sending: processing, with its reference, 'outcome unknown' — not approved, not rejected", async () => {
    transfer(() => {
      throw timeout();
    });
    const out = await payouts.payWithdrawalViaPaystack(ID, "admin-1");
    expect(out).toEqual({ ok: true, status: "unknown" });
    expect(row()).toMatchObject({ status: "processing", payout_reference: REF });
    expect(String(row().review_note)).toMatch(/Outcome unknown/);
  });

  it("a 5xx from Paystack is also unknown (Paystack failing says nothing about the transfer)", async () => {
    transfer(() => {
      throw new PaystackHttpError("Internal error", 502);
    });
    await payouts.payWithdrawalViaPaystack(ID, "admin-1");
    expect(row()).toMatchObject({ status: "processing", payout_reference: REF });
  });

  it("a 4xx REFUSAL is definite: nothing was sent, it stays approved with no reference", async () => {
    transfer(() => {
      throw new PaystackHttpError("Insufficient balance", 400);
    });
    const out = await payouts.payWithdrawalViaPaystack(ID, "admin-1");
    expect(out.ok).toBe(false);
    expect(row()).toMatchObject({ status: "approved", payout_reference: null });
  });

  it("an uncertain withdrawal can't be sent a second time (retries never start another transfer)", async () => {
    transfer(() => {
      throw timeout();
    });
    await payouts.payWithdrawalViaPaystack(ID, "admin-1");
    calls.length = 0;
    const again = await payouts.payWithdrawalViaPaystack(ID, "admin-1");
    expect(again.ok).toBe(false);
    expect(calls).not.toContain("/transfer");
  });

  it("teeth: the old rule (any non-'reference' error = not sent) would have left it approved and re-sendable", () => {
    const old = (e: Error) => (/reference/i.test(e.message) ? "sent" : "not_sent");
    expect(old(timeout())).toBe("not_sent");
    expect(new PaystackHttpError("x", 502)).toBeInstanceOf(Error);
  });
});

describe("an admin can't release held money without Paystack's word", () => {
  const reject = (body: Record<string, unknown> = {}) => route.POST(new Request(`https://frenzsave.com/api/admin/rewards/withdrawals/${ID}`, { method: "POST", body: JSON.stringify({ status: "rejected", note: "admin says failed", ...body }) }), { params: Promise.resolve({ id: ID }) });
  const OLD = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  const held = (updated_at = OLD) => Object.assign(row(), { status: "processing", payout_reference: REF, updated_at });
  const verify = (answer: () => unknown) => {
    paystack = (path) => {
      if (path.startsWith("/transfer/verify/")) return answer();
      throw new Error("unscripted " + path);
    };
  };

  it("Paystack says it was PAID: it completes instead, and the money is not released", async () => {
    held();
    verify(() => ok({ status: "success" }));
    const res = await reject();
    expect(await res.json()).toMatchObject({ ok: true, outcome: "completed_instead" });
    expect(row().status).toBe("completed");
  });

  it("Paystack says it FAILED (or was reversed): rejected, the money returns", async () => {
    held();
    verify(() => ok({ status: "failed" }));
    expect((await reject()).status).toBe(200);
    expect(row().status).toBe("rejected");
  });

  it("Paystack still processing, OTP pending, or unreachable: refused, it stays held", async () => {
    for (const answer of [() => ok({ status: "pending" }), () => ok({ status: "otp" }), () => { throw timeout(); }]) {
      held();
      verify(answer);
      const res = await reject();
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ reason: "outcome_unknown" });
      expect(row().status).toBe("processing");
    }
  });

  it("Paystack has NO such transfer: refused until the admin explicitly confirms it was never sent — then rejected and audited", async () => {
    held();
    verify(() => {
      throw new PaystackHttpError("Transfer not found", 404);
    });
    const first = await reject();
    expect(await first.json()).toMatchObject({ reason: "confirm_not_sent" });
    expect(row().status).toBe("processing");
    expect(await (await reject({ confirmNotSent: true, note: "" })).json()).toMatchObject({ reason: "reason_required" });
    expect(row().status).toBe("processing");
    const second = await reject({ confirmNotSent: true, note: "Checked the Paystack dashboard: no such transfer" });
    expect(second.status).toBe(200);
    expect(row().status).toBe("rejected");
    expect(db.tables.financial_audit_log).toEqual([expect.objectContaining({ action: "withdrawal_transfer_not_found_confirmed", actor_id: "admin-1", reference: REF, details: expect.objectContaining({ note: "Checked the Paystack dashboard: no such transfer", from: "processing", checked_at: expect.any(String) }) })]);
  });

  it("a withdrawal never sent (never approved, no reference) is rejected as before, without asking Paystack", async () => {
    Object.assign(row(), { status: "reviewing" });
    const res = await reject();
    expect(res.status).toBe(200);
    expect(row().status).toBe("rejected");
    expect(calls).toHaveLength(0);
  });

  const notFound = () => verify(() => {
    throw new PaystackHttpError("Transfer not found", 404);
  });

  it("a FRESH 404 is not proof: under an hour after the attempt it stays held, even with confirmation", async () => {
    held(new Date().toISOString());
    notFound();
    const res = await reject({ confirmNotSent: true, note: "looks failed" });
    expect(await res.json()).toMatchObject({ reason: "too_soon" });
    expect(row().status).toBe("processing");
    expect(db.tables.financial_audit_log).toHaveLength(0);
  });

  it("a 404 that isn't Paystack's own JSON answer (a proxy page, a dropped body) is ambiguous: held", async () => {
    held();
    verify(() => {
      throw new SyntaxError("Unexpected token < in JSON");
    });
    expect(await (await reject({ confirmNotSent: true, note: "x-reason" })).json()).toMatchObject({ reason: "outcome_unknown" });
    expect(row().status).toBe("processing");
  });

  it("the audit record can't be written: nothing is released", async () => {
    held();
    notFound();
    db.failOn.financial_audit_log = "relation unavailable";
    const res = await reject({ confirmNotSent: true, note: "Checked the dashboard" });
    expect(await res.json()).toMatchObject({ reason: "audit_failed" });
    expect(row().status).toBe("processing");
  });

  it("two admins confirm at once (back to back here): released ONCE, the second is told it's finished", async () => {
    held();
    notFound();
    const spy = vi.spyOn(db.rpc, "resolve_withdrawal");
    const [a, b] = [await reject({ confirmNotSent: true, note: "first admin" }), await reject({ confirmNotSent: true, note: "second admin" })];
    expect(a.status).toBe(200);
    expect(await b.json()).toMatchObject({ reason: "final" });
    expect(spy.mock.results.filter((r) => (r.value as { data: { ok: boolean } }).data.ok)).toHaveLength(1);
    expect(row().status).toBe("rejected");
  });

  it("APPROVED via Paystack but no reference recorded (sent, then the record failed): Paystack is asked by the fixed reference", async () => {
    Object.assign(row(), { status: "approved", payout_reference: null, updated_at: OLD });
    verify(() => ok({ status: "success" }));
    expect(await (await reject()).json()).toMatchObject({ outcome: "completed_instead" });
    expect(calls).toEqual([`/transfer/verify/${REF}`]);
    expect(row()).toMatchObject({ status: "completed", payout_reference: REF });
  });

  it("approved, no reference, Paystack has none: released after the wait; refused while fresh or unreachable", async () => {
    for (const [updated_at, answer, expected] of [
      [new Date().toISOString(), notFound, "approved"],
      [OLD, () => verify(() => { throw timeout(); }), "approved"],
      [OLD, notFound, "rejected"],
    ] as const) {
      Object.assign(row(), { status: "approved", payout_reference: null, updated_at });
      answer();
      await reject();
      expect(row().status).toBe(expected);
    }
  });

  it("not an admin: 403, nothing changes", async () => {
    admin = null;
    held();
    expect((await reject()).status).toBe(403);
    expect(row().status).toBe("processing");
  });
});

describe("a paid transfer that came back (transfer.reversed)", () => {
  const paid = () => Object.assign(row(), { status: "completed", payout_reference: REF });

  it("verified with Paystack, then applied once; a duplicate event changes nothing more", async () => {
    paid();
    paystack = () => ok({ status: "reversed" });
    expect(await payouts.settlePaystackTransfer("transfer.reversed", REF)).toBe(true);
    expect(row().status).toBe("reversed");
    expect(await payouts.settlePaystackTransfer("transfer.reversed", REF)).toBe(true);
    expect(db.rpc.reverse_paid_withdrawal).toHaveBeenCalledTimes(1);
  });

  it("if Paystack doesn't confirm the reversal (still success, or unreachable), nothing moves and the webhook is asked to retry", async () => {
    for (const answer of [() => ok({ status: "success" }), () => { throw timeout(); }]) {
      paid();
      paystack = answer;
      await expect(payouts.settlePaystackTransfer("transfer.reversed", REF)).rejects.toThrow();
      expect(row().status).toBe("completed");
    }
    expect(db.rpc.reverse_paid_withdrawal).not.toHaveBeenCalled();
  });

  it("out of order — 'reversed' before 'success' while still processing: rejected (money back), and the late success changes nothing", async () => {
    Object.assign(row(), { status: "processing", payout_reference: REF });
    await payouts.settlePaystackTransfer("transfer.reversed", REF);
    expect(row().status).toBe("rejected");
    paystack = () => ok({ status: "reversed" });
    await payouts.settlePaystackTransfer("transfer.success", REF);
    expect(row().status).toBe("rejected");
    expect(db.tables.financial_audit_log).toHaveLength(0);
  });

  it("a transfer that LANDS after the money was released is recorded once for an admin (never silently ignored)", async () => {
    Object.assign(row(), { status: "rejected", payout_reference: REF });
    paystack = () => ok({ status: "success" });
    expect(await payouts.settlePaystackTransfer("transfer.success", REF)).toBe(true);
    expect(await payouts.settlePaystackTransfer("transfer.success", REF)).toBe(true);
    expect(db.tables.financial_audit_log).toEqual([expect.objectContaining({ action: "withdrawal_paid_after_release", target_id: ID, reference: REF })]);
    expect(row().status).toBe("rejected");
  });

  it("…and if Paystack can't confirm that late success, the webhook is retried (nothing recorded on a guess)", async () => {
    Object.assign(row(), { status: "cancelled", payout_reference: REF });
    paystack = () => {
      throw timeout();
    };
    await expect(payouts.settlePaystackTransfer("transfer.success", REF)).rejects.toThrow();
    expect(db.tables.financial_audit_log).toHaveLength(0);
  });

  it("a reference that isn't ours is ignored", async () => {
    expect(await payouts.settlePaystackTransfer("transfer.reversed", "someone_else_123")).toBe(false);
  });
});
