import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Exclusive Part 5 — the REAL subscription manager, cancel/resume, transactions, receipts,
 * the creator's subscriber list, leave() and the reminder sweep, against an in-memory database.
 * What the SQL does around a cancellation (settle/reverse) is proven against Postgres itself:
 * supabase/tests/0250_sub_membership_lifecycle.pglite.mjs.
 */

let db: FakeDb;
const push = vi.fn(async () => undefined);
const email = vi.fn(async () => undefined);
vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void fn }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("./server", async () => {
  const { SUB_DEFAULTS } = await import("@/lib/rewards/config");
  return { subConfig: async () => SUB_DEFAULTS };
});
vi.mock("@/lib/notifications/smart-delivery", () => ({ sendSmartPush: (...a: unknown[]) => push(...(a as [])) }));
vi.mock("@/lib/email/member-email", () => ({ emailMember: (...a: unknown[]) => email(...(a as [])) }));
vi.mock("@/lib/notifications/publish", () => ({ publishNotification: vi.fn() }));

const { mySubscriptions, cancelSubscription, resumeSubscription, myTransactions, myReceipt, creatorSubscribers, SUBSCRIBERS_PAGE, TX_PAGE } = await import("./subscriptions");
const { sweepSubReminders } = await import("./reminders");
const { leave } = await import("@/lib/creator/membership/server");

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const C = U(1); // creator
const S = U(2); // subscriber
const O = U(3); // someone else
const C2 = U(4); // another creator
const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const membership = (over: Record<string, unknown> = {}) => ({ id: crypto.randomUUID(), creator_id: C, member_id: S, status: "active", billing: "sub", role: "member", price_cents: 1000, period_index: 2, period_start: at(-10), period_end: at(20), joined_at: at(-40), ended_at: null, cancelled_at: null, cancel_period: null, ...over });
const profile = (id: string, handle: string, over: Record<string, unknown> = {}) => ({ id, handle, display_name: handle, avatar_url: null, is_verified: false, is_suspended: false, is_hidden: false, ...over });
const purchase = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  creator_id: C,
  subscriber_id: S,
  status: "paid",
  created_at: at(-10),
  paid_at: at(-10),
  reversed_at: null,
  price_cents: 1000,
  fee_cents: 100,
  total_cents: 1100,
  charged_currency: "NGN",
  charged_minor: 165000,
  period_days: 30,
  period_start: at(-10),
  period_end: at(20),
  reference: `frenz_sub_${crypto.randomUUID().replace(/-/g, "")}`,
  provider_ref: "SECRET_PROVIDER_REF",
  checkout_url: "https://checkout.paystack.com/SECRET",
  failure_source: null,
  fx_minor_per_usd: 150000,
  ...over,
});
const writes = (table: string, op: string) => db.writes.filter((w) => w.table === table && w.op === op);

beforeEach(() => {
  db = fakeDb({
    profiles: [profile(C, "amaka"), profile(S, "sub"), profile(O, "other"), profile(C2, "tobi")],
    creator_membership_settings: [
      { creator_id: C, sub_active: true, sub_price_cents: 1000 },
      { creator_id: C2, sub_active: true, sub_price_cents: 500 },
    ],
    blocks: [],
    financial_audit_log: [],
    sub_membership_reminders: [],
  });
  db.unique.sub_membership_reminders = [["membership_id", "period_index", "kind"]];
  push.mockClear();
  email.mockClear();
});

// ─── Cancellation ────────────────────────────────────────────────────────────

describe("cancel keeps the paid period", () => {
  it("records the intent for THIS period and leaves status and period_end exactly as they were", async () => {
    const row = membership();
    db.tables.creator_memberships = [row];
    const out = await cancelSubscription(S, C);
    expect(out).toMatchObject({ ok: true, already: false, periodEnd: row.period_end });
    const r = db.tables.creator_memberships![0]!;
    expect(r).toMatchObject({ status: "active", period_end: row.period_end, period_index: 2, cancel_period: 2 });
    expect(typeof r.cancelled_at).toBe("string");
    // the write touched only the two intent columns
    expect(Object.keys(writes("creator_memberships", "update")[0]!.values as object).sort()).toEqual(["cancel_period", "cancelled_at"]);
    // audited
    expect(db.tables.financial_audit_log).toEqual([expect.objectContaining({ action: "sub_membership_cancelled", actor_id: S, target_type: "creator_membership", target_id: row.id })]);
  });

  it("the manager then shows 'Ending' with the same access-until, and access", async () => {
    db.tables.creator_memberships = [membership()];
    await cancelSubscription(S, C);
    const out = await mySubscriptions(S);
    if (!out.ok) throw new Error("load");
    expect(out.items[0]).toMatchObject({ state: "ending", label: "Ending", access: true, actions: { cancel: false, resume: true, renew: false } });
    expect(out.items[0]!.periodEnd).toBe(db.tables.creator_memberships![0]!.period_end);
  });

  it("repeating it is idempotent: one write, one audit row, same answer", async () => {
    db.tables.creator_memberships = [membership()];
    await cancelSubscription(S, C);
    const again = await cancelSubscription(S, C);
    expect(again).toMatchObject({ ok: true, already: true });
    expect(writes("creator_memberships", "update")).toHaveLength(1);
    expect(db.tables.financial_audit_log).toHaveLength(1);
  });

  it("an expired, removed or ended subscription can't be cancelled or resumed back into access", async () => {
    for (const over of [{ period_end: at(-1) }, { status: "removed" }, { status: "ended" }]) {
      db.tables.creator_memberships = [membership({ ...over, cancelled_at: at(-2), cancel_period: 2 })];
      expect(await cancelSubscription(S, C)).toMatchObject({ ok: false, status: 409 });
      expect(await resumeSubscription(S, C)).toMatchObject({ ok: false, status: 409 });
      expect(db.tables.creator_memberships![0]).toMatchObject({ status: over.status ?? "active", cancel_period: 2 });
    }
    expect(writes("creator_memberships", "update")).toHaveLength(0);
  });

  it("resume clears only the intent — it never touches status or period_end", async () => {
    const row = membership({ cancelled_at: at(-1), cancel_period: 2 });
    db.tables.creator_memberships = [row];
    expect(await resumeSubscription(S, C)).toMatchObject({ ok: true, already: false });
    expect(db.tables.creator_memberships![0]).toMatchObject({ status: "active", period_end: row.period_end, cancel_period: null, cancelled_at: null });
    expect(db.tables.financial_audit_log![0]).toMatchObject({ action: "sub_membership_resumed" });
  });

  it("a renewal that settles between the read and the write wins: the cancellation is not applied to the new period", async () => {
    const row = membership();
    db.tables.creator_memberships = [row];
    // the settle function moves period_index on the moment the cancel reads the row
    const read = db.client() as { from: (t: string) => unknown };
    const realFrom = read.from;
    let first = true;
    (db as unknown as { client: () => unknown }).client = () => ({
      ...read,
      from: (t: string) => {
        if (t === "creator_memberships" && !first) Object.assign(db.tables.creator_memberships![0]!, { period_index: 3, period_end: at(50) });
        if (t === "creator_memberships") first = false;
        return realFrom(t);
      },
    });
    const out = await cancelSubscription(S, C);
    expect(out).toMatchObject({ ok: false, status: 409, reason: "changed" });
    expect(db.tables.creator_memberships![0]).toMatchObject({ period_index: 3, cancel_period: null });
  });

  it("before 0250 runs (no column), cancelling answers 503 and writes nothing", async () => {
    const row: Record<string, unknown> = membership();
    delete row.cancel_period;
    delete row.cancelled_at;
    db.tables.creator_memberships = [row];
    expect(await cancelSubscription(S, C)).toMatchObject({ ok: false, status: 503 });
    expect(writes("creator_memberships", "update")).toHaveLength(0);
  });

  it("ids are validated inside the helper (nothing read for a malformed id)", async () => {
    db.failOn.creator_memberships = "should not be read";
    expect(await cancelSubscription(S, "x),or(id.neq.0")).toMatchObject({ ok: false, status: 400 });
    expect(await mySubscriptions("nope")).toMatchObject({ ok: false, status: 400 });
  });
});

describe("leave()", () => {
  it("on a paid subscription with time left, it is a cancellation at period end — access is kept", async () => {
    const row = membership();
    db.tables.creator_memberships = [row];
    expect(await leave(S, C)).toMatchObject({ ok: true, cancelled: true });
    expect(db.tables.creator_memberships![0]).toMatchObject({ status: "active", period_end: row.period_end, cancel_period: 2 });
  });

  it("a free membership still ends at once", async () => {
    db.tables.creator_memberships = [membership({ billing: "free", period_end: null })];
    expect(await leave(S, C)).toMatchObject({ ok: true });
    expect(db.tables.creator_memberships![0]).toMatchObject({ status: "ended" });
  });
});

// ─── The subscriber manager ──────────────────────────────────────────────────

describe("mySubscriptions", () => {
  it("lists only the signed-in member's own PAID subscriptions", async () => {
    db.tables.creator_memberships = [membership(), membership({ member_id: O }), membership({ creator_id: C2, member_id: O }), membership({ creator_id: C2, billing: "free", period_end: null })];
    const out = await mySubscriptions(S);
    if (!out.ok) throw new Error("load");
    expect(out.items.map((i) => i.creator.id)).toEqual([C]);
    expect(writes("creator_memberships", "update")).toHaveLength(0);
  });

  it("states and dates are the server's: active, expired, refunded, removed, pending", async () => {
    db.tables.creator_memberships = [membership({ period_end: at(20) }), membership({ creator_id: C2, status: "ended", period_end: at(-1) })];
    db.tables.sub_purchases = [purchase({ creator_id: C2, status: "refunded", reversed_at: at(-1) })];
    let out = await mySubscriptions(S);
    if (!out.ok) throw new Error("load");
    const by = Object.fromEntries(out.items.map((i) => [i.creator.id, i]));
    expect(by[C]).toMatchObject({ state: "active", access: true, periodEnd: db.tables.creator_memberships[0]!.period_end, actions: { renew: false, cancel: true } });
    expect(by[C2]).toMatchObject({ state: "refunded", access: false });

    // a payment still in flight, with no access: shown as pending, never as active
    db.tables.creator_memberships = [membership({ period_end: at(-2) })];
    db.tables.sub_purchases = [purchase({ status: "initiated", created_at: at(-0.001), paid_at: null })];
    out = await mySubscriptions(S);
    if (!out.ok) throw new Error("load");
    expect(out.items[0]).toMatchObject({ state: "pending", access: false, label: "Payment pending" });

    db.tables.creator_memberships = [membership({ status: "removed" })];
    out = await mySubscriptions(S);
    if (!out.ok) throw new Error("load");
    expect(out.items[0]).toMatchObject({ state: "removed", access: false, actions: { renew: false, cancel: false, resume: false } });
  });

  it("a block either way shows no access, even with paid time left", async () => {
    db.tables.creator_memberships = [membership()];
    db.tables.blocks = [{ blocker_id: C, blocked_id: S }];
    const out = await mySubscriptions(S);
    if (!out.ok) throw new Error("load");
    expect(out.items[0]).toMatchObject({ state: "unavailable", access: false });
  });

  it("an expired subscription offers a renewal at the server's live price + fee", async () => {
    db.tables.creator_memberships = [membership({ period_end: at(-3) })];
    const out = await mySubscriptions(S);
    if (!out.ok) throw new Error("load");
    expect(out.items[0]).toMatchObject({ state: "expired", actions: { renew: true }, renewPrice: "$11.00 for 30 days" });
  });
});

// ─── Transactions and receipts ───────────────────────────────────────────────

describe("transactions and receipts", () => {
  it("only the member's own payments, and no provider ids, checkout links or failure internals", async () => {
    db.tables.sub_purchases = [purchase(), purchase({ subscriber_id: O }), purchase({ creator_id: C2, subscriber_id: O })];
    const out = await myTransactions(S);
    if (!out.ok) throw new Error("load");
    expect(out.items).toHaveLength(1);
    const json = JSON.stringify(out);
    for (const secret of ["SECRET_PROVIDER_REF", "checkout.paystack.com", "failure_source", "fx_minor", "provider_ref"]) expect(json).not.toContain(secret);
    // the member's own query was filtered by subscriber_id = the member
    expect(out.items[0]).toMatchObject({ state: "paid", receipt: true, creator: { id: C } });
  });

  it("pages are bounded and stable: no row twice, none skipped, even with equal timestamps", async () => {
    const same = at(-1);
    db.tables.sub_purchases = Array.from({ length: TX_PAGE * 2 + 5 }, (_, i) => purchase({ id: U(1000 + i), created_at: i % 3 ? at(-i) : same }));
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page: Awaited<ReturnType<typeof myTransactions>> = await myTransactions(S, cursor);
      if (!page.ok) throw new Error("page");
      expect(page.items.length).toBeLessThanOrEqual(TX_PAGE);
      seen.push(...page.items.map((x) => x.id));
      cursor = page.next;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(TX_PAGE * 2 + 5);
    expect(new Set(seen).size).toBe(seen.length);
    expect(await myTransactions(S, "not-a-cursor")).toMatchObject({ ok: false, status: 400 });
  });

  it("states stay distinct, and an open checkout is never a receipt", async () => {
    db.tables.sub_purchases = ["initiated", "failed", "paid", "refunded", "reversed", "disputed", "refund_due"].map((status, i) => purchase({ id: U(2000 + i), status, created_at: at(-0.001 * (i + 1)) }));
    const out = await myTransactions(S);
    if (!out.ok) throw new Error("load");
    const by = Object.fromEntries(out.items.map((t) => [t.id, t]));
    expect(by[U(2000)]).toMatchObject({ state: "pending", receipt: false, charged: null });
    expect(by[U(2001)]).toMatchObject({ state: "not_completed", receipt: false, charged: null });
    expect(new Set(out.items.map((t) => t.state)).size).toBe(7);
  });

  it("a receipt is the member's own row only — someone else's id answers like a missing one", async () => {
    const mine = purchase();
    const theirs = purchase({ subscriber_id: O });
    db.tables.sub_purchases = [mine, theirs];
    expect(await myReceipt(S, mine.id)).toMatchObject({ id: mine.id, receipt: true, charged: expect.stringMatching(/1,650\.00/) });
    expect(await myReceipt(S, theirs.id)).toBeNull();
    // the creator of that payment can't open it as a receipt either: it's the subscriber's page
    expect(await myReceipt(C, mine.id)).toBeNull();
    expect(await myReceipt(S, "x")).toBeNull();
  });

  it("an unverified return (the row is still 'initiated') never becomes a paid receipt", async () => {
    const p = purchase({ status: "initiated", paid_at: null, created_at: at(-0.001) });
    db.tables.sub_purchases = [p];
    expect(await myReceipt(S, p.id)).toMatchObject({ state: "pending", receipt: false, charged: null, periodStart: null });
  });
});

// ─── The creator's subscribers ───────────────────────────────────────────────

describe("creatorSubscribers", () => {
  it("only the creator's own subscribers, with status and dates and no money", async () => {
    db.tables.creator_memberships = [membership(), membership({ creator_id: C2, member_id: O }), membership({ member_id: O, cancelled_at: at(-1), cancel_period: 2 })];
    db.tables.sub_purchases = [purchase()];
    const out = await creatorSubscribers(C);
    if (!out.ok) throw new Error("load");
    expect(out.items.map((r) => r.person.id).sort()).toEqual([S, O].sort());
    expect(out.items.find((r) => r.person.id === O)).toMatchObject({ state: "ending", label: "Ending", access: true });
    const json = JSON.stringify(out);
    for (const k of ["price", "cents", "reference", "charged", "NGN", "SECRET"]) expect(json).not.toContain(k);
    // C2's subscriber isn't C's business
    expect((await creatorSubscribers(C2)).ok && (await creatorSubscribers(C2) as { items: { person: { id: string } }[] }).items.map((r) => r.person.id)).toEqual([O]);
  });

  it("'current' lists only paid-up subscribers; 'all' also shows removed, refunded and expired ones, labelled", async () => {
    db.tables.creator_memberships = [membership(), membership({ member_id: O, status: "removed" }), membership({ member_id: C2, status: "ended", period_end: at(-1) })];
    db.tables.sub_purchases = [purchase({ subscriber_id: C2, status: "refunded" })];
    const current = await creatorSubscribers(C);
    const all = await creatorSubscribers(C, { filter: "all" });
    if (!current.ok || !all.ok) throw new Error("load");
    expect(current.items.map((r) => r.person.id)).toEqual([S]);
    const labels = Object.fromEntries(all.items.map((r) => [r.person.id, r.label]));
    expect(labels).toEqual({ [S]: "Active", [O]: "Removed", [C2]: "Refunded" });
  });

  it("pages are bounded and stable", async () => {
    const n = SUBSCRIBERS_PAGE * 2 + 3;
    db.tables.profiles!.push(...Array.from({ length: n }, (_, i) => profile(U(5000 + i), `m${i}`)));
    db.tables.creator_memberships = Array.from({ length: n }, (_, i) => membership({ id: U(6000 + i), member_id: U(5000 + i), joined_at: i % 4 ? at(-i) : at(-1) }));
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page: Awaited<ReturnType<typeof creatorSubscribers>> = await creatorSubscribers(C, { cursor });
      if (!page.ok) throw new Error("page");
      expect(page.items.length).toBeLessThanOrEqual(SUBSCRIBERS_PAGE);
      seen.push(...page.items.map((r) => r.membershipId));
      cursor = page.next;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(n);
    expect(new Set(seen).size).toBe(n);
  });
});

// ─── Reminders ───────────────────────────────────────────────────────────────

describe("sweepSubReminders", () => {
  it("an eligible subscriber gets the due reminder once — a second run sends nothing", async () => {
    db.tables.creator_memberships = [membership({ period_end: at(2.5) })];
    expect(await sweepSubReminders()).toMatchObject({ sent: 1 });
    expect(push).toHaveBeenCalledTimes(1);
    expect(email).toHaveBeenCalledTimes(1);
    const [to, payload] = push.mock.calls[0] as unknown as [string, { title: string; body: string; url: string }];
    expect(to).toBe(S);
    expect(payload.url).toBe("/account/subscriptions");
    expect(payload.title).toContain("ends in 3 days");
    expect(`${payload.title} ${payload.body}`).not.toMatch(/will renew|auto-renew/i);
    expect(db.tables.sub_membership_reminders).toEqual([expect.objectContaining({ kind: "renew_3d", period_index: 2, member_id: S })]);

    expect(await sweepSubReminders()).toMatchObject({ sent: 0 });
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("two runs racing: the claim (primary key) lets only one send", async () => {
    db.tables.creator_memberships = [membership({ period_end: at(0.5) })];
    const [a, b] = await Promise.all([sweepSubReminders(), sweepSubReminders()]);
    expect(a.sent + b.sent).toBe(1);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("a renewed subscription gets no stale reminder; its new period gets its own", async () => {
    const row = membership({ period_end: at(2.5) });
    db.tables.creator_memberships = [row];
    await sweepSubReminders();
    // renewal: period_index moves on, the end moves 30 days out
    Object.assign(db.tables.creator_memberships[0]!, { period_index: 3, period_end: at(32.5) });
    expect(await sweepSubReminders()).toMatchObject({ sent: 0 });
    Object.assign(db.tables.creator_memberships[0]!, { period_end: at(2) });
    expect(await sweepSubReminders()).toMatchObject({ sent: 1 });
    expect(db.tables.sub_membership_reminders!.map((r) => `${String(r.period_index)}:${r.kind as string}`)).toEqual(["2:renew_3d", "3:renew_3d"]);
  });

  it("refunded/ended, removed, cancelled, blocked and suspended memberships are excluded", async () => {
    db.tables.profiles!.push(profile(U(7), "x7"), profile(U(8), "x8", { is_suspended: true }));
    db.tables.creator_memberships = [
      membership({ member_id: U(2), status: "ended", period_end: at(1.5) }),
      membership({ member_id: U(3), status: "removed", period_end: at(1.5) }),
      membership({ member_id: U(4), cancelled_at: at(-1), cancel_period: 2, period_end: at(1.5) }),
      membership({ member_id: U(7), period_end: at(1.5) }),
      membership({ member_id: U(8), period_end: at(1.5) }),
    ];
    db.tables.blocks = [{ blocker_id: U(7), blocked_id: C }];
    expect(await sweepSubReminders()).toMatchObject({ sent: 0 });
    expect(push).not.toHaveBeenCalled();
    expect(db.tables.sub_membership_reminders).toHaveLength(0);
  });

  it("no 'renew soon' from a creator who stopped selling; the expiry notice still says it ended", async () => {
    db.tables.creator_membership_settings = [{ creator_id: C, sub_active: false, sub_price_cents: 1000 }];
    db.tables.creator_memberships = [membership({ period_end: at(1.5) }), membership({ member_id: O, period_end: at(-0.5) })];
    expect(await sweepSubReminders()).toMatchObject({ sent: 1 });
    const [to, payload] = push.mock.calls[0] as unknown as [string, { title: string; body: string }];
    expect(to).toBe(O);
    expect(payload.title).toContain("has ended");
    expect(payload.body).not.toMatch(/renew/i);
  });

  it("before 0250 runs (no dedupe table), nothing is sent at all", async () => {
    db.failOn.sub_membership_reminders = "relation does not exist";
    db.tables.creator_memberships = [membership({ period_end: at(2.5) })];
    expect(await sweepSubReminders()).toMatchObject({ sent: 0, skipped: "pending_migration" });
    expect(push).not.toHaveBeenCalled();
    expect(email).not.toHaveBeenCalled();
  });
});
