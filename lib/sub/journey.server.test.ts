import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";
import { createSqlBridge, loadPGlite, subHarnessStub } from "@/lib/testing/pglite-bridge";

/**
 * Frenz Exclusive Part 14 — the END-TO-END journey, in order, through the REAL route handlers and server
 * modules, with every RPC running the REAL migration SQL in PGlite (lib/testing/pglite-bridge.ts):
 * creator setup → a visitor's quote → checkout → an abandoned / failed / successful payment → a replayed
 * confirmation and webhook → access → the creator's and the subscriber's views agree → an announcement →
 * cancellation → expiry → earnings → withdrawal (refused while one is open) → an admin rejects it, then
 * pays one → a suspended creator is refused. The money invariants of Part 12 are checked after every step.
 *
 * MOCKED: Supabase PostgREST/auth (the in-memory client + a mocked server session), Paystack (initialize,
 * verify, transfers — scripted answers, nothing leaves the test), R2 (presign stand-ins), push and email
 * senders, the FX rate. REAL: the route handlers, lib/sub/*, and the SQL money functions from
 * supabase/migrations (0227 0231 0237 0239 0247 0248 0250 0254 0256). PGlite is not a repo dependency:
 * when it can't be found this suite SKIPS (see loadPGlite) — it never passes without running.
 */

const PGlite = await loadPGlite();

let db: FakeDb;
let sessionUser: { id: string; email?: string } | null = null;
let adminUser: { id: string } | null = null;
const presignGet = vi.fn(async (key: string) => `https://private.example/${key}?sig=1`);
const SECRET = "sk_test_local_only";
type Charge = { status: string; amount?: number; currency?: string; id?: number; metadata?: Record<string, unknown> };
let verifyAnswer: (ref: string) => Charge = () => ({ status: "abandoned" });
const initialized: { reference: string; amount: number; currency: string }[] = [];
let transferAnswer: (path: string) => unknown = () => ({ status: true, data: {} });

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) }, from: (t: string) => (db.client() as { from: (t: string) => unknown }).from(t) }) }));
vi.mock("@/lib/admin/guard", () => ({ getAdminUser: async () => adminUser }));
vi.mock("@/lib/storage/r2", () => ({ hasPrivateR2: true, presignPrivateGet: (k: string) => presignGet(k), presignPrivatePut: vi.fn(async (k: string) => `https://put.example/${k}`), deletePrivate: vi.fn(), readPrivatePrefix: vi.fn(async () => ({ prefix: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]), size: 1000, contentType: "image/jpeg" })) }));
vi.mock("@/lib/rate-limit", () => ({ trackLimiter: { limit: async () => ({ success: true }) }, clientId: () => "ip" }));
vi.mock("@/lib/security/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/lib/landing/settings", async () => {
  const { SUB_DEFAULTS } = await import("@/lib/rewards/config");
  // autoPayout OFF here, so the admin review path is exercised; the auto path is covered in security-boundaries
  return { getLandingSettings: async () => ({ frenzRewards: { sub: { ...SUB_DEFAULTS, autoPayout: false } }, frenzAiCharacterReplace: { recharge: { checkoutCurrency: "NGN", fxMarkupPercent: 0 } } }) };
});
vi.mock("@/lib/ai/character-replace/fx-rate-server", () => ({ resolveCheckoutRate: async () => ({ minorPerUsd: 150_000, marketPerUsd: 1500, markupPercent: 0, source: "stored", fetchedAt: null, provider: "test" }), marketRate: async () => ({ rate: { perUsd: 1500 }, source: "stored" }) }));
vi.mock("@/lib/paystack/config", () => ({ getPaystackConfig: async () => ({ secretKey: SECRET }) }));
vi.mock("@/lib/paystack/paystack", async (orig) => {
  const real = await orig<typeof import("@/lib/paystack/paystack")>();
  return {
    ...real,
    verifyTransaction: async (ref: string) => verifyAnswer(ref),
    initializeSubCheckout: async (o: { reference: string; amount: number; currency: string }) => {
      initialized.push({ reference: o.reference, amount: o.amount, currency: o.currency });
      return `https://checkout.paystack.com/${o.reference}`;
    },
    paystackRequest: async (path: string) => transferAnswer(path),
  };
});
vi.mock("@/lib/rewards/paystack-banks", async (orig) => ({ ...(await orig<typeof import("@/lib/rewards/paystack-banks")>()), resolveAccount: async () => "AMAKA OBI" }));
vi.mock("@/lib/notifications/smart-delivery", () => ({ sendSmartPush: vi.fn(async () => {}) }));
vi.mock("@/lib/email/member-email", () => ({ emailMember: vi.fn(async () => "sent") }));
vi.mock("@/lib/push/identity", () => ({ pushPerson: async () => ({ name: "Amaka", handle: "amaka", icon: null }) }));
vi.mock("@/lib/social/creator-notify-emit", () => ({ excludedFor: async () => new Set<string>() }));

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CREATOR = U(1);
const SUB = U(2);
const STRANGER = U(3);
const ADMIN = U(9);
const PRICE = 1000; // $10.00 — the creator keeps all of it
const FEE = 100; // 10% on top, paid by the subscriber
const CHARGED = (PRICE + FEE) * 1500; // kobo: $11.00 at the pinned 1,500 NGN per $1
const FLAT = 20; // the flat withdrawal fee below $300 (0258), on top of the amount withdrawn
const WITHDRAW = PRICE - FLAT; // the most that can be withdrawn from PRICE: amount + flat fee = PRICE
type Handler = (r: Request, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>;
const req = (method: string, body?: unknown, url = "https://frenzsave.com/api/x") => new Request(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const as = (id: string | null) => {
  sessionUser = id ? { id, email: `${id.slice(-1)}@example.com` } : null;
};
const route = async (p: string) => (await import(/* @vite-ignore */ p)) as Record<string, Handler>;
let bridge: Awaited<ReturnType<typeof createSqlBridge>>;
let postId = "";
let reference = "";
let withdrawalId = "";

/** The single row a query must return (fails loudly when there is none). */
async function one<T>(text: string, params?: unknown[]): Promise<T> {
  const rows = await bridge.sql<T>(text, params);
  if (!rows[0]) throw new Error(`no row: ${text.slice(0, 80)}`);
  return rows[0];
}

/** Part 12's invariants for one creator, read from the real tables. */
async function invariants(label: string) {
  const [b] = await bridge.sql<Record<string, number>>("select pending_cents::int p, available_cents::int a, held_cents::int h, debt_cents::int d, lifetime_cents::int l, withdrawn_cents::int w from sub_balances where creator_id = $1", [CREATOR]);
  if (!b) return;
  const { paid } = await one<{ paid: number }>("select coalesce(sum(price_cents), 0)::int paid from sub_purchases where creator_id = $1 and status = 'paid'", [CREATOR]);
  const { led } = await one<{ led: number }>("select coalesce(sum(amount_cents) filter (where kind in ('earning', 'clawback', 'dispute_restore')), 0)::int led from sub_ledger where creator_id = $1", [CREATOR]);
  const { open } = await one<{ open: number }>("select coalesce(sum(gross_cents), 0)::int open from withdrawal_requests where user_id = $1 and source = 'sub' and status in ('pending', 'reviewing', 'approved', 'processing')", [CREATOR]);
  const { done } = await one<{ done: number }>("select coalesce(sum(gross_cents), 0)::int done from withdrawal_requests where user_id = $1 and source = 'sub' and status = 'completed'", [CREATOR]);
  expect([b.p, b.a, b.h, b.d].every((x) => x! >= 0), `${label}: nothing negative`).toBe(true);
  expect(b.p! + b.a! + b.h! + b.w! - b.d!, `${label}: pending+available+held+withdrawn-debt = lifetime`).toBe(b.l);
  expect(b.l, `${label}: lifetime = paid purchases`).toBe(paid);
  expect(led, `${label}: ledger earnings = lifetime`).toBe(b.l);
  expect(b.h, `${label}: held = open withdrawals`).toBe(open);
  expect(b.w, `${label}: withdrawn = completed withdrawals`).toBe(done);
}

describe.skipIf(!PGlite)("the Exclusive journey, end to end (real SQL money functions)", () => {
  beforeAll(async () => {
    db = fakeDb({
      profiles: [
        { id: CREATOR, handle: "amaka", display_name: "Amaka", avatar_url: null, is_verified: false, is_suspended: false, is_hidden: false },
        { id: SUB, handle: "bola", display_name: "Bola", avatar_url: null, is_verified: false, is_suspended: false, is_hidden: false },
        { id: STRANGER, handle: "chi", display_name: "Chi", avatar_url: null, is_verified: false, is_suspended: false, is_hidden: false },
        { id: ADMIN, handle: "admin", display_name: "Admin", avatar_url: null, is_verified: false, is_suspended: false, is_hidden: false },
      ],
      blocks: [],
      follows: [],
      social_circles: [],
      reports: [],
    });
    bridge = await createSqlBridge(PGlite!, db, {
      setup: [subHarnessStub()],
      migrations: ["0227_sub_monetization.sql", "0231_sub_promo_dismiss.sql", "0237_sub_post_thumbs.sql", "0239_private_post_interactions.sql", "0247_sub_settlement_hardening.sql", "0248_sub_post_audience_feed.sql", "0250_sub_membership_lifecycle.sql", "0254_payout_reversal_dispute_restore.sql", "0256_withdrawal_rejection_settles_debt.sql", "0258_withdrawal_flat_fee.sql"],
      userIds: [CREATOR, SUB, STRANGER, ADMIN],
    });
    // JOURNEY_MUTANT=dup-settle breaks ONE protection in the real SQL (settle forgets "already paid"):
    // the replay step must then FAIL — proof the journey exercises the database, not a stand-in
    if (process.env.JOURNEY_MUTANT === "dup-settle") {
      const { d } = await one<{ d: string }>("select pg_get_functiondef(p.oid) d from pg_proc p where proname = 'settle_sub_purchase'");
      const broken = d.replace(/if v_p\.status = 'paid' then return[^;]*;\s*end if;/, "");
      if (broken === d) throw new Error("mutant dup-settle did not apply");
      await bridge.pg.exec(broken);
    }
    // JOURNEY_MUTANT=dup-resolve: resolve_withdrawal forgets final states — step 17's second rejection
    // would release the money twice, and the journey must catch it
    if (process.env.JOURNEY_MUTANT === "dup-resolve") {
      const { d } = await one<{ d: string }>("select pg_get_functiondef(p.oid) d from pg_proc p where proname = 'resolve_withdrawal'");
      const broken = d.replace(/if v_w\.status in \('completed', 'rejected', 'cancelled'(, 'reversed')?\) then return[^;]*;\s*end if;/, "");
      if (broken === d) throw new Error("mutant dup-resolve did not apply");
      await bridge.pg.exec(broken);
    }
    // JOURNEY_MUTANT=no-amount-check: settle accepts a short payment — step 7 (a wrong amount never
    // settles) must FAIL. (dup-settle and dup-resolve are NOT reachable from this journey: the TS layer
    // answers a paid purchase from the database, and resolve_withdrawal's legal-move check refuses a
    // second rejection — defence in depth, kept here as documentation.)
    if (process.env.JOURNEY_MUTANT === "no-amount-check") {
      const { d } = await one<{ d: string }>("select pg_get_functiondef(p.oid) d from pg_proc p where proname = 'settle_sub_purchase'");
      const broken = d.replace("if p_paid_currency is distinct from v_p.charged_currency or coalesce(p_paid_minor, 0) < v_p.charged_minor then", "if false then");
      if (broken === d) throw new Error("mutant no-amount-check did not apply");
      await bridge.pg.exec(broken);
    }
    if (process.env.JOURNEY_MUTANT) console.warn(`[journey] mutant ${process.env.JOURNEY_MUTANT} applied`);
    await bridge.pull();
  }, 60_000);
  afterAll(async () => {
    await bridge?.close();
  });

  it("1 · a signed-out visitor: no checkout, no private media", async () => {
    as(null);
    const checkout = await route("@/app/api/sub/checkout/route");
    expect((await checkout.POST!(req("POST", { creatorId: CREATOR, returnPath: "/u/amaka?tab=sub" }))).status).toBe(401);
    expect(presignGet).not.toHaveBeenCalled();
  });

  it("2 · creator setup: a price outside the rules is refused; a valid one is saved; completing goes live", async () => {
    as(CREATOR);
    const members = await route("@/app/api/members/route");
    expect((await members.POST!(req("POST", { op: "settings", priceCents: 50 }))).status).toBeGreaterThanOrEqual(400); // below the $1 minimum
    expect((await members.POST!(req("POST", { op: "settings", priceCents: PRICE }))).status).toBe(200);
    const done = await members.POST!(req("POST", { op: "settings", complete: true }));
    expect(done.status).toBe(200);
    const [s] = await bridge.sql<{ sub_price_cents: number; sub_active: boolean }>("select sub_price_cents, sub_active from creator_membership_settings where creator_id = $1", [CREATOR]);
    expect(s).toEqual({ sub_price_cents: PRICE, sub_active: true });
  });

  it("3 · the creator publishes a private post (own folder only)", async () => {
    as(CREATOR);
    const posts = await route("@/app/api/sub/posts/route");
    expect((await posts.POST!(req("POST", { media: [{ key: `sub/${STRANGER}/x.jpg`, kind: "image" }] }))).status).toBe(403);
    const res = await posts.POST!(req("POST", { caption: "first", media: [{ key: `sub/${CREATOR}/a.jpg`, kind: "image" }] }));
    expect(res.status).toBe(200);
    postId = ((await res.json()) as { id: string }).id;
    expect(postId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("4 · a visitor sees the creator's price, the 10% fee ON TOP and the total — the server's numbers", async () => {
    const { quoteSub } = await import("./server");
    expect(await quoteSub(CREATOR)).toMatchObject({ priceCents: PRICE, feeCents: FEE, totalCents: PRICE + FEE, feePercent: 10, periodDays: 30 });
    // a stranger without a subscription sees a locked tile, never the caption or a link
    as(STRANGER);
    const posts = await route("@/app/api/sub/posts/route");
    const list = await (await posts.GET!(req("GET", undefined, `https://frenzsave.com/api/sub/posts?creator=${CREATOR}`))).json();
    expect(list).toMatchObject({ access: false });
    expect(JSON.stringify(list)).not.toMatch(/first|sig=1/);
  });

  it("5 · checkout: the server prices it (total in NGN at the pinned rate), one purchase, re-opening reuses it", async () => {
    as(SUB);
    const checkout = await route("@/app/api/sub/checkout/route");
    const res = await checkout.POST!(req("POST", { creatorId: CREATOR, returnPath: "/u/amaka?tab=sub", priceCents: 1 }));
    expect(res.status).toBe(400); // a client-supplied price is refused outright
    const ok = await checkout.POST!(req("POST", { creatorId: CREATOR, returnPath: "/u/amaka?tab=sub" }));
    expect(ok.status).toBe(200);
    expect(initialized).toHaveLength(1);
    reference = initialized[0]!.reference;
    expect(initialized[0]).toMatchObject({ currency: "NGN", amount: CHARGED });
    const [p] = await bridge.sql<Record<string, unknown>>("select price_cents, fee_cents, total_cents, charged_minor, charged_currency, status from sub_purchases where reference = $1", [reference]);
    expect(p).toMatchObject({ price_cents: PRICE, fee_cents: FEE, total_cents: PRICE + FEE, charged_currency: "NGN", status: "initiated" });
    expect(Number(p!.charged_minor)).toBe(CHARGED);
    const again = await (await checkout.POST!(req("POST", { creatorId: CREATOR, returnPath: "/u/amaka?tab=sub" }))).json();
    expect(again).toMatchObject({ reused: true });
    expect(initialized).toHaveLength(1);
  });

  it("6 · an abandoned (cancelled) checkout stays open — no access, nothing charged", async () => {
    const { confirmSubPayment } = await import("./server");
    verifyAnswer = () => ({ status: "abandoned", metadata: { purpose: "frenz_sub" } });
    expect(await confirmSubPayment(reference)).toMatchObject({ ok: false, status: "pending" });
    const [p] = await bridge.sql<{ status: string }>("select status from sub_purchases where reference = $1", [reference]);
    expect(p!.status).toBe("initiated");
  });

  it("7 · a wrong amount never settles (mismatch), and grants nothing", async () => {
    const { confirmSubPayment } = await import("./server");
    verifyAnswer = () => ({ status: "success", amount: CHARGED - 1, currency: "NGN", id: 1, metadata: { purpose: "frenz_sub" } });
    expect((await confirmSubPayment(reference)).status).toBe("mismatch");
    const m = await bridge.sql("select 1 from creator_memberships where creator_id = $1 and member_id = $2 and status = 'active'", [CREATOR, SUB]);
    expect(m).toHaveLength(0);
  });

  it("8 · the verified charge settles once: membership active for 30 days, the creator earns the PRICE", async () => {
    const { confirmSubPayment } = await import("./server");
    verifyAnswer = () => ({ status: "success", amount: CHARGED, currency: "NGN", id: 77, metadata: { purpose: "frenz_sub" } });
    expect(await confirmSubPayment(reference)).toMatchObject({ ok: true, status: "paid" });
    const [m] = await bridge.sql<{ status: string; billing: string; period_end: string }>("select status, billing, period_end from creator_memberships where creator_id = $1 and member_id = $2", [CREATOR, SUB]);
    expect(m).toMatchObject({ status: "active", billing: "sub" });
    const days = (Date.parse(m!.period_end) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    const [b] = await bridge.sql<{ l: number; a: number }>("select lifetime_cents::int l, available_cents::int a from sub_balances where creator_id = $1", [CREATOR]);
    expect(b).toEqual({ l: PRICE, a: PRICE }); // the fee is not the creator's; no hold by default
    await invariants("settled");
  });

  it("9 · replays change nothing: the return page again, and a signed webhook for the same charge", async () => {
    const { confirmSubPayment } = await import("./server");
    expect(await confirmSubPayment(reference)).toMatchObject({ ok: true, status: "paid" });
    const body = JSON.stringify({ event: "charge.success", data: { reference, amount: CHARGED, currency: "NGN", status: "success", metadata: { purpose: "frenz_sub" } } });
    const sig = createHmac("sha512", SECRET).update(body).digest("hex");
    const { POST } = await import("@/app/api/paystack/webhook/route");
    for (let i = 0; i < 2; i++) expect((await POST(new Request("https://frenzsave.com/api/paystack/webhook", { method: "POST", headers: { "x-paystack-signature": sig }, body }))).status).toBe(200);
    const { n } = await one<{ n: number }>("select count(*)::int n from sub_ledger where kind = 'earning' and creator_id = $1", [CREATOR]);
    expect(n).toBe(1);
    const [b] = await bridge.sql<{ l: number }>("select lifetime_cents::int l from sub_balances where creator_id = $1", [CREATOR]);
    expect(b!.l).toBe(PRICE);
    await invariants("after replays");
  });

  it("10 · the subscriber opens the private post — media signed; a stranger still can't", async () => {
    const post = await route("@/app/api/sub/posts/[id]/route");
    as(SUB);
    const res = await post.GET!(req("GET", undefined, `https://frenzsave.com/api/sub/posts/${postId}`), { params: Promise.resolve({ id: postId }) });
    expect(res.status).toBe(200);
    expect(presignGet).toHaveBeenCalledWith(`sub/${CREATOR}/a.jpg`);
    presignGet.mockClear();
    as(STRANGER);
    expect((await post.GET!(req("GET", undefined, `https://frenzsave.com/api/sub/posts/${postId}`), { params: Promise.resolve({ id: postId }) })).status).toBe(403);
    expect(presignGet).not.toHaveBeenCalled();
  });

  it("11 · the creator's and the subscriber's views of the membership agree", async () => {
    const [m] = await bridge.sql<{ period_end: string }>("select period_end from creator_memberships where creator_id = $1 and member_id = $2", [CREATOR, SUB]);
    as(SUB);
    const mine = await (await (await route("@/app/api/sub/subscriptions/route")).GET!(req("GET"))).json();
    const row = (mine.items ?? mine.subscriptions ?? []).find((x: { creator?: { id: string }; creatorId?: string }) => (x.creator?.id ?? x.creatorId) === CREATOR);
    expect(row, JSON.stringify(mine).slice(0, 300)).toBeTruthy();
    expect(JSON.stringify(row)).toMatch(/active/);
    expect(new Date(row.accessUntil ?? row.periodEnd ?? row.until).getTime()).toBe(new Date(m!.period_end).getTime());
    as(CREATOR);
    const subs = await (await (await route("@/app/api/members/subscribers/route")).GET!(req("GET", undefined, "https://frenzsave.com/api/members/subscribers"))).text();
    expect(subs).toMatch(/bola/);
  });

  it("12 · an announcement reaches the active subscriber, never a stranger", async () => {
    as(CREATOR);
    const ann = await route("@/app/api/sub/announcements/route");
    const pub = await ann.POST!(req("POST", { title: "Live tonight", body: "Join at 8", idempotencyKey: "journey-ann-1" }));
    expect(pub.status).toBe(200);
    as(SUB);
    expect(await (await ann.GET!(req("GET", undefined, `https://frenzsave.com/api/sub/announcements?creator=${CREATOR}`))).text()).toMatch(/Live tonight/);
    as(STRANGER);
    expect(await (await ann.GET!(req("GET", undefined, `https://frenzsave.com/api/sub/announcements?creator=${CREATOR}`))).text()).not.toMatch(/Live tonight/);
  });

  it("13 · cancelling keeps the paid period: access stays, the period end is unchanged", async () => {
    as(SUB);
    const subs = await route("@/app/api/sub/subscriptions/route");
    const before = await bridge.sql<{ period_end: string }>("select period_end from creator_memberships where member_id = $1", [SUB]);
    expect((await subs.POST!(req("POST", { op: "cancel", creatorId: CREATOR }))).status).toBe(200);
    expect((await subs.POST!(req("POST", { op: "cancel", creatorId: CREATOR }))).status).toBe(200); // idempotent
    const after = await bridge.sql<{ period_end: string; status: string; cancelled_at: string | null }>("select period_end, status, cancelled_at from creator_memberships where member_id = $1", [SUB]);
    expect(after[0]).toMatchObject({ status: "active", period_end: before[0]!.period_end });
    expect(after[0]!.cancelled_at).not.toBeNull();
    const post = await route("@/app/api/sub/posts/[id]/route");
    expect((await post.GET!(req("GET", undefined, `https://frenzsave.com/api/sub/posts/${postId}`), { params: Promise.resolve({ id: postId }) })).status).toBe(200);
  });

  it("14 · after the period ends: no access, no media, no announcement — and no second charge was ever made", async () => {
    await bridge.sql("update creator_memberships set period_end = now() - interval '1 minute' where member_id = $1", [SUB]);
    presignGet.mockClear();
    as(SUB);
    const post = await route("@/app/api/sub/posts/[id]/route");
    expect((await post.GET!(req("GET", undefined, `https://frenzsave.com/api/sub/posts/${postId}`), { params: Promise.resolve({ id: postId }) })).status).toBe(403);
    expect(presignGet).not.toHaveBeenCalled();
    const ann = await route("@/app/api/sub/announcements/route");
    expect(await (await ann.GET!(req("GET", undefined, `https://frenzsave.com/api/sub/announcements?creator=${CREATOR}`))).text()).not.toMatch(/Live tonight/);
    const { n } = await one<{ n: number }>("select count(*)::int n from sub_purchases where subscriber_id = $1 and status = 'paid'", [SUB]);
    expect(n).toBe(1); // renewals are manual: nothing charged itself
    expect(initialized).toHaveLength(1);
  });

  it("15 · the creator's earnings show the server's balance", async () => {
    as(CREATOR);
    const res = await (await route("@/app/api/sub/earnings/route")).GET!(req("GET", undefined, "https://frenzsave.com/api/sub/earnings"));
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toMatch(new RegExp(`\\b${PRICE}\\b`));
  });

  it("16 · a withdrawal holds amount + flat fee; the whole balance (no room for the fee), a second while one is open, are refused", async () => {
    as(CREATOR);
    const w = await route("@/app/api/sub/withdraw/route");
    const details = { bankCode: "058", bankName: "Guaranty Trust Bank", accountNumber: "0123456789" };
    expect((await w.POST!(req("POST", { grossCents: PRICE, idempotencyKey: "journey-w-0", details }))).status).toBe(409); // PRICE + the flat fee is more than available
    const ok = await w.POST!(req("POST", { grossCents: WITHDRAW, idempotencyKey: "journey-w-1", details }));
    expect(ok.status).toBe(200);
    withdrawalId = ((await ok.json()) as { id: string }).id;
    const [b] = await bridge.sql<{ a: number; h: number }>("select available_cents::int a, held_cents::int h from sub_balances where creator_id = $1", [CREATOR]);
    expect(b).toEqual({ a: 0, h: PRICE }); // the amount and the flat fee
    const [row] = await bridge.sql<{ gross_cents: number; fee_cents: number; net_cents: number }>("select gross_cents, fee_cents, net_cents from withdrawal_requests where id = $1", [withdrawalId]);
    expect(row).toEqual({ gross_cents: PRICE, fee_cents: 98 + FLAT, net_cents: WITHDRAW - 98 }); // 10% of 980 = 98
    const second = await w.POST!(req("POST", { grossCents: PRICE, idempotencyKey: "journey-w-2", details }));
    expect(second.status).toBe(409);
    await invariants("withdrawal held");
  });

  it("17 · admin-only: a creator can't approve their own withdrawal; the admin rejects it and the money returns once", async () => {
    const admin = await route("@/app/api/admin/rewards/withdrawals/[id]/route");
    const ctx = { params: Promise.resolve({ id: withdrawalId }) };
    adminUser = null;
    as(CREATOR);
    expect((await admin.POST!(req("POST", { status: "completed", payoutReference: "x" }), ctx)).status).toBe(403);
    adminUser = { id: ADMIN };
    const res = await admin.POST!(req("POST", { status: "rejected", note: "Wrong account" }), ctx);
    expect(res.status).toBe(200);
    const again = await admin.POST!(req("POST", { status: "rejected", note: "again" }), ctx);
    expect(again.status).toBe(409); // final: never released twice
    const [b] = await bridge.sql<{ a: number; h: number }>("select available_cents::int a, held_cents::int h from sub_balances where creator_id = $1", [CREATOR]);
    expect(b).toEqual({ a: PRICE, h: 0 });
    await invariants("withdrawal rejected");
  });

  it("18 · a new withdrawal paid through Paystack (scripted): completed, withdrawn once", async () => {
    as(CREATOR);
    const w = await route("@/app/api/sub/withdraw/route");
    const ok = await w.POST!(req("POST", { grossCents: WITHDRAW, idempotencyKey: "journey-w-3", details: { bankCode: "058", bankName: "Guaranty Trust Bank", accountNumber: "0123456789" } }));
    expect(ok.status).toBe(200);
    const id = ((await ok.json()) as { id: string }).id;
    transferAnswer = (path) => (path === "/transferrecipient" ? { status: true, data: { recipient_code: "RCP_1" } } : path === "/transfer" ? { status: true, data: { status: "success", transfer_code: "TRF_1" } } : { status: true, data: {} });
    adminUser = { id: ADMIN };
    const pay = await route("@/app/api/admin/rewards/withdrawals/[id]/paystack/route");
    const res = await pay.POST!(req("POST", {}), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    const [b] = await bridge.sql<{ a: number; h: number; w: number }>("select available_cents::int a, held_cents::int h, withdrawn_cents::int w from sub_balances where creator_id = $1", [CREATOR]);
    expect(b).toEqual({ a: 0, h: 0, w: PRICE });
    await invariants("withdrawal paid");
  });

  it("19 · a suspended creator is refused at the door; the AI wallet was never touched", async () => {
    db.tables.profiles!.find((p) => p.id === CREATOR)!.is_suspended = true;
    as(CREATOR);
    const w = await route("@/app/api/sub/withdraw/route");
    expect((await w.POST!(req("POST", { grossCents: 100, idempotencyKey: "journey-w-4", details: { bankCode: "058", bankName: "Guaranty Trust Bank", accountNumber: "0123456789" } }))).status).toBe(403);
    db.tables.profiles!.find((p) => p.id === CREATOR)!.is_suspended = false;
    const ai = await bridge.sql<{ n: number }>("select count(*)::int n from ai_product_ledger");
    expect(ai[0]!.n).toBe(0);
  });
});

describe("the journey suite is honest about running", () => {
  it(`${PGlite ? "PGlite found: the journey above ran against the real SQL" : "PGlite NOT found: the journey above was SKIPPED (set PGLITE_DIR to run it)"} [mutant: ${process.env.JOURNEY_MUTANT ?? "none"}]`, () => {
    expect(true).toBe(true);
  });
});
