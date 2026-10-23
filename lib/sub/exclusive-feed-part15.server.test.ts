import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Exclusive Part 15 — the feed's server side: discover alongside the feed with ONE block-list
 * read, the membership's access-until date with no extra query, the purchase fee shown apart, the
 * access-checked preview refresh, and the server-rendered first page.
 *
 * The database is the in-memory fake (real filter/order evaluation) behind a recorder that notes when
 * every read starts and ends and can add a simulated delay. Timings here are MOCKED latency — they show
 * which reads overlap, not how fast Postgres is.
 */

let db: FakeDb;
let sessionUser: { id: string } | null = null;
let delayMs = 0;
let reads: { table: string; start: number; end: number }[] = [];
const presign = vi.fn(async (key: string, _ttl?: number) => `https://private.example/${key}?sig=${Math.random().toString(36).slice(2, 8)}`);

/** Wraps a fake query builder: records the read and delays its answer. */
function recorded(builder: Record<string, unknown>, table: string): unknown {
  const entry = { table, start: 0, end: 0 };
  const proxy: unknown = new Proxy(builder, {
    get(b, prop) {
      const v = Reflect.get(b, prop) as unknown;
      if (prop === "then" && typeof v === "function")
        return (res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          entry.start = performance.now();
          reads.push(entry);
          return new Promise((r) => setTimeout(r, delayMs))
            .then(() => new Promise((r, j) => (v as (a: unknown, b: unknown) => unknown).call(b, r, j)))
            .then((x) => ((entry.end = performance.now()), x))
            .then(res, rej);
        };
      if (typeof v === "function") return (...a: unknown[]) => ((r) => (r === b ? proxy : r))((v as (...x: unknown[]) => unknown).apply(b, a));
      return v;
    },
  });
  return proxy;
}
const client = () => {
  const real = db.client() as { from: (t: string) => Record<string, unknown> };
  return new Proxy(real, { get: (t, p) => (p === "from" ? (table: string) => recorded(t.from(table), table) : Reflect.get(t, p)) });
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }) }));
vi.mock("@/lib/storage/r2", () => ({ hasPrivateR2: true, presignPrivateGet: (k: string, ttl?: number) => presign(k, ttl) }));
vi.mock("@/lib/rate-limit", () => ({ trackLimiter: { limit: async () => ({ success: true }) } }));
vi.mock("@/lib/landing/settings", async () => {
  const { SUB_DEFAULTS } = await import("@/lib/rewards/config");
  return { getLandingSettings: async () => ({ frenzRewards: { sub: SUB_DEFAULTS } }) };
});

const feed = await import("./feed");
const feedRoute = await import("@/app/api/sub/feed/route");
const previewsRoute = await import("@/app/api/sub/feed/previews/route");

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const VIEWER = U(1);
const C = { active: U(11), expired: U(12), blocked: U(13), suspended: U(14), discover: U(15), blocksMe: U(16) };
const P = { photo: U(101), videoThumb: U(102), videoBare: U(103), archived: U(104), expired: U(105), blocked: U(106), suspended: U(107), discover: U(108), blocksMe: U(109) };
const soon = new Date(Date.now() + 10 * 86_400_000).toISOString();
const later = new Date(Date.now() + 20 * 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

function seed() {
  const post = (id: string, creator: string, i: number, over: Record<string, unknown> = {}) => ({ id, creator_id: creator, caption: `cap ${id.slice(-3)}`, cover_url: null, status: "published", audience: "locked", created_at: `2026-10-1${i}T10:00:00.000000+00:00`, ...over });
  const membership = (creator: string, over: Record<string, unknown> = {}) => ({ id: `m-${creator}-${Math.random()}`, creator_id: creator, member_id: VIEWER, status: "active", billing: "sub", period_end: soon, ...over });
  return fakeDb({
    sub_posts: [
      post(P.photo, C.active, 5),
      post(P.videoThumb, C.active, 4),
      post(P.videoBare, C.active, 3),
      post(P.archived, C.active, 6, { status: "archived" }),
      post(P.expired, C.expired, 5),
      post(P.blocked, C.blocked, 5),
      post(P.suspended, C.suspended, 5),
      post(P.discover, C.discover, 5, { cover_url: "https://cdn.example/cover.jpg" }),
      post(P.blocksMe, C.blocksMe, 5),
    ],
    sub_post_media: [
      { post_id: P.photo, idx: 0, media_kind: "image", object_key: "sub/a/photo-orig.jpg", thumb_key: "sub/a/photo-thumb.jpg" },
      { post_id: P.photo, idx: 1, media_kind: "image", object_key: "sub/a/photo2-orig.jpg", thumb_key: null },
      { post_id: P.videoThumb, idx: 0, media_kind: "video", object_key: "sub/a/v-orig.mp4", thumb_key: "sub/a/v-thumb.jpg" },
      { post_id: P.videoBare, idx: 0, media_kind: "video", object_key: "sub/a/bare-orig.mp4", thumb_key: null },
      ...[P.archived, P.expired, P.blocked, P.suspended, P.discover, P.blocksMe].map((id) => ({ post_id: id, idx: 0, media_kind: "image", object_key: `sub/x/${id}-orig.jpg`, thumb_key: `sub/x/${id}-thumb.jpg` })),
    ],
    creator_memberships: [
      membership(C.active, { period_end: soon }),
      // a second, later paid period for the same creator: the LATEST end is the one shown
      membership(C.active, { period_end: later }),
      membership(C.expired, { period_end: past }),
      membership(C.blocked),
      membership(C.suspended),
    ],
    blocks: [
      { blocker_id: VIEWER, blocked_id: C.blocked },
      { blocker_id: C.blocksMe, blocked_id: VIEWER },
    ],
    profiles: [VIEWER, ...Object.values(C)].map((id) => ({ id, handle: `h${id.slice(-2)}`, display_name: `Name ${id.slice(-2)}`, avatar_url: null, is_verified: id === C.active, is_suspended: id === C.suspended, is_hidden: false })),
    follows: [C.discover, C.blocksMe, C.active].map((id) => ({ follower_id: VIEWER, following_id: id })),
    creator_membership_settings: [C.discover, C.blocksMe, C.active].map((id) => ({ creator_id: id, sub_active: true, sub_price_cents: 500 })),
  });
}

beforeEach(() => {
  db = seed();
  sessionUser = null;
  delayMs = 0;
  reads = [];
  presign.mockClear();
});

const count = (table: string) => reads.filter((r) => r.table === table).length;

describe("first page: discover alongside the feed, one block-list read", () => {
  it("reads the block list ONCE and the memberships ONCE for the whole first page (feed + discover)", async () => {
    const out = await feed.exclusiveFeed(VIEWER);
    if (!out.ok) throw new Error("feed failed");
    expect(out.discover?.cards.length).toBe(1);
    expect(count("blocks")).toBe(1);
    expect(count("creator_memberships")).toBe(1);
    // a later page reads no discover at all
    reads = [];
    const { encodeSubCursor } = await import("./guards");
    const later = await feed.exclusiveFeed(VIEWER, encodeSubCursor("2026-10-14T10:00:00.000000+00:00", P.videoThumb));
    expect(later.ok && later.posts.map((p) => p.id)).toEqual([P.videoBare]);
    expect(later.ok && later.discover).toBeUndefined();
    expect(count("follows")).toBe(0);
  });

  it("🔴 2026-10-22: EVERY creator taking subscriptions is offered — following them is not required", async () => {
    // the viewer follows nobody now
    db.tables.follows = [];
    const out = await feed.discover(VIEWER, new Set([C.active]));
    const creators = new Set(out.cards.map((c) => c.creatorId));
    expect(creators.has(C.discover)).toBe(true);
    // teeth: still never one the viewer subscribes to, one who blocked them, or the viewer themselves
    expect(creators.has(C.active)).toBe(false);
    expect(creators.has(C.blocksMe)).toBe(false);
    expect(creators.has(VIEWER)).toBe(false);
  });

  it("several locked posts of one creator, not one card each", async () => {
    db.tables.sub_posts!.push({ id: U(120), creator_id: C.discover, caption: "two", cover_url: null, status: "published", audience: "locked", created_at: "2026-10-16T10:00:00.000000+00:00" });
    const out = await feed.discover(VIEWER, new Set([C.active]));
    expect(out.cards.filter((c) => c.creatorId === C.discover).length).toBe(2);
  });

  it("teeth: discover on its own (no block list handed over) still reads it itself", async () => {
    await feed.discover(VIEWER, new Set([C.active]));
    expect(count("blocks")).toBe(1);
  });

  it("discover's reads start while the feed's own reads are still running (simulated 25 ms per read)", async () => {
    delayMs = 25;
    const out = await feed.exclusiveFeed(VIEWER);
    if (!out.ok) throw new Error("feed failed");
    // 2026-10-22: discover no longer reads the viewer's follows (it offers every creator taking subscriptions),
    // so its first round is the creators' subscription settings, its second their locked posts
    const feedPosts = reads.filter((r) => r.table === "sub_posts")[0]!;
    const settings = reads.find((r) => r.table === "creator_membership_settings")!;
    const discoverPosts = reads.filter((r) => r.table === "sub_posts")[1]!;
    const feedMedia = reads.filter((r) => r.table === "sub_post_media")[0]!;
    expect(reads.find((r) => r.table === "follows")).toBeUndefined();
    // discover's first read began before the feed's post read had even finished …
    expect(settings.start).toBeLessThan(feedPosts.end);
    // … and its SECOND round began before the feed's last read ended. Ordering, not durations (Part 16:
    // a wall-clock bound here failed under a loaded parallel run); run one after the other, impossible.
    expect(discoverPosts.start).toBeLessThan(feedMedia.end);
  });

  it("same result as discover computed the old way: same cards, order, exclusions and prices", async () => {
    const out = await feed.exclusiveFeed(VIEWER);
    if (!out.ok) throw new Error("feed failed");
    // the subscribed set discover is given: active memberships minus blocks (before the visibility filter)
    expect(out.discover).toEqual(await feed.discover(VIEWER, new Set([C.active, C.suspended])));
    const ids = out.discover!.cards.map((c) => c.creatorId);
    expect(ids).toEqual([C.discover]);
    // blocked either way, or already subscribed: never offered
    expect(ids).not.toContain(C.blocksMe);
    expect(ids).not.toContain(C.active);
  });

  it("a failed block-list read fails CLOSED for the feed AND empties discover", async () => {
    db.failOn.blocks = "outage";
    const out = await feed.exclusiveFeed(VIEWER);
    if (!out.ok) throw new Error("feed failed");
    expect(out.posts).toEqual([]);
    expect(out.discover).toEqual({ cards: [], creators: {} });
    expect(presign).not.toHaveBeenCalled();
  });

  it("a feed read that fails leaves no discover promise unhandled", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    db.failOn.sub_posts = "outage";
    const out = await feed.exclusiveFeed(VIEWER);
    await new Promise((r) => setTimeout(r, 20));
    process.off("unhandledRejection", unhandled);
    expect(out).toMatchObject({ ok: true, posts: [], ready: false });
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("what the new indicators carry — from the same reads", () => {
  it("a feed creator carries the LATEST period_end as accessUntil and the server's verified flag; discover creators don't", async () => {
    const out = await feed.exclusiveFeed(VIEWER);
    if (!out.ok) throw new Error("feed failed");
    expect(out.creators[C.active]).toMatchObject({ verified: true, accessUntil: later });
    expect(out.discover!.creators[C.discover]!.accessUntil).toBeUndefined();
    expect(out.discover!.creators[C.discover]!.verified).toBe(false);
  });

  it("discover prices: the creator's full price, the fee apart, and the total — the server's numbers", async () => {
    const out = await feed.exclusiveFeed(VIEWER);
    if (!out.ok) throw new Error("feed failed");
    expect(out.discover!.creators[C.discover]).toMatchObject({ priceCents: 500, feeCents: 50, feePercent: 10, totalCents: 550, periodDays: 30 });
  });

  it("every page says when its links were signed and how long they last", async () => {
    const before = Date.now();
    const out = await feed.exclusiveFeed(VIEWER);
    if (!out.ok) throw new Error("feed failed");
    expect(out.issuedAt).toBeGreaterThanOrEqual(before);
    expect(out.previewTtl).toBe(300);
  });

  it("tiles use the approved thumb, never a video original; a video with no thumb gets no tile link", async () => {
    const out = await feed.exclusiveFeed(VIEWER);
    if (!out.ok) throw new Error("feed failed");
    const calls = presign.mock.calls as unknown as [string, number][];
    // the 5-minute tile links: thumbs only
    expect(calls.filter((c) => c[1] === feed.SIGNED_TTL_SECONDS).map((c) => c[0]).sort()).toEqual(["sub/a/photo-thumb.jpg", "sub/a/v-thumb.jpg"]);
    expect(out.posts.find((p) => p.id === P.videoBare)!.previewUrl).toBeNull();
  });

  it("step 13 (owner 2026-10-18: subscribed posts 'play normally'): the in-feed player gets the FIRST item's own file — never a later one", async () => {
    const out = await feed.exclusiveFeed(VIEWER);
    if (!out.ok) throw new Error("feed failed");
    const calls = presign.mock.calls as unknown as [string, number][];
    const media = calls.filter((c) => c[1] === feed.MEDIA_TTL_SECONDS).map((c) => c[0]).sort();
    expect(media).toEqual(["sub/a/bare-orig.mp4", "sub/a/photo-orig.jpg", "sub/a/v-orig.mp4"]);
    // teeth: the second photo of a two-photo post is never signed for the feed
    expect(calls.map((c) => c[0])).not.toContain("sub/a/photo2-orig.jpg");
    expect(out.posts.find((p) => p.id === P.videoBare)).toMatchObject({ mediaKind: "video" });
    expect(JSON.stringify(out)).not.toMatch(/object_key|thumb_key/);
  });
});

describe("refreshing an expired preview: access decided again, nothing leaks", () => {
  it("re-signs the tile of a post the viewer may still see (thumb first)", async () => {
    const out = await feed.feedPreviews(VIEWER, [P.photo, P.videoThumb, P.videoBare]);
    if (!out.ok) throw new Error("refresh failed");
    expect(out.previews[P.photo]).toMatch(/photo-thumb\.jpg/);
    expect(out.previews[P.videoThumb]).toMatch(/v-thumb\.jpg/);
    expect(out.previews[P.videoBare]).toBeNull();
    expect(presign.mock.calls.map((c) => c[0])).not.toContain("sub/a/bare-orig.mp4");
  });

  it("a post the viewer may NOT see — expired, blocked, suspended, archived, never subscribed — is absent and never signed", async () => {
    const out = await feed.feedPreviews(VIEWER, [P.expired, P.blocked, P.suspended, P.archived, P.discover, P.blocksMe]);
    if (!out.ok) throw new Error("refresh failed");
    expect(out.previews).toEqual({});
    expect(presign).not.toHaveBeenCalled();
  });

  it("access that ended between the page and the refresh: the refresh is refused (no new link)", async () => {
    for (const m of db.tables.creator_memberships!) if (m.creator_id === C.active) m.status = "ended";
    const out = await feed.feedPreviews(VIEWER, [P.photo]);
    expect(out).toMatchObject({ ok: true, previews: {} });
    expect(presign).not.toHaveBeenCalled();
  });

  it("a deleted post is absent (the tile says it's gone instead of retrying)", async () => {
    db.tables.sub_posts = db.tables.sub_posts!.filter((p) => p.id !== P.photo);
    const out = await feed.feedPreviews(VIEWER, [P.photo, P.videoThumb]);
    if (!out.ok) throw new Error("refresh failed");
    expect(Object.keys(out.previews)).toEqual([P.videoThumb]);
  });

  it("bad input is refused before any read: not an array, too many, not ids", async () => {
    for (const bad of [null, "x", [], ["nope"], Array.from({ length: feed.PREVIEW_REFRESH_MAX + 1 }, () => P.photo)]) {
      expect(await feed.feedPreviews(VIEWER, bad)).toMatchObject({ ok: false, status: 400 });
    }
    expect(reads).toEqual([]);
  });

  it("the route: 401 signed out, no-store always, and the viewer comes from the session (never the body)", async () => {
    const req = (body: unknown) => new Request("https://x/api/sub/feed/previews", { method: "POST", body: JSON.stringify(body) });
    const anon = await previewsRoute.POST(req({ ids: [P.photo] }));
    expect(anon.status).toBe(401);
    expect(anon.headers.get("cache-control")).toContain("no-store");
    sessionUser = { id: U(2) }; // someone with no subscriptions, naming the viewer's post
    const other = await previewsRoute.POST(req({ ids: [P.photo], viewerId: VIEWER }));
    expect(other.status).toBe(200);
    expect(other.headers.get("cache-control")).toBe("private, no-store");
    expect(((await other.json()) as { previews: object }).previews).toEqual({});
    expect(presign).not.toHaveBeenCalled();
    sessionUser = { id: VIEWER };
    const mine = await previewsRoute.POST(req({ ids: [P.photo] }));
    expect(Object.keys(((await mine.json()) as { previews: object }).previews)).toEqual([P.photo]);
  });

  it("the feed route itself is still private and uncached", async () => {
    sessionUser = { id: VIEWER };
    const res = await feedRoute.GET(new Request("https://x/api/sub/feed"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("the server-rendered first page", () => {
  const page = readFileSync(join(process.cwd(), "app", "(app)", "exclusive", "page.tsx"), "utf8");
  const cachesSomething = (src: string) => /unstable_cache|["']use cache["']|export const revalidate|force-static|cacheLife|cacheTag/.test(src);

  it("is per-user and dynamic: signs in on the server, renders exclusiveFeed for THAT user, caches nothing", () => {
    expect(page).toContain('export const dynamic = "force-dynamic"');
    // 2026-10-22: a signed-out visitor gets the PUBLIC page in guest mode instead of a redirect to /login
    expect(page).not.toMatch(/redirect\("\/login\?next=\/exclusive"\)/);
    expect(page).toMatch(/\{user \? <FirstPage viewerId=\{user\.id\} \/> : <GuestPage \/>\}/);
    expect(page).toMatch(/<ExclusiveFeed initial=\{await publicExclusiveFeed\(\)\} guest \/>/);
    expect(page).toMatch(/exclusiveFeed\(viewerId, null\)/);
    expect(page).toMatch(/<Suspense fallback=\{<FeedSkeleton \/>\}>/);
    expect(cachesSomething(page)).toBe(false);
  });

  it("🔴 the signed-out page signs NO media link — locked cards only (public cover / 20 px blur)", () => {
    const lib = readFileSync(join(process.cwd(), "lib/sub/feed.ts"), "utf8");
    const fn = lib.slice(lib.indexOf("export async function publicExclusiveFeed"), lib.indexOf("export async function feedPreviews"));
    expect(fn).toContain("discover(null, new Set())");
    expect(fn).toContain("posts: []");
    expect(fn).not.toMatch(/presign|mediaOf|exclusiveFeed\(/);
    // and a visitor (no viewer) is never shown a Mature cover
    expect(lib).toContain("(viewerId ? isAdult(viewerId).catch(() => false) : Promise.resolve(false))");
  });

  it("teeth: a cached variant is caught", () => {
    expect(cachesSomething(`${page}\nexport const revalidate = 60;`)).toBe(true);
    expect(cachesSomething(page.replace("exclusiveFeed(viewerId, null)", "unstable_cache(() => exclusiveFeed(viewerId, null))()"))).toBe(true);
  });
});
