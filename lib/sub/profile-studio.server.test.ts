import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";
import { scriptOpenCheckoutGuard } from "@/lib/testing/open-checkout-guard";

/**
 * Frenz Exclusive Part 4 — the profile's Exclusive tab and the creator's studio, through the
 * REAL server modules and routes (lib/sub/profile, lib/sub/posts, /api/sub/posts,
 * /api/sub/posts/[id], /api/sub/checkout) over an in-memory database.
 */

let db: FakeDb;
let sessionUser: { id: string; email?: string } | null = null;
let fileHead: { prefix: Uint8Array; size: number; contentType: string } | null;
const presign = vi.fn(async (key: string) => `https://private.example/${key}?sig=1`);
const initCheckout = vi.fn(async () => "https://checkout.paystack.com/abc");
let subCfg: Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }) }));
vi.mock("@/lib/storage/r2", () => ({ hasPrivateR2: true, presignPrivateGet: (k: string) => presign(k), presignPrivatePut: vi.fn(async () => "https://put"), deletePrivate: vi.fn(), readPrivatePrefix: vi.fn(async () => fileHead) }));
vi.mock("@/lib/rate-limit", () => ({ trackLimiter: { limit: async () => ({ success: true }) }, clientId: () => "ip" }));
vi.mock("@/lib/landing/settings", async () => {
  const { SUB_DEFAULTS } = await import("@/lib/rewards/config");
  subCfg = { ...SUB_DEFAULTS };
  return { getLandingSettings: async () => ({ frenzRewards: { sub: subCfg }, frenzAiCharacterReplace: { recharge: { checkoutCurrency: "NGN" } } }) };
});
vi.mock("@/lib/paystack/paystack", () => ({ SUB_PURPOSE: "frenz_sub", verifyTransaction: vi.fn(), initializeSubCheckout: () => initCheckout(), paystackFailureIsDefinite: () => false, paystackEnabled: async () => true }));
vi.mock("@/lib/ai/character-replace/fx-rate-server", () => ({ resolveCheckoutRate: async () => ({ minorPerUsd: 150000 }) }));

const { subTabFor } = await import("./profile");
const posts = await import("./posts");
const postsRoute = await import("@/app/api/sub/posts/route");
const postRoute = await import("@/app/api/sub/posts/[id]/route");
const checkoutRoute = await import("@/app/api/sub/checkout/route");

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CREATOR = U(1);
const FAN = U(2);
const LAPSED = U(3);
const REMOVED = U(4);
const STRANGER = U(5);
const OTHER_CREATOR = U(6);
const P = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const JPEG = { prefix: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]), size: 2000, contentType: "image/jpeg" };
const HTML = { prefix: new TextEncoder().encode("<!doctype html><script>alert(1)</script>"), size: 200, contentType: "image/jpeg" };
const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
const past = new Date(Date.now() - 3 * 86_400_000).toISOString();

beforeEach(() => {
  sessionUser = null;
  fileHead = JPEG;
  presign.mockClear();
  initCheckout.mockClear();
  db = fakeDb({
    creator_membership_settings: [{ creator_id: CREATOR, sub_price_cents: 1000, sub_active: true, setup_step: 4, setup_completed_at: "2026-10-01T00:00:00Z", open: false, welcome: null, promo_dismissed_at: null }],
    profiles: [CREATOR, FAN, LAPSED, REMOVED, STRANGER, OTHER_CREATOR].map((id) => ({ id, handle: `h${id.slice(-1)}`, is_suspended: false, is_hidden: false })),
    blocks: [],
    creator_memberships: [
      { id: "m1", creator_id: CREATOR, member_id: FAN, status: "active", billing: "sub", period_end: future, ended_at: null },
      { id: "m2", creator_id: CREATOR, member_id: LAPSED, status: "active", billing: "sub", period_end: past, ended_at: null },
      { id: "m3", creator_id: CREATOR, member_id: REMOVED, status: "removed", billing: "sub", period_end: future, ended_at: past },
    ],
    sub_posts: [
      { id: P(1), creator_id: CREATOR, caption: "locked caption", cover_url: null, status: "published", audience: "locked", created_at: "2026-10-15T10:00:00.000000+00:00" },
      { id: P(2), creator_id: CREATOR, caption: "hidden caption", cover_url: null, status: "published", audience: "hidden", created_at: "2026-10-14T10:00:00.000000+00:00" },
      { id: P(3), creator_id: CREATOR, caption: "taken down", cover_url: null, status: "archived", audience: "locked", created_at: "2026-10-13T10:00:00.000000+00:00" },
    ],
    sub_post_media: [P(1), P(2), P(3)].map((id, i) => ({ id: `md${i}`, post_id: id, idx: 0, media_kind: "image", object_key: `sub/${CREATOR}/${id}.jpg`, thumb_key: `sub/${CREATOR}/${id}-t.jpg`, width: 10, height: 10 })),
    sub_purchases: [],
    creator_notification_prefs: [],
  });
  db.unique.sub_purchases = [["reference"]];
  db.defaults.sub_purchases = { status: "initiated" }; // 0227's column default
  scriptOpenCheckoutGuard(db);
});

describe("the profile's Exclusive tab", () => {
  it("a creator with subscriptions on: visitors get the server's price + fee; the owner gets their settings", async () => {
    const visitor = await subTabFor(CREATOR, "Amaka", STRANGER, false);
    expect(visitor?.quote).toEqual({ priceCents: 1000, feeCents: 100, totalCents: 1100, feePercent: 10, periodDays: 30 });
    expect(visitor?.settings).toBeNull();
    const owner = await subTabFor(CREATOR, "Amaka", CREATOR, true);
    expect(owner?.settings).toMatchObject({ priceCents: 1000, active: true, setupCompleted: true });
  });

  it("subscriptions off or paused by the admin: no tab for visitors, never their settings; the owner keeps the tab", async () => {
    db.tables.creator_membership_settings![0]!.sub_active = false;
    expect(await subTabFor(CREATOR, "Amaka", STRANGER, false)).toBeNull();
    expect(await subTabFor(CREATOR, "Amaka", null, false)).toBeNull();
    expect((await subTabFor(CREATOR, "Amaka", CREATOR, true))?.settings).toMatchObject({ active: false });
    db.tables.creator_membership_settings![0]!.sub_active = true;
    subCfg.purchasesEnabled = false;
    expect(await subTabFor(CREATOR, "Amaka", STRANGER, false)).toBeNull();
    subCfg.purchasesEnabled = true;
  });

  it("a visitor who blocked the creator gets no tab; a suspended creator gets none; a hidden creator offers no NEW subscription", async () => {
    db.tables.blocks = [{ blocker_id: STRANGER, blocked_id: CREATOR }];
    expect(await subTabFor(CREATOR, "Amaka", STRANGER, false)).toBeNull();
    db.tables.blocks = [];
    db.tables.profiles!.find((p) => p.id === CREATOR)!.is_suspended = true;
    expect(await subTabFor(CREATOR, "Amaka", STRANGER, false)).toBeNull();
    db.tables.profiles!.find((p) => p.id === CREATOR)!.is_suspended = false;
    db.tables.profiles!.find((p) => p.id === CREATOR)!.is_hidden = true;
    const hidden = await subTabFor(CREATOR, "Amaka", FAN, false);
    expect(hidden).not.toBeNull();
    expect(hidden?.quote).toBeNull();
  });

  it("each visitor's own membership: active (until), expired (ended), removed or never → none, signed out → nothing", async () => {
    expect((await posts.listSubPosts(CREATOR, FAN)).membership).toEqual({ state: "active", until: future });
    expect((await posts.listSubPosts(CREATOR, LAPSED)).membership).toEqual({ state: "expired", endedAt: past });
    expect((await posts.listSubPosts(CREATOR, REMOVED)).membership).toEqual({ state: "none" });
    expect((await posts.listSubPosts(CREATOR, STRANGER)).membership).toEqual({ state: "none" });
    expect((await posts.listSubPosts(CREATOR, null)).membership).toBeUndefined();
    expect((await posts.listSubPosts(CREATOR, CREATOR)).membership).toBeUndefined();
  });

  it("expired and removed members see what a stranger sees: locked tiles only, no hidden post, no caption, no link", async () => {
    for (const viewer of [LAPSED, REMOVED, STRANGER, null]) {
      const out = await posts.listSubPosts(CREATOR, viewer);
      expect(out.posts.map((p) => p.id)).toEqual([P(1)]);
      expect(out.posts[0]!.caption).toBeNull();
    }
    expect(presign).not.toHaveBeenCalled();
  });
});

describe("the creator's studio", () => {
  it("the creator sees every published post with its audience, and a taken-down post marked — never openable", async () => {
    const out = await posts.listSubPosts(CREATOR, CREATOR);
    expect(out.posts.map((p) => [p.id, p.audience, p.removed ?? false])).toEqual([[P(1), "locked", false], [P(2), "hidden", false], [P(3), "locked", true]]);
    const removed = out.posts.find((p) => p.id === P(3))!;
    expect(removed.open).toBeUndefined();
    expect(await posts.openSubPost(P(3), CREATOR)).toMatchObject({ ok: false, status: 404 });
  });

  it("nobody else ever receives a taken-down post — not even an active subscriber", async () => {
    const out = await posts.listSubPosts(CREATOR, FAN);
    expect(out.posts.map((p) => p.id)).toEqual([P(1), P(2)]);
    expect(JSON.stringify(out)).not.toContain("taken down");
  });

  it("caption edits: own published post only; plain text; a taken-down post can't be edited back; others get 404", async () => {
    expect(await posts.setSubPostCaption(CREATOR, P(1), "  new words  ")).toEqual({ ok: true, caption: "new words" });
    expect(await posts.setSubPostCaption(CREATOR, P(1), "<script>")).toMatchObject({ ok: false, status: 400 });
    expect(await posts.setSubPostCaption(CREATOR, P(1), "x".repeat(2201))).toMatchObject({ ok: false, status: 400 });
    expect(await posts.setSubPostCaption(OTHER_CREATOR, P(1), "hijack")).toMatchObject({ ok: false, status: 404 });
    expect(await posts.setSubPostCaption(CREATOR, P(3), "revive")).toMatchObject({ ok: false, status: 404 });
    expect(db.tables.sub_posts!.find((p) => p.id === P(3))!.caption).toBe("taken down");
    // the edited caption is still subscriber-only
    expect((await posts.listSubPosts(CREATOR, STRANGER)).posts[0]!.caption).toBeNull();
    expect((await posts.listSubPosts(CREATOR, FAN)).posts[0]!.caption).toBe("new words");
  });

  it("the PATCH route acts only for the signed-in creator on their own post", async () => {
    const patch = (id: string, body: unknown) => postRoute.PATCH(new Request(`https://x/api/sub/posts/${id}`, { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
    expect((await patch(P(1), { caption: "x" })).status).toBe(401);
    sessionUser = { id: OTHER_CREATOR };
    expect((await patch(P(1), { caption: "hijack" })).status).toBe(404);
    expect((await patch(P(2), { audience: "locked" })).status).toBe(404);
    expect(db.tables.sub_posts!.find((p) => p.id === P(2))!.audience).toBe("hidden");
    sessionUser = { id: CREATOR };
    expect((await patch(P(1), { audience: "public" })).status).toBe(400);
    expect((await patch(P(1), { audience: "hidden" })).status).toBe(200);
  });

  it("switching a hidden post to locked shows non-subscribers a locked tile — never its caption or media", async () => {
    await posts.setSubPostAudience(CREATOR, P(2), "locked");
    const out = await posts.listSubPosts(CREATOR, STRANGER);
    const tile = out.posts.find((p) => p.id === P(2))!;
    expect(tile.caption).toBeNull();
    expect(tile).not.toHaveProperty("open");
    expect(presign).not.toHaveBeenCalled();
  });
});

describe("publishing", () => {
  const publish = (body: unknown) => postsRoute.POST(new Request("https://x/api/sub/posts", { method: "POST", body: JSON.stringify(body) }));
  const media = [{ key: `sub/${CREATOR}/fresh.jpg`, kind: "image" }];

  it("the creator publishes; locked and hidden persist as chosen", async () => {
    sessionUser = { id: CREATOR };
    const a = await publish({ caption: "hello", media, audience: "hidden" });
    expect(a.status).toBe(200);
    const b = await publish({ media });
    expect(b.status).toBe(200);
    const ids = [(await a.json()).id, (await b.json()).id];
    expect(ids.map((id) => db.tables.sub_posts!.find((p) => p.id === id)!.audience)).toEqual(["hidden", "locked"]);
  });

  it("nobody can publish for someone else: another user's files are refused, and signed-out is 401", async () => {
    expect((await publish({ media })).status).toBe(401);
    sessionUser = { id: OTHER_CREATOR };
    db.tables.creator_membership_settings!.push({ creator_id: OTHER_CREATOR, sub_price_cents: 500, sub_active: true });
    const res = await publish({ media });
    expect(res.status).toBe(403);
    expect(db.tables.sub_posts!.filter((p) => p.creator_id === OTHER_CREATOR)).toHaveLength(0);
  });

  it("an invalid audience is refused by the route; a fake file (HTML named .jpg) is refused by its bytes", async () => {
    sessionUser = { id: CREATOR };
    expect((await publish({ media, audience: "everyone" })).status).toBe(400);
    fileHead = HTML;
    const fake = await publish({ media });
    expect(fake.status).toBe(422);
    expect(db.tables.sub_posts).toHaveLength(3);
  });
});

describe("subscribing from the card", () => {
  const subscribe = (creatorId: string) => checkoutRoute.POST(new Request("https://x/api/sub/checkout", { method: "POST", body: JSON.stringify({ creatorId, returnPath: "/u/h1?tab=sub" }) }));

  it("checkout charges the server's price + fee; a double tap reuses the same checkout — one purchase row", async () => {
    sessionUser = { id: STRANGER, email: "s@x.co" };
    const a = await subscribe(CREATOR);
    const b = await subscribe(CREATOR);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(db.tables.sub_purchases).toHaveLength(1);
    expect(db.tables.sub_purchases![0]).toMatchObject({ price_cents: 1000, fee_cents: 100, total_cents: 1100 });
    expect(initCheckout).toHaveBeenCalledTimes(1);
    expect(await b.json()).toMatchObject({ reused: true });
    // nothing about the membership changes until Paystack confirms a payment
    expect(db.writes.filter((w) => w.table === "creator_memberships")).toEqual([]);
  });

  it("a removed member, or a creator who stopped selling, gets a safe error and nothing is created", async () => {
    sessionUser = { id: REMOVED, email: "r@x.co" };
    expect((await subscribe(CREATOR)).status).toBe(403);
    db.tables.creator_membership_settings![0]!.sub_active = false;
    sessionUser = { id: STRANGER, email: "s@x.co" };
    expect((await subscribe(CREATOR)).status).toBe(409);
    expect(db.tables.sub_purchases).toHaveLength(0);
  });
});
