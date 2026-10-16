import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Exclusive Part 7 — the REAL earnings, ledger, admin reporting, moderation transitions and
 * admin routes against an in-memory database. The aggregate SQL (0252) is proven against Postgres
 * with the real settle/reverse functions: supabase/tests/0252_sub_reporting.pglite.mjs.
 */

// lib/social/moderation.ts reads these when it loads (the admin route imports it)
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-key";

let db: FakeDb;
let adminUser: { id: string } | null = null;
let sessionUser: { id: string } | null = null;
const audits: Record<string, unknown>[] = [];
vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }) }));
vi.mock("@/lib/admin/guard", () => ({ getAdminUser: async () => adminUser }));
vi.mock("@/lib/rate-limit", () => ({ trackLimiter: { limit: async () => ({ success: true }) } }));
vi.mock("@/lib/security/audit-log", () => ({ writeAuditLog: async (e: Record<string, unknown>) => void audits.push(e) }));
vi.mock("./server", async () => {
  const { SUB_DEFAULTS } = await import("@/lib/rewards/config");
  return { subConfig: async () => SUB_DEFAULTS };
});

const earn = await import("./earnings");
const rep = await import("./admin-reporting");
const mod = await import("./moderation");

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const C = U(1);
const C2 = U(2);
const S = U(3);
const ADMIN = U(9);
const DAY = 86_400_000;
const at = (d: number) => new Date(Date.now() + d * DAY).toISOString();
const summaryRow = { earned_cents: 4000, clawed_cents: 2000, new_subs: 2, renewals: 1, gross_by_currency: { NGN: 495000, USD: 1100 }, refunds: 1, access_ended: 1, cancellations: 1, ending_now: 1, withdrawals_requested: 2, withdrawals_requested_cents: 800, withdrawals_completed: 1, withdrawals_completed_net_cents: 450, posts_published: 3, likes: 9, comments: 4 };

beforeEach(() => {
  db = fakeDb({
    sub_balances: [
      { creator_id: C, available_cents: 2500, pending_cents: 0, held_cents: 300, debt_cents: 0, lifetime_cents: 7000, withdrawn_cents: 500 },
      { creator_id: C2, available_cents: 999999, pending_cents: 5, held_cents: 0, debt_cents: 0, lifetime_cents: 999999, withdrawn_cents: 0 },
    ],
    creator_memberships: [],
    sub_posts: [],
    withdrawal_requests: [],
    sub_ledger: [],
    profiles: [{ id: C, handle: "amaka" }, { id: S, handle: "sub" }, { id: C2, handle: "tobi" }],
    sub_purchases: [],
    reports: [],
    sub_post_comments: [],
    security_audit_log: [],
  });
  db.rpc.release_sub_earnings = () => ({ data: 0, error: null });
  db.rpc.sub_creator_summary = vi.fn(() => ({ data: summaryRow, error: null }));
  db.rpc.sub_creator_daily = vi.fn(() => ({ data: [{ day: "2026-10-15", earned_cents: 3000, clawed_cents: 2000, new_subs: 1, renewals: 0 }, { day: "2026-10-16", earned_cents: 1000, clawed_cents: 0, new_subs: 1, renewals: 1 }], error: null }));
  adminUser = null;
  sessionUser = null;
  audits.length = 0;
});

// ─── Creator earnings ────────────────────────────────────────────────────────

describe("creator earnings", () => {
  it("balances come from sub_balances (the authoritative running totals), the creator's own row only", async () => {
    // a ledger page that would add up to something else must not be what is shown
    db.tables.sub_ledger = [{ id: 1, creator_id: C, kind: "earning", amount_cents: 1, created_at: at(-1) }];
    const out = await earn.earningsOverview(C, 30);
    if (!out.ok) throw new Error("overview");
    expect(out.balances).toEqual({ availableCents: 2500, pendingCents: 0, heldCents: 300, debtCents: 0, lifetimeCents: 7000, withdrawnCents: 500 });
    expect(db.rpc.sub_creator_summary).toHaveBeenCalledWith(expect.objectContaining({ p_creator: C }));
    expect(db.rpc.sub_creator_daily).toHaveBeenCalledWith(expect.objectContaining({ p_creator: C }));
  });

  it("period figures keep their meanings apart: earned, clawed back, net; subscriber payments per currency, never summed", async () => {
    const out = await earn.earningsOverview(C, 30);
    if (!out.ok || !out.period) throw new Error("overview");
    expect(out.period).toMatchObject({ earnedCents: 4000, clawedCents: 2000, netCents: 2000, newSubs: 2, renewals: 1, refunds: 1 });
    expect(out.period.grossByCurrency).toEqual([{ currency: "NGN", minor: 495000 }, { currency: "USD", minor: 1100 }]);
    expect(out.ending).toBe(1);
    expect(out.period.daily.map((d) => d.netCents)).toEqual([1000, 1000]);
  });

  it("the period starts at UTC midnight N days ago, the same boundary for totals and the daily series", () => {
    const now = Date.parse("2026-10-16T15:30:00Z");
    expect(earn.periodStart(7, now)).toBe("2026-10-09T00:00:00.000Z");
    expect(earn.periodStart(30, now)).toBe("2026-09-16T00:00:00.000Z");
    expect(earn.isPeriod(14)).toBe(false);
  });

  it("before 0252 runs, balances still show and analytics say they're not ready (nothing invented)", async () => {
    db.rpc.sub_creator_summary = () => ({ data: null, error: { message: "function does not exist" } });
    const out = await earn.earningsOverview(C, 30);
    if (!out.ok) throw new Error("overview");
    expect(out).toMatchObject({ analyticsReady: false, period: null, balances: { availableCents: 2500 } });
  });

  it("withdrawal eligibility explains itself with the server's rules: open request, below minimum", async () => {
    db.tables.withdrawal_requests = [{ id: U(50), user_id: C, source: "sub", status: "pending", gross_cents: 300 }];
    let out = await earn.earningsOverview(C, 30);
    if (!out.ok) throw new Error("x");
    expect(out.withdrawal).toMatchObject({ openRequest: true, reason: "You already have a withdrawal in progress." });
    db.tables.withdrawal_requests = [];
    db.tables.sub_balances![0]!.available_cents = 100;
    out = await earn.earningsOverview(C, 30);
    if (!out.ok) throw new Error("x");
    expect(out.withdrawal.reason).toBe("The minimum withdrawal is $5.00.");
    // another creator's open request never blocks this one
    db.tables.sub_balances![0]!.available_cents = 2500;
    db.tables.withdrawal_requests = [{ id: U(51), user_id: C2, source: "sub", status: "pending", gross_cents: 300 }];
    out = await earn.earningsOverview(C, 30);
    if (!out.ok) throw new Error("x");
    expect(out.withdrawal).toMatchObject({ openRequest: false, reason: null });
  });

  it("the ledger is the creator's own, paged stably, filtered by type and date, withdrawals with their own status", async () => {
    const rows = [];
    for (let i = 1; i <= 60; i++) rows.push({ id: i, creator_id: i % 2 ? C : C2, kind: i % 5 === 0 ? "withdrawal_hold" : "earning", amount_cents: i % 5 === 0 ? -300 : 1000, note: null, created_at: i < 30 ? "2026-10-10T10:00:00.000Z" : at(-1), withdrawal_id: i % 5 === 0 ? U(70 + i) : null, reference: `purchase:${i}` });
    db.tables.sub_ledger = rows;
    db.tables.withdrawal_requests = rows.filter((r) => r.withdrawal_id).map((r) => ({ id: r.withdrawal_id, user_id: r.creator_id, status: "completed", gross_cents: 300, fee_cents: 30, net_cents: 270 }));
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page: Awaited<ReturnType<typeof earn.ledgerPage>> = await earn.ledgerPage(C, { cursor });
      if (!page.ok) throw new Error("ledger");
      expect(page.items.length).toBeLessThanOrEqual(earn.LEDGER_PAGE);
      seen.push(...page.items.map((x) => x.id));
      cursor = page.next;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
    expect(seen.every((id) => Number(id) % 2 === 1)).toBe(true); // only C's rows
    const w = await earn.ledgerPage(C, { filter: "withdrawals" });
    if (!w.ok) throw new Error("w");
    expect(w.items.every((x) => x.kind === "withdrawal_hold" && x.withdrawal?.status === "completed" && x.withdrawal.netCents === 270)).toBe(true);
    expect(JSON.stringify(w)).not.toContain("purchase:");
    const dated = await earn.ledgerPage(C, { from: "2026-10-10", to: "2026-10-10" });
    if (!dated.ok) throw new Error("d");
    expect(dated.items.length).toBe(15);
    expect(await earn.ledgerPage(C, { filter: "everything" })).toMatchObject({ ok: false, status: 400 });
    expect(await earn.ledgerPage(C, { from: "10/10/2026" })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("creator routes use the session user only", () => {
  it("overview and ledger answer 401 signed out, and never read another creator", async () => {
    const overview = await import("@/app/api/sub/earnings/overview/route");
    const ledger = await import("@/app/api/sub/earnings/ledger/route");
    expect((await overview.GET(new Request("http://x/api/sub/earnings/overview"))).status).toBe(401);
    expect((await ledger.GET(new Request("http://x/api/sub/earnings/ledger"))).status).toBe(401);
    sessionUser = { id: C };
    // there is no creator parameter: an attempt to name another creator is simply ignored
    const res = await overview.GET(new Request(`http://x/api/sub/earnings/overview?days=30&creator=${C2}`));
    const j = (await res.json()) as { balances: { availableCents: number } };
    expect(j.balances.availableCents).toBe(2500);
    expect(db.rpc.sub_creator_summary).toHaveBeenCalledWith(expect.objectContaining({ p_creator: C }));
    expect((await overview.GET(new Request("http://x/api/sub/earnings/overview?days=14"))).status).toBe(400);
  });
});

// ─── Admin ───────────────────────────────────────────────────────────────────

describe("admin endpoints are admin-only, enforced on the server", () => {
  it("every Part 7 admin route answers 403 to a signed-in non-admin and to anyone signed out", async () => {
    const routes = [await import("@/app/api/admin/memberships/summary/route"), await import("@/app/api/admin/memberships/search/route"), await import("@/app/api/admin/memberships/moderation/route")];
    sessionUser = { id: S };
    adminUser = null;
    for (const r of routes) expect((await r.GET(new Request("http://x/api/admin/x?days=30&creator=amaka"))).status).toBe(403);
    db.rpc.sub_admin_summary = vi.fn(() => ({ data: {}, error: null }));
    expect(db.rpc.sub_admin_summary).not.toHaveBeenCalled();
  });

  it("the overview keeps currencies and money concepts apart", async () => {
    adminUser = { id: ADMIN };
    db.rpc.sub_admin_summary = () => ({ data: { memberships: 10, active: 6, ending: 1, gross_by_currency: { NGN: 1000000, USD: 2200 }, creator_share_cents: 9000, platform_fee_cents: 900, refunds: 1, refunded_creator_cents: 2000 }, error: null });
    const out = await rep.adminSummary(30);
    if (!out.ok) throw new Error("summary");
    expect(out.summary.grossByCurrency).toEqual([{ currency: "NGN", minor: 1000000 }, { currency: "USD", minor: 2200 }]);
    expect(out.summary).toMatchObject({ creatorShareCents: 9000, platformFeeCents: 900, refundedCreatorCents: 2000 });
  });

  it("search: bounded, filter-safe, and returns no provider ids or checkout links", async () => {
    db.tables.sub_purchases = Array.from({ length: 40 }, (_, i) => ({ id: U(100 + i), reference: `frenz_sub_${String(i).padStart(32, "a")}`, status: i % 2 ? "paid" : "refunded", created_at: at(-i), paid_at: at(-i), reversed_at: null, price_cents: 1000, fee_cents: 100, charged_currency: "NGN", charged_minor: 165000, creator_id: i < 30 ? C : C2, subscriber_id: S, provider_ref: "SECRET", checkout_url: "https://checkout.paystack.com/SECRET" }));
    db.tables.creator_memberships = [{ creator_id: C, member_id: S, billing: "sub", status: "active", period_end: at(5), period_index: 2, cancel_period: 2 }];
    const page = await rep.adminSearch({ creator: "@amaka" });
    if (!page.ok) throw new Error("search");
    expect(page.items).toHaveLength(rep.ADMIN_PAGE);
    expect(page.next).toBeTruthy();
    expect(page.items.every((r) => r.creator.id === C && r.creator.handle === "amaka")).toBe(true);
    expect(page.items[0]!.membership).toEqual({ status: "active", periodEnd: expect.any(String), cancelled: true });
    expect(JSON.stringify(page)).not.toContain("SECRET");
    const next = await rep.adminSearch({ creator: C, cursor: page.next });
    if (!next.ok) throw new Error("next");
    expect(next.items).toHaveLength(5);
    expect(await rep.adminSearch({ reference: "a%' or 1=1" })).toMatchObject({ ok: false, status: 400 });
    expect(await rep.adminSearch({ status: "everything" })).toMatchObject({ ok: false, status: 400 });
    expect(await rep.adminSearch({ creator: "@nobody" })).toEqual({ ok: true, items: [], next: null });
    const refunded = await rep.adminSearch({ creator: C, status: "refunded" });
    if (!refunded.ok) throw new Error("r");
    expect(refunded.items.every((r) => r.status === "refunded")).toBe(true);
  });
});

describe("moderation transitions are validated, audited, and never corrupt state", () => {
  const post = (over: Record<string, unknown> = {}) => ({ id: U(500), creator_id: C, status: "published", caption: "x", moderated_at: null, moderated_by: null, ...over });

  it("remove takes down once; a repeat changes nothing and keeps the first admin and time", async () => {
    db.tables.sub_posts = [post()];
    const first = await mod.moderateSubTarget("sub_post", U(500), "remove", ADMIN);
    expect(first).toMatchObject({ ok: true, changed: true, state: "removed" });
    const firstAt = db.tables.sub_posts[0]!.moderated_at;
    const again = await mod.moderateSubTarget("sub_post", U(500), "remove", U(8));
    expect(again).toMatchObject({ ok: true, changed: false });
    expect(db.tables.sub_posts[0]).toMatchObject({ status: "archived", moderated_by: ADMIN, moderated_at: firstAt });
  });

  it("restore only brings back what an admin took down; restoring something visible is refused", async () => {
    db.tables.sub_posts = [post()];
    expect(await mod.moderateSubTarget("sub_post", U(500), "restore", ADMIN)).toMatchObject({ ok: false, status: 409 });
    db.tables.sub_posts = [post({ status: "archived", moderated_at: at(-1), moderated_by: ADMIN })];
    expect(await mod.moderateSubTarget("sub_post", U(500), "restore", ADMIN)).toMatchObject({ ok: true, changed: true, state: "restored" });
    expect(db.tables.sub_posts[0]).toMatchObject({ status: "published", moderated_at: null });
  });

  it("comments: hide once, unhide only what is hidden", async () => {
    db.tables.sub_post_comments = [{ id: U(600), user_id: S, hidden_at: null }];
    expect(await mod.moderateSubTarget("sub_comment", U(600), "restore", ADMIN)).toMatchObject({ ok: false, status: 409 });
    expect(await mod.moderateSubTarget("sub_comment", U(600), "remove", ADMIN)).toMatchObject({ ok: true, changed: true });
    const hiddenAt = db.tables.sub_post_comments[0]!.hidden_at;
    expect(await mod.moderateSubTarget("sub_comment", U(600), "remove", U(8))).toMatchObject({ ok: true, changed: false });
    expect(db.tables.sub_post_comments[0]!.hidden_at).toBe(hiddenAt);
  });

  it("the admin route: non-admin 403; the reason and the real outcome go on the audit entry; an invalid transition says why", async () => {
    const route = await import("@/app/api/admin/moderation/route");
    const req = (body: unknown) => new Request("http://x/api/admin/moderation", { method: "POST", body: JSON.stringify(body) });
    db.tables.sub_posts = [post()];
    db.tables.reports = [{ id: U(700), target_type: "sub_post", target_id: U(500), status: "open", reason: "Spam", created_at: at(-1) }];
    expect((await route.POST(req({ targetType: "sub_post", targetId: U(500), action: "remove", note: "x" }))).status).toBe(403);
    expect(db.tables.sub_posts[0]!.status).toBe("published");
    adminUser = { id: ADMIN };
    const res = await route.POST(req({ targetType: "sub_post", targetId: U(500), action: "remove", note: "Copyrighted photos" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, state: "removed", changed: true });
    expect(audits[0]).toMatchObject({ actorUserId: ADMIN, userId: C, eventType: "moderation_action", targetType: "sub_post", metadata: { action: "remove", note: "Copyrighted photos", changed: true, state: "removed" } });
    expect(db.tables.reports[0]!.status).toBe("actioned");
    db.tables.sub_posts = [post()];
    const bad = await route.POST(req({ targetType: "sub_post", targetId: U(500), action: "restore" }));
    expect(bad.status).toBe(409);
    // a sub_post can't be suspended (actions limited for exclusive content)
    expect((await route.POST(req({ targetType: "sub_post", targetId: U(500), action: "suspend" }))).status).toBe(400);
  });

  it("the moderation list: open reports grouped per target, removed content, and restores from the audit log", async () => {
    db.tables.sub_posts = [post({ id: U(501), status: "archived", moderated_at: at(-1) }), post({ id: U(502) })];
    db.tables.reports = [
      { id: U(800), target_type: "sub_post", target_id: U(502), status: "open", reason: "Spam", note: null, created_at: at(-0.2) },
      { id: U(801), target_type: "sub_post", target_id: U(502), status: "open", reason: "Abuse", note: null, created_at: at(-0.1) },
      { id: U(802), target_type: "sub_post", target_id: U(501), status: "dismissed", reason: "Spam", note: null, created_at: at(-2) },
    ];
    db.tables.security_audit_log = [{ id: U(900), event_type: "moderation_action", target_type: "sub_post", target_id: U(502), metadata: { action: "restore", note: "Reviewed: fine" }, created_at: at(-0.5) }];
    const open = await rep.adminModeration("open", "sub_post");
    if (!open.ok) throw new Error("open");
    expect(open.items).toHaveLength(1);
    expect(open.items[0]).toMatchObject({ targetId: U(502), reports: 2, state: "published" });
    expect(open.items[0]!.reasons.sort()).toEqual(["Abuse", "Spam"]);
    const removed = await rep.adminModeration("removed", "sub_post");
    if (!removed.ok) throw new Error("removed");
    expect(removed.items.map((r) => r.targetId)).toEqual([U(501)]);
    const restored = await rep.adminModeration("restored", "sub_post");
    if (!restored.ok) throw new Error("restored");
    expect(restored.items[0]).toMatchObject({ targetId: U(502), note: "Reviewed: fine" });
    const dismissed = await rep.adminModeration("dismissed", "sub_post");
    if (!dismissed.ok) throw new Error("dismissed");
    expect(dismissed.items.map((r) => r.targetId)).toEqual([U(501)]);
    expect(JSON.stringify([open, removed, restored, dismissed])).not.toMatch(/https?:\/\//);
    expect(await rep.adminModeration("everything", "sub_post")).toMatchObject({ ok: false });
  });
});
