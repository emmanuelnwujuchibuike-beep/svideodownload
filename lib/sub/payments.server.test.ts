import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Exclusive Part 2 — the REAL confirmSubPayment / hasActiveSub / startSubCheckout,
 * against an in-memory database, with only Paystack's answer scripted. What the SQL does
 * with a settle call is proven separately against Postgres itself (PGlite:
 * supabase/tests/0247_sub_settlement.pglite.mjs); here the question is what the server
 * decides to ASK, and what it writes on its own.
 */

let db: FakeDb;
const verify = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void fn }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/paystack/paystack", () => ({
  SUB_PURPOSE: "frenz_sub",
  verifyTransaction: (ref: string) => verify(ref),
  initializeSubCheckout: vi.fn(),
  paystackFailureIsDefinite: () => false,
  // Part 2: the router asks whether Paystack is configured before a SUB checkout
  paystackEnabled: async () => true,
}));
vi.mock("@/lib/landing/settings", async () => {
  const { SUB_DEFAULTS } = await import("@/lib/rewards/config");
  return { getLandingSettings: async () => ({ frenzRewards: { sub: SUB_DEFAULTS }, frenzAiCharacterReplace: { recharge: { checkoutCurrency: "NGN" } } }) };
});
vi.mock("./notify", () => ({ notifySubscribed: vi.fn() }));
// Part 5: the duplicate-purchase guard runs before pricing; past it, a rate outage is the first stop (proves the guard let it through)
vi.mock("@/lib/ai/character-replace/fx-rate-server", () => ({ resolveCheckoutRate: async () => ({ error: "test: no rate" }) }));
vi.mock("./payout-account", () => ({ autoWithdrawSub: vi.fn() }));

const { confirmSubPayment, hasActiveSub, startSubCheckout, settleOwnPendingSub } = await import("./server");

const REF = `frenz_sub_${"ab".repeat(16)}`;
const C = "00000000-0000-4000-8000-000000000001";
const S = "00000000-0000-4000-8000-000000000002";
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const purchase = (over: Record<string, unknown> = {}) => ({ id: "p1", reference: REF, creator_id: C, subscriber_id: S, status: "initiated", failure_source: null, created_at: ago(2), charged_minor: 165000, charged_currency: "NGN", ...over });
const charge = (status: string) => ({ status, amount: 165000, currency: "NGN", id: 99, metadata: { purpose: "frenz_sub" } });
const settles = () => vi.fn(() => ({ data: { ok: true, purchase_id: "p1" }, error: null }));
const updatesTo = (table: string) => db.writes.filter((w) => w.table === table && w.op === "update");

beforeEach(() => {
  db = fakeDb();
  verify.mockReset();
});

describe("the checkout race (audit S1) — confirmSubPayment", () => {
  it("an unfinished checkout two minutes old stays open: nothing is written, nothing is settled", async () => {
    db.tables.sub_purchases = [purchase({ created_at: ago(2) })];
    db.rpc.settle_sub_purchase = settles();
    verify.mockResolvedValue(charge("abandoned"));
    const out = await confirmSubPayment(REF);
    expect(out.status).toBe("pending");
    // before Part 2 this marked the purchase failed, and the later payment was refused
    expect(updatesTo("sub_purchases")).toHaveLength(0);
    expect(db.tables.sub_purchases![0]!.status).toBe("initiated");
    expect(db.rpc.settle_sub_purchase).not.toHaveBeenCalled();
  });

  it("past the grace an abandoned checkout is failed WITH its reason, and only while still initiated", async () => {
    db.tables.sub_purchases = [purchase({ created_at: ago(31) })];
    verify.mockResolvedValue(charge("abandoned"));
    expect((await confirmSubPayment(REF)).status).toBe("failed");
    const w = updatesTo("sub_purchases");
    expect(w).toHaveLength(1);
    expect(w[0]!.values).toMatchObject({ status: "failed", failure_source: "verify_abandoned" });
    expect(w[0]!.filters).toContain("status=initiated");
  });

  it("a later verified charge on that recoverable failure goes to settle (which may recover it)", async () => {
    db.tables.sub_purchases = [purchase({ status: "failed", failure_source: "verify_abandoned", created_at: ago(45) })];
    db.rpc.settle_sub_purchase = settles();
    verify.mockResolvedValue(charge("success"));
    expect(await confirmSubPayment(REF)).toEqual({ ok: true, status: "paid" });
    expect(db.rpc.settle_sub_purchase).toHaveBeenCalledWith({ p_reference: REF, p_paid_minor: 165000, p_paid_currency: "NGN", p_provider_ref: "99" });
  });

  it("an unverified 'success' never settles: a non-SUB charge, a still-pending charge, a Paystack outage", async () => {
    db.tables.sub_purchases = [purchase()];
    db.rpc.settle_sub_purchase = settles();
    verify.mockResolvedValueOnce({ ...charge("success"), metadata: { purpose: "frenz_ad_campaign" } });
    expect((await confirmSubPayment(REF)).status).toBe("unknown");
    verify.mockResolvedValueOnce(charge("ongoing"));
    expect((await confirmSubPayment(REF)).status).toBe("pending");
    verify.mockRejectedValueOnce(new Error("timeout"));
    expect((await confirmSubPayment(REF)).status).toBe("pending");
    expect(db.rpc.settle_sub_purchase).not.toHaveBeenCalled();
  });

  it("final states are never re-asked of Paystack, and never settled", async () => {
    for (const row of [purchase({ status: "refunded" }), purchase({ status: "failed", failure_source: "provider_reversed" }), purchase({ status: "failed", failure_source: "reversal_before_payment" })]) {
      db = fakeDb({ sub_purchases: [row] });
      db.rpc.settle_sub_purchase = settles();
      expect((await confirmSubPayment(REF)).status).toBe("failed");
    }
    expect(verify).not.toHaveBeenCalled();
  });

  it("a paid purchase answers from the database; a removed member's payment is 'held'", async () => {
    db.tables.sub_purchases = [purchase({ status: "paid" })];
    expect(await confirmSubPayment(REF)).toEqual({ ok: true, status: "paid" });
    db.tables.sub_purchases = [purchase({ status: "refund_due" })];
    expect((await confirmSubPayment(REF)).status).toBe("held");
    expect(verify).not.toHaveBeenCalled();
  });

  it("maps settle's refusals: wrong amount → mismatch, removed member → held, final row → failed, DB error → pending (retry)", async () => {
    db.tables.sub_purchases = [purchase()];
    verify.mockResolvedValue(charge("success"));
    const answers: [unknown, string][] = [
      [{ data: { ok: false, reason: "amount_mismatch" }, error: null }, "mismatch"],
      [{ data: { ok: false, reason: "removed" }, error: null }, "held"],
      [{ data: { ok: false, reason: "not_payable" }, error: null }, "failed"],
      [{ data: null, error: { message: "connection reset" } }, "pending"],
    ];
    for (const [answer, want] of answers) {
      db.rpc.settle_sub_purchase = () => answer as never;
      expect((await confirmSubPayment(REF)).status).toBe(want);
    }
  });

  it("a reference we never issued costs no database read beyond ours and no Paystack call", async () => {
    expect((await confirmSubPayment("frenz_sub_nope")).status).toBe("unknown");
    expect((await confirmSubPayment(`frenz_sub_${"cd".repeat(16)}`)).status).toBe("unknown"); // well-formed, not ours
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("identifiers are validated inside the helpers (audit R5)", () => {
  const evil = `${C},and(blocker_id.eq.${S})`;
  it("hasActiveSub: a malformed id is 'no access' and never reaches a query", async () => {
    db.failOn.creator_memberships = "should not be read";
    expect(await hasActiveSub(evil, C)).toBe(false);
    expect(await hasActiveSub(S, "not-a-uuid")).toBe(false);
    expect(db.writes).toHaveLength(0);
  });
  it("hasActiveSub: a valid active, unexpired, unblocked subscription is access; the creator always is", async () => {
    db.tables.creator_memberships = [{ id: "m1", creator_id: C, member_id: S, status: "active", billing: "sub", period_end: new Date(Date.now() + 86_400_000).toISOString() }];
    expect(await hasActiveSub(S, C)).toBe(true);
    expect(await hasActiveSub(C, C)).toBe(true);
    db.tables.creator_memberships[0]!.period_end = ago(1);
    expect(await hasActiveSub(S, C)).toBe(false);
  });
  it("startSubCheckout and settleOwnPendingSub refuse malformed ids before any read", async () => {
    db.failOn.profiles = "should not be read";
    const out = await startSubCheckout({ subscriberId: S, email: "a@b.co", creatorId: evil, returnPath: "/" });
    expect(out).toMatchObject({ ok: false, status: 400 });
    expect(await settleOwnPendingSub("x", C)).toBe(false);
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("Part 5 — no accidental second purchase (startSubCheckout)", () => {
  const live = () => {
    db.tables.profiles = [{ id: C, handle: "amaka", is_suspended: false, is_hidden: false }];
    db.tables.creator_membership_settings = [{ creator_id: C, sub_price_cents: 1000, sub_active: true, setup_step: 4, setup_completed_at: ago(100), open: false, welcome: null, promo_dismissed_at: null }];
    db.tables.blocks = [];
  };
  const member = (days: number, over: Record<string, unknown> = {}) => [{ id: "m1", creator_id: C, member_id: S, status: "active", billing: "sub", period_end: new Date(Date.now() + days * 86_400_000).toISOString(), ...over }];
  const start = () => startSubCheckout({ subscriberId: S, email: "a@b.co", creatorId: C, returnPath: "/account/subscriptions" });

  it("a subscriber paid up beyond the renewal window is refused, and no purchase row is created", async () => {
    live();
    db.tables.creator_memberships = member(20);
    expect(await start()).toMatchObject({ ok: false, status: 409, reason: "already_active" });
    expect(db.writes.filter((w) => w.table === "sub_purchases")).toHaveLength(0);
  });

  it("inside the last 3 days, after expiry, after leaving, or with no membership, checkout proceeds", async () => {
    for (const rows of [member(2), member(-1), member(20, { status: "ended" }), []]) {
      live();
      db.tables.creator_memberships = rows;
      // past the guard: the next stop is pricing (the test has no exchange rate)
      expect(await start()).toMatchObject({ ok: false, status: 503 });
    }
  });

  it("a cancelled-but-paid-up subscriber is still refused until the window — cancelling never opens a second purchase", async () => {
    live();
    db.tables.creator_memberships = member(20, { cancelled_at: ago(10), cancel_period: 1, period_index: 1 });
    expect(await start()).toMatchObject({ ok: false, status: 409, reason: "already_active" });
  });

  it("a removed member is refused as before", async () => {
    live();
    db.tables.creator_memberships = member(20, { status: "removed" });
    expect(await start()).toMatchObject({ ok: false, status: 403 });
  });
});
