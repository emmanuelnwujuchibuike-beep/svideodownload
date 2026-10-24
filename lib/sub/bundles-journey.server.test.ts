import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";
import { createSqlBridge, loadPGlite, subHarnessStub } from "@/lib/testing/pglite-bridge";

/**
 * Exclusive bundles & promotions (Part 2, 0277) — END TO END through the real route handlers and lib/sub/*, with every
 * RPC running the REAL migration SQL in PGlite (0227 … 0276 + 0277): creator bundle prices (bad ones refused) → the
 * options a visitor is offered → a 12-month bundle bought, settled once for 365 days and the bundle price → a replayed
 * webhook changes nothing → a refund takes back exactly that row's days and earnings → a 50%-off promotion with a limit
 * of 1: the slot is held by an open checkout, refused to the next buyer, freed after 30 minutes → an expired promotion
 * is refused but a checkout opened before the end settles at its recorded (discounted) price → the creator earns the
 * DISCOUNTED price → another member can't edit the promotion → a plain monthly purchase still works as before.
 *
 * MOCKED as in journey.server.test.ts: PostgREST/auth (in-memory), Paystack (scripted), FX, push/email. When PGlite is
 * not installed this suite SKIPS — it never passes without running.
 */

const PGlite = await loadPGlite();

let db: FakeDb;
let sessionUser: { id: string; email?: string } | null = null;
const SECRET = "sk_test_local_only";
type Charge = { status: string; amount?: number; currency?: string; id?: number; metadata?: Record<string, unknown> };
let verifyAnswer: (ref: string) => Charge = () => ({ status: "abandoned" });
const initialized: { reference: string; amount: number; currency: string }[] = [];

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) }, from: (t: string) => (db.client() as { from: (t: string) => unknown }).from(t) }) }));
vi.mock("@/lib/admin/guard", () => ({ getAdminUser: async () => null }));
vi.mock("@/lib/rate-limit", () => ({ trackLimiter: { limit: async () => ({ success: true }) }, clientId: () => "ip" }));
vi.mock("@/lib/security/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/lib/landing/settings", async () => {
  const { SUB_DEFAULTS } = await import("@/lib/rewards/config");
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
  };
});
vi.mock("@/lib/notifications/smart-delivery", () => ({ sendSmartPush: vi.fn(async () => {}) }));
vi.mock("@/lib/email/member-email", () => ({ emailMember: vi.fn(async () => "sent") }));
vi.mock("@/lib/push/identity", () => ({ pushPerson: async () => ({ name: "Amaka", handle: "amaka", icon: null }) }));
vi.mock("@/lib/social/creator-notify-emit", () => ({ excludedFor: async () => new Set<string>() }));

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CREATOR = U(1);
const A = U(2);
const B = U(3);
const C = U(4);
const D = U(5);
const E = U(6);
const MONTHLY = 1000;
const BUNDLE12 = 9600;
const PROMO3 = 1350; // 50% off the $27.00 3-month bundle
const kobo = (priceCents: number) => (priceCents + Math.floor(priceCents / 10)) * 1500; // price + the 10% fee, at 1,500 NGN / $
const req = (body: unknown, url = "https://frenzsave.com/api/x") => new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
type Handler = (r: Request) => Promise<Response>;
const route = async (p: string) => (await import(/* @vite-ignore */ p)) as Record<string, Handler>;
const as = (id: string | null) => {
  sessionUser = id ? { id, email: `${id.slice(-1)}@example.com` } : null;
};
let bridge: Awaited<ReturnType<typeof createSqlBridge>>;
let promoId = "";

const checkout = async (who: string, body: Record<string, unknown> = {}) => {
  as(who);
  const r = await route("@/app/api/sub/checkout/route");
  const res = await r.POST!(req({ creatorId: CREATOR, returnPath: "/u/amaka?tab=sub", ...body }));
  return { status: res.status, json: (await res.json()) as { ok?: boolean; url?: string; error?: string; reused?: boolean } };
};
const lastRef = () => initialized.at(-1)!.reference;
const pay = async (reference: string, amount: number) => {
  const { confirmSubPayment } = await import("./server");
  verifyAnswer = () => ({ status: "success", amount, currency: "NGN", id: 1, metadata: { purpose: "frenz_sub" } });
  return confirmSubPayment(reference);
};
const row = async (reference: string) => (await bridge.sql<Record<string, unknown>>("select price_cents, fee_cents, total_cents, charged_minor, months, period_days, promotion_id, status from sub_purchases where reference = $1", [reference]))[0]!;
const daysLeft = async (member: string) => {
  const [m] = await bridge.sql<{ period_end: string }>("select period_end from creator_memberships where creator_id = $1 and member_id = $2", [CREATOR, member]);
  return (Date.parse(m!.period_end) - Date.now()) / 86_400_000;
};
const lifetime = async () => Number((await bridge.sql<{ l: number }>("select lifetime_cents::int l from sub_balances where creator_id = $1", [CREATOR]))[0]?.l ?? 0);

describe.skipIf(!PGlite)("Exclusive bundles & promotions, end to end (real SQL, 0277)", () => {
  beforeAll(async () => {
    db = fakeDb({
      profiles: [CREATOR, A, B, C, D, E].map((id, i) => ({ id, handle: i === 0 ? "amaka" : `m${i}`, display_name: i === 0 ? "Amaka" : `M${i}`, avatar_url: null, is_verified: false, is_suspended: false, is_hidden: false })),
      blocks: [],
      follows: [],
      social_circles: [],
      reports: [],
    });
    // 0277's column defaults (the in-memory PostgREST layer has none)
    db.defaults.sub_promotions = { paused: false, paused_by: null, paused_at: null, description: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    bridge = await createSqlBridge(PGlite!, db, {
      setup: [subHarnessStub()],
      migrations: ["0227_sub_monetization.sql", "0231_sub_promo_dismiss.sql", "0237_sub_post_thumbs.sql", "0239_private_post_interactions.sql", "0247_sub_settlement_hardening.sql", "0248_sub_post_audience_feed.sql", "0250_sub_membership_lifecycle.sql", "0254_payout_reversal_dispute_restore.sql", "0256_withdrawal_rejection_settles_debt.sql", "0258_withdrawal_flat_fee.sql", "0276_open_checkout_guard.sql", "0277_sub_bundles_promotions.sql"],
      userIds: [CREATOR, A, B, C, D, E],
    });
    // the promotion LIMIT under real concurrency (and its mutant) is proven in supabase/tests/sub_promotion_limit.pg.mjs:
    // here the app's own pre-check refuses first, so a mutant of the SQL check could not fail this journey
    await bridge.pull();
  }, 60_000);
  afterAll(async () => {
    await bridge?.close();
  });

  it("1 · the creator sets a monthly price and bundles; a bundle outside the bounds is refused", async () => {
    as(CREATOR);
    const members = await route("@/app/api/members/route");
    expect((await members.POST!(req({ op: "settings", priceCents: MONTHLY }))).status).toBe(200);
    expect((await members.POST!(req({ op: "settings", complete: true }))).status).toBe(200);
    expect((await members.POST!(req({ op: "settings", bundlePrices: { "3": 100 } }))).status).toBe(400); // below 3 × $1
    expect((await members.POST!(req({ op: "settings", bundlePrices: { "3": 2700, "12": BUNDLE12 } }))).status).toBe(200);
    const [s] = await bridge.sql<{ b: Record<string, number | null> }>("select bundle_prices b from creator_membership_settings where creator_id = $1", [CREATOR]);
    expect(s!.b).toEqual({ "3": 2700, "6": null, "12": BUNDLE12 });
    // the database refuses junk too, whatever the app does
    await expect(bridge.sql("update creator_membership_settings set bundle_prices = '{\"5\": 100}' where creator_id = $1", [CREATOR])).rejects.toThrow();
  });

  it("2 · a visitor is offered 1, 3 and 12 months with the fee on top and honest savings", async () => {
    const { subOffers } = await import("./server");
    const o = await subOffers(CREATOR);
    expect(o.map((x) => [x.months, x.priceCents, x.totalCents, x.periodDays, x.savingsCents])).toEqual([
      [1, 1000, 1100, 30, 0],
      [3, 2700, 2970, 90, 300],
      [12, 9600, 10560, 365, 2400],
    ]);
  });

  it("3 · a 12-month bundle: the browser names the duration, the server prices it; an unoffered duration is refused", async () => {
    expect((await checkout(A, { months: 6 })).status).toBe(409);
    expect((await checkout(A, { months: 2 })).status).toBe(400);
    expect((await checkout(A, { months: 12, priceCents: 1 })).status).toBe(400); // an amount from the browser is refused outright
    const out = await checkout(A, { months: 12 });
    expect(out.status).toBe(200);
    expect(initialized.at(-1)).toMatchObject({ currency: "NGN", amount: kobo(BUNDLE12) });
    expect(await row(lastRef())).toMatchObject({ price_cents: BUNDLE12, fee_cents: 960, total_cents: 10560, months: 12, period_days: 365, promotion_id: null, status: "initiated" });
    // the same option again reuses it; one purchase row
    expect((await checkout(A, { months: 12 })).json).toMatchObject({ reused: true });
  });

  it("4 · settled once: 365 days of access and the BUNDLE price earned; a replayed webhook changes nothing", async () => {
    const ref = initialized.at(-1)!.reference;
    expect(await pay(ref, kobo(BUNDLE12))).toMatchObject({ ok: true, status: "paid" });
    const d = await daysLeft(A);
    expect(d).toBeGreaterThan(364.9);
    expect(d).toBeLessThan(365.1);
    expect(await lifetime()).toBe(BUNDLE12);
    const body = JSON.stringify({ event: "charge.success", data: { reference: ref, amount: kobo(BUNDLE12), currency: "NGN", status: "success", metadata: { purpose: "frenz_sub" } } });
    const sig = createHmac("sha512", SECRET).update(body).digest("hex");
    const { POST } = await import("@/app/api/paystack/webhook/route");
    for (let i = 0; i < 2; i++) expect((await POST(new Request("https://frenzsave.com/api/paystack/webhook", { method: "POST", headers: { "x-paystack-signature": sig }, body }))).status).toBe(200);
    const [cnt] = await bridge.sql<{ n: number }>("select count(*)::int n from sub_ledger where kind = 'earning' and creator_id = $1", [CREATOR]);
    expect(cnt!.n).toBe(1);
    expect(await lifetime()).toBe(BUNDLE12);
  });

  it("5 · a refund of the bundle takes back exactly its 365 days and its earning", async () => {
    const { reverseSub } = await import("./server");
    const ref = initialized.at(-1)!.reference;
    expect(await reverseSub(ref, "refunded", null, "test refund")).toMatchObject({ ok: true });
    expect(Math.abs(await daysLeft(A))).toBeLessThan(0.1);
    const [b] = await bridge.sql<{ a: number; d: number }>("select available_cents::int a, debt_cents::int d from sub_balances where creator_id = $1", [CREATOR]);
    expect(b!.a - b!.d).toBe(0);
  });

  it("6 · a 50%-off promotion with a limit of 1: an open checkout holds the slot, the next buyer is refused, 30 minutes frees it", async () => {
    const { createPromotion } = await import("./promotions");
    const made = await createPromotion(CREATOR, { name: "Launch", kind: "percent", percentOff: 50, durations: [3], startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 86_400_000).toISOString(), maxRedemptions: 1 });
    expect(made.ok).toBe(true);
    promoId = (made as { id: string }).id;
    const { subOffers } = await import("./server");
    expect((await subOffers(CREATOR)).find((o) => o.months === 3)).toMatchObject({ priceCents: PROMO3, regularCents: 2700, promotion: { id: promoId, name: "Launch" } });
    // a promotion on a duration it doesn't cover is refused
    expect((await checkout(B, { months: 1, promotionId: promoId })).status).toBe(409);
    const b = await checkout(B, { months: 3, promotionId: promoId });
    expect(b.status).toBe(200);
    const bRef = lastRef();
    expect(await row(bRef)).toMatchObject({ price_cents: PROMO3, months: 3, period_days: 90, promotion_id: promoId });
    const c = await checkout(C, { months: 3, promotionId: promoId });
    expect(c.status).toBe(409);
    expect(c.json.error).toMatch(/fully redeemed/);
    // the regular price is still sold
    expect((await checkout(C, { months: 3 })).status).toBe(200);
    expect(await row(lastRef())).toMatchObject({ price_cents: 2700, promotion_id: null });
    // B's checkout is abandoned: after 30 minutes it stops counting
    db.tables.sub_purchases!.find((r) => r.reference === bRef)!.created_at = new Date(Date.now() - 31 * 60_000).toISOString();
    expect((await checkout(D, { months: 3, promotionId: promoId })).status).toBe(200);
  });

  it("7 · the promotion ends: new checkouts are refused, but one opened before the end settles at its RECORDED price", async () => {
    const dRef = lastRef();
    db.tables.sub_promotions!.find((p) => p.id === promoId)!.ends_at = new Date(Date.now() - 1000).toISOString();
    expect((await checkout(E, { months: 3, promotionId: promoId })).status).toBe(409);
    const before = await lifetime();
    expect(await pay(dRef, kobo(PROMO3))).toMatchObject({ ok: true, status: "paid" });
    // the creator earns the DISCOUNTED price — never the regular $27.00
    expect((await lifetime()) - before).toBe(PROMO3);
    const d = await daysLeft(D);
    expect(d).toBeGreaterThan(89.9);
    expect(d).toBeLessThan(90.1);
  });

  it("8 · only the creator edits their promotion; a used promotion keeps its price", async () => {
    const r = await route("@/app/api/sub/promotions/route");
    as(B);
    expect((await r.POST!(req({ op: "pause", id: promoId }))).status).toBe(404);
    as(CREATOR);
    const edit = await r.POST!(req({ op: "edit", id: promoId, name: "Launch", kind: "percent", percentOff: 60, durations: [3], startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 86_400_000).toISOString(), maxRedemptions: 1 }));
    expect(edit.status).toBe(409);
    expect(((await edit.json()) as { error: string }).error).toMatch(/locked/);
    const [p] = await bridge.sql<{ percent_off: number }>("select percent_off from sub_promotions where id = $1", [promoId]);
    expect(p!.percent_off).toBe(50);
  });

  it("9 · a plain monthly purchase works exactly as before", async () => {
    const out = await checkout(E);
    expect(out.status).toBe(200);
    expect(await row(lastRef())).toMatchObject({ price_cents: MONTHLY, months: 1, period_days: 30, promotion_id: null });
    expect(await pay(lastRef(), kobo(MONTHLY))).toMatchObject({ ok: true, status: "paid" });
    const d = await daysLeft(E);
    expect(d).toBeGreaterThan(29.9);
    expect(d).toBeLessThan(30.1);
  });
});
