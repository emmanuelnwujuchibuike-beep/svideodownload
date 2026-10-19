import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Exclusive Part 13 — the security boundaries, through the REAL route handlers and server modules
 * on an in-memory database. Identity comes only from the mocked server session (`getUser`), exactly as
 * in production; nothing a request body says about who it is counts. R2 and Paystack are stand-ins:
 * nothing is signed for real, nothing is paid. Database RLS and grants are proven separately in PGlite
 * (supabase/tests/*.pglite.mjs) — this file is the API layer above them.
 */

let db: FakeDb;
let sessionUser: { id: string; email?: string } | null = null;
const presignGet = vi.fn(async (key: string) => `https://private.example/${key}?sig=1`);
const presignPut = vi.fn(async (key: string) => `https://put.example/${key}?sig=1`);
const paystackSecret = "sk_test_local_only";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) }, from: (t: string) => (db.client() as { from: (t: string) => unknown }).from(t) }) }));
vi.mock("@/lib/storage/r2", () => ({ hasPrivateR2: true, presignPrivateGet: (k: string) => presignGet(k), presignPrivatePut: (k: string) => presignPut(k), deletePrivate: vi.fn(), readPrivatePrefix: vi.fn(async () => ({ prefix: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]), size: 1000, contentType: "image/jpeg" })) }));
vi.mock("@/lib/rate-limit", () => ({ trackLimiter: { limit: async () => ({ success: true }) }, clientId: () => "ip" }));
vi.mock("@/lib/security/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/lib/landing/settings", async () => {
  const { SUB_DEFAULTS } = await import("@/lib/rewards/config");
  return { getLandingSettings: async () => ({ frenzRewards: { sub: { ...SUB_DEFAULTS, autoPayout: true } }, frenzAiCharacterReplace: { recharge: { checkoutCurrency: "NGN" } } }) };
});
vi.mock("@/lib/notifications/smart-delivery", () => ({ sendSmartPush: vi.fn(async () => {}) }));
vi.mock("@/lib/email/member-email", () => ({ emailMember: vi.fn(async () => "sent") }));
vi.mock("@/lib/push/identity", () => ({ pushPerson: async () => ({ name: "Creator", handle: "c1", icon: null }) }));
vi.mock("@/lib/social/creator-notify-emit", () => ({ excludedFor: async () => new Set<string>() }));
vi.mock("@/lib/paystack/config", () => ({ getPaystackConfig: async () => ({ secretKey: paystackSecret }) }));
// no request ever leaves the test: the bank-name lookup and every payout call are stand-ins
const resolveAccount = vi.fn(async () => "ACCOUNT HOLDER");
vi.mock("@/lib/rewards/paystack-banks", async (orig) => ({ ...(await orig<typeof import("@/lib/rewards/paystack-banks")>()), resolveAccount: () => resolveAccount() }));
const payWithdrawalViaPaystack = vi.fn(async () => ({ ok: true, status: "pending" }));
vi.mock("@/lib/rewards/paystack-payouts", async (orig) => ({ ...(await orig<typeof import("@/lib/rewards/paystack-payouts")>()), payWithdrawalViaPaystack: () => payWithdrawalViaPaystack() }));

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = U(1); // a creator
const B = U(2); // another creator
const SUBSCRIBER = U(3); // subscribes to B
const STRANGER = U(4);
const POST_B = `10000000-0000-4000-8000-${"0".repeat(11)}2`;
const NOTE_B = `20000000-0000-4000-8000-${"0".repeat(11)}2`;
const future = new Date(Date.now() + 10 * 86_400_000).toISOString();

beforeEach(() => {
  sessionUser = null;
  presignGet.mockClear();
  presignPut.mockClear();
  db = fakeDb({
    profiles: [A, B, SUBSCRIBER, STRANGER].map((id) => ({ id, handle: `h${id.slice(-1)}`, display_name: `P${id.slice(-1)}`, avatar_url: null, is_verified: false, is_suspended: false, is_hidden: false })),
    sub_posts: [{ id: POST_B, creator_id: B, caption: "B's secret caption", cover_url: null, status: "published", audience: "locked", created_at: "2026-10-10T10:00:00Z" }],
    sub_post_media: [{ id: "m1", post_id: POST_B, idx: 0, media_kind: "image", object_key: `sub/${B}/secret.jpg`, thumb_key: null, width: null, height: null }],
    creator_memberships: [{ id: "m-b", creator_id: B, member_id: SUBSCRIBER, status: "active", billing: "sub", period_end: future }],
    creator_membership_settings: [{ creator_id: B, sub_active: true, sub_price_cents: 500 }],
    creator_notes: [{ id: NOTE_B, creator_id: B, audience: "subscribers", title: "t", body: "for subscribers", deleted_at: null, created_at: "2026-10-10T10:00:00Z" }],
    sub_balances: [{ creator_id: B, available_cents: 5000, pending_cents: 0, held_cents: 0, debt_cents: 0, lifetime_cents: 5000, withdrawn_cents: 0 }],
    sub_ledger: [{ id: 1, creator_id: B, kind: "earning", amount_cents: 5000, reference: "purchase:x" }],
    sub_payout_accounts: [{ creator_id: B, bank_code: "058", bank_name: "Guaranty Trust Bank", account_number: "0123456789", account_name: "B", auto_withdraw: true }],
    sub_purchases: [],
    sub_post_comments: [],
    sub_post_likes: [],
    blocks: [],
    follows: [],
    notifications: [],
    reports: [],
    withdrawal_requests: [],
    financial_audit_log: [],
    social_circles: [],
    creator_notification_prefs: [],
  });
  db.rpc.request_sub_withdrawal = vi.fn(() => ({ data: { ok: true, id: U(900), net: 4500, fee: 500 }, error: null }));
});

const req = (method: string, body?: unknown, url = "https://frenzsave.com/api/x") => new Request(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });
type Handler = (r: Request, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>;
/** Every Exclusive route module and its handlers. */
const ROUTES: [string, () => Promise<Record<string, unknown>>][] = [
  ["/api/sub/announcements", () => import("@/app/api/sub/announcements/route")],
  ["/api/sub/checkout", () => import("@/app/api/sub/checkout/route")],
  ["/api/sub/earnings", () => import("@/app/api/sub/earnings/route")],
  ["/api/sub/earnings/ledger", () => import("@/app/api/sub/earnings/ledger/route")],
  ["/api/sub/earnings/overview", () => import("@/app/api/sub/earnings/overview/route")],
  ["/api/sub/favourites", () => import("@/app/api/sub/favourites/route")],
  ["/api/sub/feed", () => import("@/app/api/sub/feed/route")],
  ["/api/sub/notify", () => import("@/app/api/sub/notify/route")],
  ["/api/sub/payout-account", () => import("@/app/api/sub/payout-account/route")],
  ["/api/sub/posts", () => import("@/app/api/sub/posts/route")],
  ["/api/sub/posts/upload", () => import("@/app/api/sub/posts/upload/route")],
  ["/api/sub/posts/[id]", () => import("@/app/api/sub/posts/[id]/route")],
  ["/api/sub/posts/[id]/capture", () => import("@/app/api/sub/posts/[id]/capture/route")],
  ["/api/sub/posts/[id]/comments", () => import("@/app/api/sub/posts/[id]/comments/route")],
  ["/api/sub/posts/[id]/like", () => import("@/app/api/sub/posts/[id]/like/route")],
  ["/api/sub/subscriptions", () => import("@/app/api/sub/subscriptions/route")],
  ["/api/sub/transactions", () => import("@/app/api/sub/transactions/route")],
  ["/api/sub/withdraw", () => import("@/app/api/sub/withdraw/route")],
  ["/api/members", () => import("@/app/api/members/route")],
  ["/api/members/subscribers", () => import("@/app/api/members/subscribers/route")],
  ["/api/members/export", () => import("@/app/api/members/export/route")],
];
/** A plausible body for each mutating call, so a refusal is about WHO, not about a malformed request. */
const BODY: Record<string, unknown> = {
  "/api/sub/announcements": { title: "Hi", body: "Hello", idempotencyKey: "k-announce-1" },
  "/api/sub/checkout": { creatorId: B, returnPath: "/u/hb" },
  "/api/sub/favourites": { creatorId: B, favourite: true },
  "/api/sub/notify": { creator: B, mode: "push" },
  "/api/sub/payout-account": { bankCode: "058", accountNumber: "0123456789" },
  "/api/sub/posts": { media: [{ key: `sub/${B}/secret.jpg`, kind: "image" }] },
  "/api/sub/posts/upload": { kind: "image", ext: "jpg" },
  "/api/sub/posts/[id]": { caption: "pwned" },
  "/api/sub/posts/[id]/capture": { kind: "print_screen" },
  "/api/sub/posts/[id]/comments": { body: "hi" },
  "/api/sub/posts/[id]/like": { like: true },
  "/api/sub/subscriptions": { op: "cancel", creatorId: B },
  "/api/sub/withdraw": { grossCents: 5000, idempotencyKey: "k-withdraw-1", useSaved: true },
  "/api/members": { op: "settings", priceCents: 1 },
};
const urlFor = (path: string) => `https://frenzsave.com${path.replace("[id]", POST_B)}?creator=${B}&id=${NOTE_B}`;

describe("signed out: no Exclusive route writes, signs private media, or returns private data", () => {
  it("every handler of every route", async () => {
    let calls = 0;
    for (const [path, load] of ROUTES) {
      const mod = await load();
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const h = mod[method] as Handler | undefined;
        if (!h) continue;
        calls++;
        const res = await h(req(method, method === "GET" ? undefined : (BODY[path] ?? {}), urlFor(path)), paramsOf(POST_B));
        const text = await res.text();
        if (method !== "GET") expect([400, 401, 403, 404], `${method} ${path} → ${res.status}`).toContain(res.status);
        expect(text, `${method} ${path} leaked B's private data`).not.toMatch(/B's secret caption|secret\.jpg|sig=1|for subscribers|0123456789/);
      }
    }
    expect(calls).toBeGreaterThan(30);
    expect(db.writes, "a signed-out request wrote to the database").toEqual([]);
    expect(presignGet).not.toHaveBeenCalled();
    expect(presignPut).not.toHaveBeenCalled();
    // it imports and calls every Exclusive route handler (30+) — ~1 s alone, past 5 s under a full parallel
    // run (2026-10-19, twice): a timeout, never this assertion. The checks are unchanged.
  }, 60_000);
});

describe("cross-account: creator A against creator B's records", () => {
  beforeEach(() => {
    sessionUser = { id: A, email: "a@example.com" };
  });

  it("A can't edit, re-audience, re-thumb or delete B's post (body ids are ignored), and nothing is written", async () => {
    const r = (await import("@/app/api/sub/posts/[id]/route")) as unknown as Record<string, Handler>;
    for (const body of [{ caption: "pwned" }, { audience: "hidden" }, { idx: 0, thumbKey: `sub/${A}/mine.jpg` }, { idx: 0, thumbKey: `sub/${B}/secret.jpg`, creatorId: A }]) {
      const res = await r.PATCH!(req("PATCH", body, urlFor("/api/sub/posts/[id]")), paramsOf(POST_B));
      expect(res.status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
    }
    const del = await r.DELETE!(req("DELETE", undefined, urlFor("/api/sub/posts/[id]")), paramsOf(POST_B));
    expect(del.status).toBeGreaterThanOrEqual(400);
    expect(db.tables.sub_posts![0]).toMatchObject({ caption: "B's secret caption", audience: "locked", status: "published" });
    expect(db.tables.sub_post_media![0]!.thumb_key).toBeNull();
  });

  it("A can't open B's private post or get its media signed (no subscription)", async () => {
    const r = (await import("@/app/api/sub/posts/[id]/route")) as unknown as Record<string, Handler>;
    const res = await r.GET!(req("GET", undefined, urlFor("/api/sub/posts/[id]")), paramsOf(POST_B));
    expect(res.status).toBe(403);
    expect(await res.text()).not.toMatch(/secret\.jpg|sig=1|B's secret caption/);
    expect(presignGet).not.toHaveBeenCalled();
  });

  it("A can't publish B's private files as A's own post", async () => {
    // A is a set-up creator, so the refusal below is the file-ownership rule, not "set a price first"
    db.tables.creator_membership_settings!.push({ creator_id: A, sub_active: true, sub_price_cents: 300 });
    const r = (await import("@/app/api/sub/posts/route")) as unknown as Record<string, Handler>;
    const res = await r.POST!(req("POST", { media: [{ key: `sub/${B}/secret.jpg`, kind: "image" }] }));
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/isn't yours/);
    expect(db.writes.filter((w) => w.table === "sub_posts" || w.table === "sub_post_media")).toEqual([]);
  });

  it("an upload URL is only ever for A's OWN folder, whatever is asked", async () => {
    const r = (await import("@/app/api/sub/posts/upload/route")) as unknown as Record<string, Handler>;
    const res = await r.POST!(req("POST", { kind: "image", ext: "jpg" }));
    expect(res.status).toBe(200);
    expect(presignPut).toHaveBeenCalledTimes(1);
    expect(presignPut.mock.calls[0]![0]).toMatch(new RegExp(`^sub/${A}/`));
    // a smuggled field is refused outright (strict body)
    expect((await r.POST!(req("POST", { kind: "image", ext: "jpg", key: `sub/${B}/x.jpg` }))).status).toBe(400);
  });

  it("A can't delete B's announcement or read it", async () => {
    const r = (await import("@/app/api/sub/announcements/route")) as unknown as Record<string, Handler>;
    await r.DELETE!(req("DELETE", undefined, urlFor("/api/sub/announcements")));
    expect(db.tables.creator_notes![0]!.deleted_at).toBeNull();
    const list = await r.GET!(req("GET", undefined, urlFor("/api/sub/announcements")));
    expect(await list.text()).not.toMatch(/for subscribers/);
  });

  it("A's earnings, ledger and payout account are A's own — B's balance and bank details never appear", async () => {
    for (const path of ["/api/sub/earnings", "/api/sub/earnings/ledger", "/api/sub/earnings/overview", "/api/sub/payout-account", "/api/sub/transactions", "/api/members/subscribers"] as const) {
      const mod = (await ROUTES.find(([p]) => p === path)![1]()) as Record<string, Handler>;
      const res = await mod.GET!(req("GET", undefined, `https://frenzsave.com${path}?creator=${B}&userId=${B}&creatorId=${B}`));
      // B's balance is 5000 as a whole number (the fee tiers' 50000 limit is not it)
      expect(await res.text(), path).not.toMatch(/\b5000\b|0123456789|purchase:x/);
    }
  });

  it("A can't withdraw B's balance: the withdrawal is always for the session user", async () => {
    const r = (await import("@/app/api/sub/withdraw/route")) as unknown as Record<string, Handler>;
    // a smuggled userId is refused by the strict body; the real call can only name A
    expect((await r.POST!(req("POST", { grossCents: 5000, idempotencyKey: "k-withdraw-1", useSaved: true, userId: B }))).status).toBe(400);
    await r.POST!(req("POST", { grossCents: 5000, idempotencyKey: "k-withdraw-2", useSaved: true }));
    for (const call of (db.rpc.request_sub_withdrawal as ReturnType<typeof vi.fn>).mock.calls) expect((call[0] as { p_user: string }).p_user).toBe(A);
  });

  it("A's settings change only A's settings (no creatorId is accepted)", async () => {
    const r = (await import("@/app/api/members/route")) as unknown as Record<string, Handler>;
    expect((await r.POST!(req("POST", { op: "settings", priceCents: 300, creatorId: B }))).status).toBe(400);
    expect(db.tables.creator_membership_settings!.find((s) => s.creator_id === B)!.sub_price_cents).toBe(500);
  });
});

describe("subscriber access (the legitimate path still works, an ineligible one doesn't)", () => {
  it("an ACTIVE subscriber opens B's post and its media is signed; the same call after the period ended gets nothing", async () => {
    const r = (await import("@/app/api/sub/posts/[id]/route")) as unknown as Record<string, Handler>;
    sessionUser = { id: SUBSCRIBER };
    const ok = await r.GET!(req("GET", undefined, urlFor("/api/sub/posts/[id]")), paramsOf(POST_B));
    expect(ok.status).toBe(200);
    expect(presignGet).toHaveBeenCalledWith(`sub/${B}/secret.jpg`);
    presignGet.mockClear();
    db.tables.creator_memberships![0]!.period_end = new Date(Date.now() - 1000).toISOString();
    const expired = await r.GET!(req("GET", undefined, urlFor("/api/sub/posts/[id]")), paramsOf(POST_B));
    expect(expired.status).toBe(403);
    expect(presignGet).not.toHaveBeenCalled();
  });

  it("a SUSPENDED subscriber (or creator) gets no signed media", async () => {
    const r = (await import("@/app/api/sub/posts/[id]/route")) as unknown as Record<string, Handler>;
    sessionUser = { id: SUBSCRIBER };
    db.tables.profiles!.find((p) => p.id === SUBSCRIBER)!.is_suspended = true;
    expect((await r.GET!(req("GET", undefined, urlFor("/api/sub/posts/[id]")), paramsOf(POST_B))).status).toBe(403);
    db.tables.profiles!.find((p) => p.id === SUBSCRIBER)!.is_suspended = false;
    db.tables.profiles!.find((p) => p.id === B)!.is_suspended = true;
    expect((await r.GET!(req("GET", undefined, urlFor("/api/sub/posts/[id]")), paramsOf(POST_B))).status).toBe(403);
    expect(presignGet).not.toHaveBeenCalled();
  });
});

describe("Part 13 fix: a SUSPENDED creator moves no money out", () => {
  it("requestSubWithdrawal refuses a suspended creator before anything is reserved or sent", async () => {
    const { requestSubWithdrawal } = await import("./server");
    db.tables.profiles!.find((p) => p.id === B)!.is_suspended = true;
    const out = await requestSubWithdrawal({ userId: B, grossCents: 5000, details: { bankCode: "058", accountNumber: "0123456789", accountName: "B" }, idempotencyKey: "k-suspended-1" });
    expect(out).toMatchObject({ ok: false, status: 403, reason: "suspended" });
    expect(db.rpc.request_sub_withdrawal).not.toHaveBeenCalled();
  });

  it("the route answers 403 to a suspended creator", async () => {
    sessionUser = { id: B };
    db.tables.profiles!.find((p) => p.id === B)!.is_suspended = true;
    const r = (await import("@/app/api/sub/withdraw/route")) as unknown as Record<string, Handler>;
    const res = await r.POST!(req("POST", { grossCents: 5000, idempotencyKey: "k-suspended-2", useSaved: true }));
    expect(res.status).toBe(403);
    expect(db.rpc.request_sub_withdrawal).not.toHaveBeenCalled();
  });

  it("the auto-withdrawal sweep (autoPayout on) skips a suspended creator", async () => {
    const { autoWithdrawSub } = await import("./payout-account");
    db.rpc.release_sub_earnings = () => ({ data: 5000, error: null });
    // positive control first: the same creator, NOT suspended, IS auto-withdrawn and paid out
    const before = await autoWithdrawSub(B, "test");
    expect(before.requested).toBe(true);
    expect(payWithdrawalViaPaystack).toHaveBeenCalledTimes(1);
    (db.rpc.request_sub_withdrawal as ReturnType<typeof vi.fn>).mockClear();
    payWithdrawalViaPaystack.mockClear();
    db.tables.profiles!.find((p) => p.id === B)!.is_suspended = true;
    const out = await autoWithdrawSub(B, "test");
    expect(out).toMatchObject({ requested: false, reason: "suspended" });
    expect(db.rpc.request_sub_withdrawal).not.toHaveBeenCalled();
    expect(payWithdrawalViaPaystack).not.toHaveBeenCalled();
  });

  it("no profile row, or a failed read: fail CLOSED", async () => {
    const { requestSubWithdrawal } = await import("./server");
    const out = await requestSubWithdrawal({ userId: U(77), grossCents: 5000, details: { bankCode: "058", accountNumber: "0123456789", accountName: "X" }, idempotencyKey: "k-missing-1" });
    expect(out).toMatchObject({ ok: false, reason: "unavailable" });
    db.failOn.profiles = "relation unavailable";
    expect(await requestSubWithdrawal({ userId: B, grossCents: 5000, details: { bankCode: "058", accountNumber: "0123456789", accountName: "B" }, idempotencyKey: "k-missing-2" })).toMatchObject({ ok: false, reason: "unavailable" });
    expect(db.rpc.request_sub_withdrawal).not.toHaveBeenCalled();
  });
});

describe("a forged payment notification authorizes nothing", () => {
  const charge = JSON.stringify({ event: "charge.success", data: { reference: "frenz_sub_forged", amount: 1, currency: "NGN", status: "success", metadata: { purpose: "frenz_sub" } } });
  const sign = (body: string, key: string) => createHmac("sha512", key).update(body).digest("hex");

  it("a missing, wrong-key or tampered signature is refused before anything is read or settled", async () => {
    const { POST } = await import("@/app/api/paystack/webhook/route");
    for (const sig of [null, sign(charge, "sk_test_attacker"), sign(charge.replace("1", "2"), paystackSecret), "not-hex"]) {
      const res = await POST(new Request("https://frenzsave.com/api/paystack/webhook", { method: "POST", headers: sig ? { "x-paystack-signature": sig } : {}, body: charge }));
      expect(res.status).toBe(400);
    }
    expect(db.writes).toEqual([]);
  });

  it("teeth: the same body with the RIGHT signature gets past the signature check (so the refusals above are about the signature)", async () => {
    const { verifyPaystackSignature } = await import("@/lib/paystack/paystack");
    expect(await verifyPaystackSignature(charge, sign(charge, paystackSecret))).toBe(true);
    expect(await verifyPaystackSignature(charge, sign(charge, "sk_test_attacker"))).toBe(false);
  });
});
