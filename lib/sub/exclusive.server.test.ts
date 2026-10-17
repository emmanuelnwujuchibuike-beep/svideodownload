import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Exclusive Part 3 — hidden posts, the Exclusive feed and locked previews, through the
 * REAL server modules and routes (lib/sub/feed, lib/sub/posts, interactions, capture,
 * moderation, private-notify, /api/sub/feed, /api/sub/checkout) over an in-memory database
 * whose `.or()` filters and multi-column ordering are evaluated for real (keyset cursors).
 * Private storage is a recorder: what matters is which keys were ever signed, for whom.
 */

let db: FakeDb;
let sessionUser: { id: string; email?: string } | null = null;
const presign = vi.fn(async (key: string) => `https://private.example/${key}?sig=1`);
const pushed = vi.fn(async (_to: string) => {});
const emailed = vi.fn(async (_to: string) => {});

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }) }));
vi.mock("@/lib/storage/r2", () => ({ hasPrivateR2: true, presignPrivateGet: (k: string) => presign(k), presignPrivatePut: vi.fn(async () => "https://put"), deletePrivate: vi.fn(), readPrivatePrefix: vi.fn(async () => ({ prefix: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]), size: 1000, contentType: "image/jpeg" })) }));
vi.mock("@/lib/rate-limit", () => ({ trackLimiter: { limit: async () => ({ success: true }) }, clientId: () => "ip" }));
vi.mock("@/lib/security/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/lib/landing/settings", async () => {
  const { SUB_DEFAULTS } = await import("@/lib/rewards/config");
  return { getLandingSettings: async () => ({ frenzRewards: { sub: SUB_DEFAULTS }, frenzAiCharacterReplace: { recharge: { checkoutCurrency: "NGN" } } }) };
});
vi.mock("@/lib/notifications/smart-delivery", () => ({ sendSmartPush: (to: string) => pushed(to) }));
vi.mock("@/lib/email/member-email", () => ({ emailMember: (to: string) => emailed(to) }));
vi.mock("@/lib/push/identity", () => ({ pushPerson: async () => ({ name: "Creator", handle: "c1", icon: null }) }));
vi.mock("@/lib/social/creator-notify-emit", () => ({ excludedFor: async () => new Set<string>() }));
vi.mock("@/lib/paystack/paystack", () => ({ SUB_PURPOSE: "frenz_sub", verifyTransaction: vi.fn(), initializeSubCheckout: vi.fn(async () => "https://checkout.paystack.com/x"), paystackFailureIsDefinite: () => false }));

const feed = await import("./feed");
const posts = await import("./posts");
const interactions = await import("./interactions");
const capture = await import("./capture");
const moderation = await import("./moderation");
const notify = await import("./private-notify");
const guards = await import("./guards");
const feedRoute = await import("@/app/api/sub/feed/route");
const checkoutRoute = await import("@/app/api/sub/checkout/route");

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const VIEWER = U(1);
const C = { active: U(11), expired: U(12), removed: U(13), refunded: U(14), blocked: U(15), suspended: U(16), discover: U(17), hiddenOnly: U(18), notLive: U(19), other: U(20) };
const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();
const P = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// timestamps with deliberate TIES (three posts per second) and microseconds, as Postgres writes them
const ts = (i: number) => `2026-10-${String(10 + Math.floor(i / 9)).padStart(2, "0")}T10:00:0${Math.floor((i % 9) / 3)}.123456+00:00`;

function seed() {
  const membership = (creator: string, over: Record<string, unknown> = {}) => ({ id: `m-${creator}`, creator_id: creator, member_id: VIEWER, status: "active", billing: "sub", period_end: future, ...over });
  const subPosts: Record<string, unknown>[] = [];
  const media: Record<string, unknown>[] = [];
  // 30 published posts by the active creator, every 5th hidden, plus one archived
  for (let i = 0; i < 30; i++) subPosts.push({ id: P(i), creator_id: C.active, caption: `post ${i}`, cover_url: null, status: "published", audience: i % 5 === 0 ? "hidden" : "locked", created_at: ts(i) });
  subPosts.push({ id: P(99), creator_id: C.active, caption: "taken down", status: "archived", audience: "locked", created_at: ts(31) });
  // one post each from creators the viewer may NOT see
  for (const [k, id] of Object.entries(C)) if (k !== "active") subPosts.push({ id: `20000000-0000-4000-8000-0000000000${String(Object.keys(C).indexOf(k)).padStart(2, "0")}`, creator_id: id, caption: `secret of ${k}`, cover_url: k === "discover" ? "https://cdn.example/cover.jpg" : null, status: "published", audience: k === "hiddenOnly" ? "hidden" : "locked", created_at: ts(5) });
  for (const p of subPosts) {
    media.push({ id: `${p.id}-0`, post_id: p.id, idx: 0, media_kind: "image", object_key: `sub/${p.creator_id}/${p.id}-orig.jpg`, thumb_key: `sub/${p.creator_id}/${p.id}-thumb.jpg` });
    media.push({ id: `${p.id}-1`, post_id: p.id, idx: 1, media_kind: "video", object_key: `sub/${p.creator_id}/${p.id}-orig.mp4`, thumb_key: null });
  }
  return fakeDb({
    sub_posts: subPosts,
    sub_post_media: media,
    sub_post_comments: [],
    creator_memberships: [
      membership(C.active),
      membership(C.expired, { period_end: past }),
      membership(C.removed, { status: "removed" }),
      membership(C.refunded, { status: "ended" }),
      membership(C.blocked),
      membership(C.suspended),
    ],
    blocks: [{ blocker_id: VIEWER, blocked_id: C.blocked }],
    profiles: [VIEWER, ...Object.values(C)].map((id) => ({ id, handle: `h${id.slice(-2)}`, display_name: `Name ${id.slice(-2)}`, avatar_url: null, is_verified: false, is_suspended: id === C.suspended, is_hidden: false })),
    follows: [C.discover, C.hiddenOnly, C.notLive, C.active].map((id) => ({ follower_id: VIEWER, following_id: id })),
    creator_membership_settings: [
      { creator_id: C.discover, sub_active: true, sub_price_cents: 500 },
      { creator_id: C.hiddenOnly, sub_active: true, sub_price_cents: 700 },
      { creator_id: C.notLive, sub_active: false, sub_price_cents: 900 },
      { creator_id: C.active, sub_active: true, sub_price_cents: 300 },
    ],
    creator_notification_prefs: [],
    sub_purchases: [],
    notifications: [],
    reports: [],
  });
}

beforeEach(() => {
  db = seed();
  db.defaults.reports = { status: "open" };
  db.unique.reports = [["reporter_id", "target_type", "target_id"]];
  sessionUser = null;
  presign.mockClear();
  pushed.mockClear();
  emailed.mockClear();
});

async function allPages(viewer = VIEWER) {
  const pages: Awaited<ReturnType<typeof feed.exclusiveFeed>>[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 10; guard++) {
    const p = await feed.exclusiveFeed(viewer, cursor);
    pages.push(p);
    if (!p.ok || !p.next) break;
    cursor = p.next;
  }
  return pages;
}

describe("the Exclusive feed: who sees what", () => {
  it("a signed-out request gets 401 and nothing else", async () => {
    const res = await feedRoute.GET(new Request("https://x/api/sub/feed"));
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("an active subscriber sees every published post of that creator — hidden ones included — and nothing else", async () => {
    const pages = await allPages();
    const ids = pages.flatMap((p) => (p.ok ? p.posts.map((x) => x.id) : []));
    const expected = Array.from({ length: 30 }, (_, i) => P(i));
    expect(new Set(ids)).toEqual(new Set(expected));
    expect(pages.flatMap((p) => (p.ok ? p.posts : [])).every((p) => p.creatorId === C.active)).toBe(true);
    // hidden posts are marked for the subscriber
    expect(pages.flatMap((p) => (p.ok ? p.posts : [])).filter((p) => p.hidden).length).toBe(6);
  });

  it("expired, removed, refunded (ended), blocked and suspended creators, and archived posts, never appear", async () => {
    const json = JSON.stringify(await allPages());
    for (const k of ["expired", "removed", "refunded", "blocked", "suspended"]) expect(json).not.toContain(`secret of ${k}`);
    expect(json).not.toContain("taken down");
    expect(json).not.toContain(P(99));
  });

  it("access is re-decided per page: a subscription that ends mid-scroll ends the next page", async () => {
    const first = await feed.exclusiveFeed(VIEWER);
    expect(first.ok && first.posts.length).toBe(12);
    db.tables.creator_memberships!.find((m) => m.creator_id === C.active)!.period_end = past;
    const second = await feed.exclusiveFeed(VIEWER, first.ok ? first.next : null);
    expect(second.ok && second.posts).toEqual([]);
  });

  it("a viewer with no subscriptions gets an empty feed, not an error", async () => {
    db.tables.creator_memberships = [];
    const out = await feed.exclusiveFeed(VIEWER);
    expect(out).toMatchObject({ ok: true, posts: [], subscriptions: 0, next: null });
  });
});

describe("paging", () => {
  it("keyset order (created_at desc, id desc) with ties: deterministic, no duplicates, nothing skipped, bounded pages", async () => {
    const pages = await allPages();
    const all = pages.flatMap((p) => (p.ok ? p.posts : []));
    expect(pages.every((p) => p.ok && p.posts.length <= feed.FEED_PAGE)).toBe(true);
    expect(pages.length).toBe(3);
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
    const sorted = [...all].sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1));
    expect(all.map((p) => p.id)).toEqual(sorted.map((p) => p.id));
    const last = pages.at(-1)!;
    expect(last.ok ? last.next : "failed").toBeNull();
  });

  it("a post published while scrolling never shifts a page (the cursor is a position, not an offset)", async () => {
    const first = await feed.exclusiveFeed(VIEWER);
    db.tables.sub_posts!.push({ id: P(500), creator_id: C.active, caption: "brand new", status: "published", audience: "locked", created_at: "2026-10-30T00:00:00.000000+00:00" });
    const second = await feed.exclusiveFeed(VIEWER, first.ok ? first.next : null);
    const a = first.ok ? first.posts.map((p) => p.id) : [];
    const b = second.ok ? second.posts.map((p) => p.id) : [];
    expect(a.filter((id) => b.includes(id))).toEqual([]);
    expect(b).not.toContain(P(500));
  });

  it("a malformed or tampered cursor is refused, and a cursor can never widen access", async () => {
    expect(await feed.exclusiveFeed(VIEWER, "not-a-cursor")).toMatchObject({ ok: false, status: 400 });
    expect(await feed.exclusiveFeed(VIEWER, Buffer.from(`2026-10-10T10:00:00Z|x),or(id.neq.0`).toString("base64url"))).toMatchObject({ ok: false, status: 400 });
    // a valid-looking cursor built from ANOTHER creator's post still only returns this viewer's creators
    const forged = guards.encodeSubCursor("2027-01-01T00:00:00.000000+00:00", "20000000-0000-4000-8000-000000000001");
    const out = await feed.exclusiveFeed(VIEWER, forged);
    expect(out.ok && out.posts.every((p) => p.creatorId === C.active)).toBe(true);
  });
});

describe("what a feed response carries", () => {
  it("only the fields the UI needs — never a storage key — and ONE preview link per post", async () => {
    const out = await feed.exclusiveFeed(VIEWER);
    if (!out.ok) throw new Error("feed failed");
    for (const p of out.posts) expect(Object.keys(p).sort()).toEqual(["caption", "createdAt", "creatorId", "hasVideo", "hidden", "id", "items", "previewUrl"]);
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/object_key|thumb_key|-orig\./);
    expect(presign).toHaveBeenCalledTimes(out.posts.length);
    for (const [key] of presign.mock.calls) expect(key).toMatch(/-thumb\.jpg$/);
    expect(out.posts[0]).toMatchObject({ items: 2, hasVideo: true });
  });
});

describe("hidden posts are absent for anyone without access", () => {
  const STRANGER = U(2);
  const hiddenIds = Array.from({ length: 6 }, (_, i) => P(i * 5));

  it("the creator's gallery gives a non-subscriber locked tiles only — no hidden id, date, count or cursor", async () => {
    const seenIds: string[] = [];
    let before: string | null = null;
    for (let guard = 0; guard < 5; guard++) {
      const page = await posts.listSubPosts(C.active, STRANGER, before);
      seenIds.push(...page.posts.map((p) => p.id));
      for (const p of page.posts) expect(p).not.toHaveProperty("audience");
      if (page.next) {
        const c = guards.decodeSubCursor(page.next);
        expect(c !== "invalid" && c && hiddenIds.includes(c.id ?? "")).toBe(false);
      }
      if (!page.next) break;
      before = page.next;
    }
    expect(seenIds.length).toBe(24);
    for (const h of hiddenIds) expect(seenIds).not.toContain(h);
    expect(presign).not.toHaveBeenCalled();
  });

  it("a non-subscriber sees how many videos and photos there are — counting ONLY locked, published posts (owner 2026-10-17)", async () => {
    const page = await posts.listSubPosts(C.active, STRANGER);
    // 30 published, 6 hidden, 1 archived; each post one photo and one video
    expect(page.totals).toEqual({ images: 24, videos: 24 });
    const signedOut = await posts.listSubPosts(C.active, null);
    expect(signedOut.totals).toEqual({ images: 24, videos: 24 });
  });

  it("the counts come only with the first page, and never to a subscriber or the creator (they see the posts)", async () => {
    // a stranger's 24 locked posts fit one page, so take a real cursor from the subscriber's 30
    const cursor = (await posts.listSubPosts(C.active, VIEWER)).next;
    expect(cursor).toBeTruthy();
    expect((await posts.listSubPosts(C.active, STRANGER, cursor)).totals).toBeUndefined();
    expect((await posts.listSubPosts(C.active, VIEWER)).totals).toBeUndefined();
    expect((await posts.listSubPosts(C.active, C.active)).totals).toBeUndefined();
  });

  it("a subscriber's gallery includes hidden posts, marked", async () => {
    const page = await posts.listSubPosts(C.active, VIEWER);
    expect(page.posts.some((p) => p.audience === "hidden")).toBe(true);
  });

  it("opening, liking, commenting, the screenshot alert and reporting all answer a hidden post exactly like a missing one", async () => {
    const hidden = P(0);
    const missing = P(777);
    expect(await posts.openSubPost(hidden, STRANGER)).toEqual(await posts.openSubPost(missing, STRANGER));
    expect(await posts.openSubPost(hidden, STRANGER)).toMatchObject({ ok: false, status: 404 });
    expect(await posts.openSubPost(P(1), STRANGER)).toMatchObject({ ok: false, status: 403 }); // a LOCKED post may say "subscribe"
    expect(await interactions.interactionSummary(hidden, STRANGER)).toEqual(await interactions.interactionSummary(missing, STRANGER));
    expect(await interactions.addComment(hidden, STRANGER, "hi")).toMatchObject({ ok: false, status: 404 });
    expect(await capture.reportSubCapture(hidden, STRANGER, "print_screen")).toEqual(await capture.reportSubCapture(missing, STRANGER, "print_screen"));
    expect(await moderation.reportSubTarget(STRANGER, "sub_post", hidden, "Spam", null)).toEqual(await moderation.reportSubTarget(STRANGER, "sub_post", missing, "Spam", null));
    expect(db.tables.reports).toHaveLength(0);
    expect(presign).not.toHaveBeenCalled();
  });

  it("a subscriber can open a hidden post", async () => {
    expect(await posts.openSubPost(P(0), VIEWER)).toMatchObject({ ok: true, audience: "hidden" });
  });

  it("a hidden post is announced only to active subscribers", async () => {
    db.tables.creator_notification_prefs = [VIEWER, STRANGER].map((v) => ({ viewer_id: v, target_id: C.active, private_posts: "both" }));
    await notify.notifyNewPrivatePost(C.active, { audience: "hidden" });
    expect(pushed.mock.calls.map((c) => c[0])).toEqual([VIEWER]);
    expect(emailed.mock.calls.map((c) => c[0])).toEqual([VIEWER]);
    pushed.mockClear();
    await notify.notifyNewPrivatePost(C.active, { audience: "locked" });
    expect(pushed.mock.calls.map((c) => c[0]).sort()).toEqual([VIEWER, STRANGER].sort());
  });
});

describe("creators manage their own posts' audience, nobody else's", () => {
  it("own post: switches; invalid values refused; someone else's post or a taken-down one: 404", async () => {
    expect(await posts.setSubPostAudience(C.active, P(1), "hidden")).toEqual({ ok: true });
    expect(db.tables.sub_posts!.find((p) => p.id === P(1))!.audience).toBe("hidden");
    expect(await posts.setSubPostAudience(C.active, P(1), "public")).toMatchObject({ ok: false, status: 400 });
    expect(await posts.setSubPostAudience(C.other, P(2), "hidden")).toMatchObject({ ok: false, status: 404 });
    expect(db.tables.sub_posts!.find((p) => p.id === P(2))!.audience).toBe("locked");
    expect(await posts.setSubPostAudience(C.active, P(99), "hidden")).toMatchObject({ ok: false, status: 404 });
  });

  it("publishing: hidden is stored as hidden, an invalid audience is refused, nothing is published", async () => {
    const media = [{ key: `sub/${C.active}/new.jpg`, kind: "image" }];
    const bad = await posts.createSubPost(C.active, { media, audience: "everyone" });
    expect(bad).toMatchObject({ ok: false });
    const good = await posts.createSubPost(C.active, { media, audience: "hidden" });
    expect(good).toMatchObject({ ok: true, audience: "hidden" });
    expect(db.tables.sub_posts!.find((p) => p.id === (good.ok ? good.id : ""))!.audience).toBe("hidden");
    expect(await posts.createSubPost(C.active, { media })).toMatchObject({ ok: true, audience: "locked" });
  });
});

describe("locked previews and checkout", () => {
  it("discover shows LOCKED posts of followed, live, unsubscribed creators, with the server's price — never a hidden post", async () => {
    const out = await feed.exclusiveFeed(VIEWER);
    if (!out.ok || !out.discover) throw new Error("no discover");
    expect(out.discover.cards.map((c) => c.creatorId)).toEqual([C.discover]);
    const card = out.discover.cards[0]!;
    expect(Object.keys(card).sort()).toEqual(["coverUrl", "createdAt", "creatorId", "hasVideo", "id", "items"]);
    expect(out.discover.creators[C.discover]).toMatchObject({ priceCents: 500, totalCents: 550, periodDays: 30 });
    const json = JSON.stringify(out.discover);
    expect(json).not.toContain("secret of");
    expect(json).not.toContain(C.hiddenOnly);
    expect(json).not.toMatch(/private\.example|object_key/);
    // the second page carries no discover section
    const second = await feed.exclusiveFeed(VIEWER, out.next);
    expect(second.ok && second.discover).toBeUndefined();
  });

  it("the feed never creates or settles a purchase", async () => {
    await allPages();
    expect(db.writes.filter((w) => w.table === "sub_purchases" || w.table === "creator_memberships")).toEqual([]);
  });

  it("checkout refuses a browser-supplied price (strict body) and creates nothing", async () => {
    sessionUser = { id: VIEWER, email: "v@x.co" };
    const res = await checkoutRoute.POST(new Request("https://x/api/sub/checkout", { method: "POST", body: JSON.stringify({ creatorId: C.discover, returnPath: "/exclusive", priceCents: 1 }) }));
    expect(res.status).toBe(400);
    expect(db.tables.sub_purchases).toHaveLength(0);
  });

  it("checkout for a creator who stopped taking subscriptions answers a safe error and creates nothing", async () => {
    sessionUser = { id: VIEWER, email: "v@x.co" };
    const res = await checkoutRoute.POST(new Request("https://x/api/sub/checkout", { method: "POST", body: JSON.stringify({ creatorId: C.notLive, returnPath: "/exclusive" }) }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: expect.any(String) });
    expect(db.tables.sub_purchases).toHaveLength(0);
  });

  it("checkout for a live creator charges the SERVER's price (price + fee), not anything from the page", async () => {
    sessionUser = { id: VIEWER, email: "v@x.co" };
    const fx = await import("@/lib/ai/character-replace/fx-rate-server");
    vi.spyOn(fx, "resolveCheckoutRate").mockResolvedValue({ minorPerUsd: 150000 } as never);
    const res = await checkoutRoute.POST(new Request("https://x/api/sub/checkout", { method: "POST", body: JSON.stringify({ creatorId: C.discover, returnPath: "/exclusive" }) }));
    expect(res.status).toBe(200);
    expect(db.tables.sub_purchases![0]).toMatchObject({ creator_id: C.discover, subscriber_id: VIEWER, price_cents: 500, fee_cents: 50, total_cents: 550 });
  });
});

describe("cursor helpers", () => {
  it("round-trip keeps microseconds; anything else is invalid", () => {
    const at = "2026-10-15T10:00:00.123456+00:00";
    expect(guards.decodeSubCursor(guards.encodeSubCursor(at, U(5)))).toEqual({ at, id: U(5) });
    expect(guards.decodeSubCursor(at)).toEqual({ at, id: null });
    for (const bad of ["", "x".repeat(300), Buffer.from("x|y").toString("base64url"), Buffer.from(`${at}|${U(5)}|extra`).toString("base64url")]) {
      expect(guards.decodeSubCursor(bad) === "invalid" || guards.decodeSubCursor(bad) === null).toBe(true);
    }
    // whatever decodes is validated: a forged id or timestamp inside a well-formed cursor is refused
    expect(guards.decodeSubCursor(Buffer.from(`${at}|not-a-uuid`).toString("base64url"))).toBe("invalid");
    expect(guards.decodeSubCursor(Buffer.from(`yesterday|${U(5)}`).toString("base64url"))).toBe("invalid");
    expect(guards.decodeSubCursor(Buffer.from(`${at}\"),or(id.neq.0|${U(5)}`).toString("base64url"))).toBe("invalid");
  });
  it("audience: only locked/hidden are valid; anything else behaves as locked", () => {
    expect(guards.isSubAudience("hidden")).toBe(true);
    expect(guards.isSubAudience("public")).toBe(false);
    expect(guards.audienceOf(undefined)).toBe("locked");
    expect(guards.visibleTo("hidden", false)).toBe(false);
    expect(guards.visibleTo("hidden", true)).toBe(true);
    expect(guards.visibleTo("locked", false)).toBe(true);
  });
});

// Part 8 audit: a suspended creator's (or viewer's) exclusive content is not reachable by id
describe("suspension ends access everywhere, not only in the feed and the profile", () => {
  const SUSPENDED_POST = "20000000-0000-4000-8000-000000000005";
  it("an active subscriber of a SUSPENDED creator can't open a post by id, list the gallery, or comment — and nothing is signed", async () => {
    presign.mockClear();
    expect(db.tables.creator_memberships!.some((m) => m.creator_id === C.suspended && m.status === "active")).toBe(true);
    expect(await posts.openSubPost(SUSPENDED_POST, VIEWER)).toMatchObject({ ok: false });
    const gallery = await posts.listSubPosts(C.suspended, VIEWER);
    expect(gallery.access).toBe(false);
    expect(JSON.stringify(gallery)).not.toContain("secret of suspended");
    expect(await interactions.addComment(SUSPENDED_POST, VIEWER, "hi")).toMatchObject({ ok: false });
    expect(presign).not.toHaveBeenCalled();
  });

  it("a SUSPENDED viewer loses access to a creator they pay for", async () => {
    presign.mockClear();
    expect(await posts.openSubPost(P(1), VIEWER)).toMatchObject({ ok: true });
    db.tables.profiles!.find((p) => p.id === VIEWER)!.is_suspended = true;
    presign.mockClear();
    expect(await posts.openSubPost(P(1), VIEWER)).toMatchObject({ ok: false });
    expect(presign).not.toHaveBeenCalled();
  });

  it("a failed profile read is no access (fails closed)", async () => {
    db.failOn.profiles = "outage";
    expect(await posts.openSubPost(P(1), VIEWER)).toMatchObject({ ok: false });
  });
});
