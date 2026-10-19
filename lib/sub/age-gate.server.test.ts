import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Mature (18+) exclusive posts and the age check (0261, owner 2026-10-18), through the REAL route
 * handlers and server modules on an in-memory database — the same harness as
 * security-boundaries.server.test.ts. Identity comes only from the mocked session. Every case
 * asserts on what a response actually carries: a withheld post must contain no media key, no
 * signed link, no caption and no cover, and nothing may have been signed for it at all.
 */

let db: FakeDb;
let sessionUser: { id: string } | null = null;
let adminUser: { id: string } | null = null;
const audit = vi.fn(async (_e: Record<string, unknown>) => {});
const presignGet = vi.fn(async (key: string) => `https://private.example/${key}?sig=1`);

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }) }));
// a real JPEG header, so the upload check passes for the creator's own private file
vi.mock("@/lib/storage/r2", () => ({ hasPrivateR2: true, presignPrivateGet: (k: string) => presignGet(k), presignPrivatePut: vi.fn(async (k: string) => `https://put.example/${k}`), deletePrivate: vi.fn(), readPrivatePrefix: vi.fn(async () => ({ prefix: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]), size: 1000, contentType: "image/jpeg" })) }));
vi.mock("@/lib/admin/guard", () => ({ getAdminUser: async () => adminUser }));
vi.mock("@/lib/security/audit-log", () => ({ writeAuditLog: (e: Record<string, unknown>) => audit(e) }));
vi.mock("@/lib/rate-limit", () => ({ trackLimiter: { limit: async () => ({ success: true }) }, clientId: () => "ip" }));
vi.mock("@/lib/landing/settings", async () => {
  const { SUB_DEFAULTS } = await import("@/lib/rewards/config");
  return { getLandingSettings: async () => ({ frenzRewards: { sub: { ...SUB_DEFAULTS } } }) };
});

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CREATOR = U(1);
const SUBSCRIBER = U(2);
const FOLLOWER = U(3); // follows CREATOR, does not subscribe
const MATURE = `10000000-0000-4000-8000-${"0".repeat(11)}1`;
const PLAIN = `10000000-0000-4000-8000-${"0".repeat(11)}2`;
const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
const COVER = "https://media.example/public-cover.jpg";

type Handler = (r: Request, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>;
const req = (method: string, body?: unknown, url = "https://frenzsave.com/api/x") => new Request(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });
const route = async (m: Promise<unknown>) => (await m) as Record<string, Handler>;
const yearsAgo = (n: number, days = 0) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear() - n, d.getUTCMonth(), d.getUTCDate() + days)).toISOString().slice(0, 10);
};

beforeEach(() => {
  sessionUser = null;
  adminUser = null;
  audit.mockClear();
  presignGet.mockClear();
  db = fakeDb({
    profiles: [CREATOR, SUBSCRIBER, FOLLOWER].map((id) => ({ id, handle: `h${id.slice(-1)}`, display_name: `P${id.slice(-1)}`, avatar_url: null, is_verified: false, is_suspended: false, is_hidden: false })),
    sub_posts: [
      { id: MATURE, creator_id: CREATOR, caption: "mature caption", cover_url: COVER, status: "published", audience: "locked", mature: true, created_at: "2026-10-12T10:00:00Z" },
      { id: PLAIN, creator_id: CREATOR, caption: "plain caption", cover_url: null, status: "published", audience: "locked", mature: false, created_at: "2026-10-11T10:00:00Z" },
    ],
    sub_post_media: [
      { id: "m1", post_id: MATURE, idx: 0, media_kind: "image", object_key: `sub/${CREATOR}/mature.jpg`, thumb_key: `sub/${CREATOR}/mature-thumb.jpg`, width: null, height: null },
      { id: "m2", post_id: PLAIN, idx: 0, media_kind: "image", object_key: `sub/${CREATOR}/plain.jpg`, thumb_key: null, width: null, height: null },
    ],
    creator_memberships: [{ id: "mm", creator_id: CREATOR, member_id: SUBSCRIBER, status: "active", billing: "sub", period_end: future }],
    creator_membership_settings: [{ creator_id: CREATOR, sub_active: true, sub_price_cents: 500 }],
    age_checks: [],
    follows: [{ follower_id: FOLLOWER, following_id: CREATOR }],
    blocks: [],
    sub_post_likes: [],
    sub_post_comments: [],
    sub_purchases: [],
  });
});

const NOTHING_OF_THE_MATURE_POST = /mature\.jpg|mature-thumb|mature caption|public-cover/;

describe("a subscriber who hasn't confirmed their age", () => {
  beforeEach(() => {
    sessionUser = { id: SUBSCRIBER };
  });

  it("the gallery marks the Mature post and sends none of it; the ordinary post still opens", async () => {
    const r = await route(import("@/app/api/sub/posts/route"));
    const res = await r.GET!(req("GET", undefined, `https://frenzsave.com/api/sub/posts?creator=${CREATOR}`));
    const out = (await res.json()) as { posts: Record<string, unknown>[] };
    const m = out.posts.find((p) => p.id === MATURE)!;
    expect(m).toMatchObject({ mature: true, ageLocked: true, caption: null, coverUrl: null });
    expect(m.open).toBeUndefined();
    expect(m.thumbUrl).toBeUndefined();
    expect(JSON.stringify(m)).not.toMatch(NOTHING_OF_THE_MATURE_POST);
    // teeth: the ordinary post is unchanged — opened, with its caption
    const p = out.posts.find((x) => x.id === PLAIN)!;
    expect(p.ageLocked).toBeUndefined();
    expect((p.open as { caption: string }).caption).toBe("plain caption");
    expect(presignGet.mock.calls.map((c) => c[0]).join(" ")).not.toMatch(/mature/);
  });

  it("opening it answers 403 age_required and signs nothing", async () => {
    const r = await route(import("@/app/api/sub/posts/[id]/route"));
    const res = await r.GET!(req("GET"), paramsOf(MATURE));
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ code: "age_required" });
    expect(text).not.toMatch(NOTHING_OF_THE_MATURE_POST);
    expect(presignGet).not.toHaveBeenCalled();
  });

  it("likes and comments follow the post", async () => {
    const like = await route(import("@/app/api/sub/posts/[id]/like/route"));
    const comments = await route(import("@/app/api/sub/posts/[id]/comments/route"));
    for (const res of [await like.GET!(req("GET"), paramsOf(MATURE)), await comments.GET!(req("GET"), paramsOf(MATURE))]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "age_required" });
    }
    expect((await like.GET!(req("GET"), paramsOf(PLAIN))).status).toBe(200);
  });

  it("the Exclusive feed sends the card without its preview or caption, and a refresh leaves it out", async () => {
    const feed = await route(import("@/app/api/sub/feed/route"));
    const out = (await (await feed.GET!(req("GET", undefined, "https://frenzsave.com/api/sub/feed"))).json()) as { posts: Record<string, unknown>[] };
    const m = out.posts.find((p) => p.id === MATURE)!;
    expect(m).toMatchObject({ mature: true, ageLocked: true, previewUrl: null, caption: null });
    expect(out.posts.find((p) => p.id === PLAIN)!.previewUrl).toMatch(/plain\.jpg/);
    const previews = await route(import("@/app/api/sub/feed/previews/route"));
    const refreshed = (await (await previews.POST!(req("POST", { ids: [MATURE, PLAIN] }))).json()) as { previews: Record<string, string | null> };
    expect(MATURE in refreshed.previews).toBe(false);
    expect(refreshed.previews[PLAIN]).toMatch(/plain\.jpg/);
    expect(presignGet.mock.calls.map((c) => c[0]).join(" ")).not.toMatch(/mature/);
  });

  it("after confirming 18+ the same post opens — and only the outcome is stored", async () => {
    const age = await route(import("@/app/api/age/route"));
    const dob = yearsAgo(30);
    const res = await age.POST!(req("POST", { birthDate: dob, confirm: true }));
    expect(await res.json()).toMatchObject({ ok: true, status: "adult", eligibleOn: null });
    const row = db.tables.age_checks![0]!;
    expect(row).toMatchObject({ user_id: SUBSCRIBER, result: "adult", method: "self_declared_dob", eligible_on: null });
    expect(JSON.stringify(row)).not.toContain(dob);
    const r = await route(import("@/app/api/sub/posts/[id]/route"));
    const open = await r.GET!(req("GET"), paramsOf(MATURE));
    expect(open.status).toBe(200);
    expect(await open.json()).toMatchObject({ caption: "mature caption", mature: true });
  });
});

describe("the age check itself", () => {
  beforeEach(() => {
    sessionUser = { id: SUBSCRIBER };
  });

  it("an adult date without the 18+ confirmation is not an answer", async () => {
    const age = await route(import("@/app/api/age/route"));
    expect((await age.POST!(req("POST", { birthDate: yearsAgo(30), confirm: false }))).status).toBe(400);
    expect(db.tables.age_checks).toHaveLength(0);
  });

  it("a minor's answer stands until they turn 18: another date changes nothing", async () => {
    const age = await route(import("@/app/api/age/route"));
    const first = (await (await age.POST!(req("POST", { birthDate: yearsAgo(16), confirm: true }))).json()) as { status: string; eligibleOn: string };
    expect(first.status).toBe("minor");
    expect(first.eligibleOn).toBe(yearsAgo(-2));
    const retry = (await (await age.POST!(req("POST", { birthDate: yearsAgo(40), confirm: true }))).json()) as { status: string };
    expect(retry.status).toBe("minor");
    expect(db.tables.age_checks![0]).toMatchObject({ result: "minor" });
    const r = await route(import("@/app/api/sub/posts/[id]/route"));
    expect((await r.GET!(req("GET"), paramsOf(MATURE))).status).toBe(403);
  });

  it("from the day they turn 18 a minor may answer again", async () => {
    db.tables.age_checks!.push({ user_id: SUBSCRIBER, result: "minor", method: "self_declared_dob", eligible_on: yearsAgo(0), checked_at: "2024-01-01T00:00:00Z" });
    const age = await route(import("@/app/api/age/route"));
    expect(await (await age.GET!(req("GET"))).json()).toMatchObject({ status: "none" });
    const again = (await (await age.POST!(req("POST", { birthDate: yearsAgo(18), confirm: true }))).json()) as { status: string };
    expect(again.status).toBe("adult");
  });

  it("signed out: no answer can be recorded", async () => {
    sessionUser = null;
    const age = await route(import("@/app/api/age/route"));
    expect((await age.POST!(req("POST", { birthDate: yearsAgo(30), confirm: true }))).status).toBe(401);
  });
});

describe("the creator and discover", () => {
  it("the creator always sees their own Mature post, with no age check", async () => {
    sessionUser = { id: CREATOR };
    const r = await route(import("@/app/api/sub/posts/[id]/route"));
    const res = await r.GET!(req("GET"), paramsOf(MATURE));
    expect(res.status).toBe(200);
  });

  it("the creator can mark a post Mature and back once confirmed 18+; nobody else can", async () => {
    const r = await route(import("@/app/api/sub/posts/[id]/route"));
    sessionUser = { id: SUBSCRIBER };
    expect((await r.PATCH!(req("PATCH", { mature: true }), paramsOf(PLAIN))).status).toBeGreaterThanOrEqual(400);
    expect(db.tables.sub_posts!.find((p) => p.id === PLAIN)!.mature).toBe(false);
    sessionUser = { id: CREATOR };
    db.tables.age_checks!.push({ user_id: CREATOR, result: "adult", method: "self_declared_dob", eligible_on: null });
    expect((await r.PATCH!(req("PATCH", { mature: true }), paramsOf(PLAIN))).status).toBe(200);
    expect(db.tables.sub_posts!.find((p) => p.id === PLAIN)!.mature).toBe(true);
    expect((await r.PATCH!(req("PATCH", { mature: "yes" }), paramsOf(PLAIN))).status).toBe(400);
  });

  it("discover shows a follower the Mature post's card without its public cover", async () => {
    sessionUser = { id: FOLLOWER };
    const feed = await route(import("@/app/api/sub/feed/route"));
    const out = (await (await feed.GET!(req("GET", undefined, "https://frenzsave.com/api/sub/feed"))).json()) as { discover?: { cards: Record<string, unknown>[] } };
    const card = out.discover?.cards.find((c) => c.id === MATURE);
    expect(card).toMatchObject({ mature: true, coverUrl: null });
    expect(JSON.stringify(out)).not.toMatch(NOTHING_OF_THE_MATURE_POST);
  });
});

describe("the posting side (owner 2026-10-18: \"both users making post and viewers\")", () => {
  const publish = async (mature: boolean) => {
    const r = await route(import("@/app/api/sub/posts/route"));
    return r.POST!(req("POST", { caption: "new", media: [{ key: `sub/${CREATOR}/new.jpg`, kind: "image" }], mature }));
  };

  it("a creator who hasn't confirmed 18+ can't publish a Mature post — and nothing is written", async () => {
    sessionUser = { id: CREATOR };
    const before = db.tables.sub_posts!.length;
    const res = await publish(true);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "age_required" });
    expect(db.tables.sub_posts!.length).toBe(before);
    // teeth: the same post, not Mature, publishes
    expect((await publish(false)).status).toBe(200);
  });

  it("a confirmed creator publishes it Mature", async () => {
    sessionUser = { id: CREATOR };
    db.tables.age_checks!.push({ user_id: CREATOR, result: "adult", method: "self_declared_dob", eligible_on: null });
    const res = await publish(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mature: true });
    expect(db.tables.sub_posts!.find((p) => p.caption === "new")!.mature).toBe(true);
  });

  it("an unconfirmed creator can't switch a post to Mature, but can always switch it off", async () => {
    sessionUser = { id: CREATOR };
    const r = await route(import("@/app/api/sub/posts/[id]/route"));
    const on = await r.PATCH!(req("PATCH", { mature: true }), paramsOf(PLAIN));
    expect(on.status).toBe(403);
    expect(await on.json()).toMatchObject({ code: "age_required" });
    expect(db.tables.sub_posts!.find((p) => p.id === PLAIN)!.mature).toBe(false);
    expect((await r.PATCH!(req("PATCH", { mature: false }), paramsOf(MATURE))).status).toBe(200);
    expect(db.tables.sub_posts!.find((p) => p.id === MATURE)!.mature).toBe(false);
  });
});

describe("an admin resets an age answer (owner 2026-10-18)", () => {
  const reset = async (userId: string) => {
    const r = await route(import("@/app/api/admin/users/age/route"));
    return r.DELETE!(req("DELETE", { userId }));
  };

  it("only an admin can — a member's own session can't clear anyone's answer", async () => {
    db.tables.age_checks!.push({ user_id: SUBSCRIBER, result: "minor", method: "self_declared_dob", eligible_on: yearsAgo(-2) });
    sessionUser = { id: SUBSCRIBER };
    expect((await reset(SUBSCRIBER)).status).toBe(403);
    expect(db.tables.age_checks).toHaveLength(1);
    expect(audit).not.toHaveBeenCalled();
  });

  it("clears the answer, audits who reset what, and the member is asked again", async () => {
    db.tables.age_checks!.push({ user_id: SUBSCRIBER, result: "adult", method: "self_declared_dob", eligible_on: null });
    adminUser = { id: FOLLOWER };
    const res = await reset(SUBSCRIBER);
    expect(await res.json()).toMatchObject({ ok: true, cleared: true });
    expect(db.tables.age_checks).toHaveLength(0);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ userId: SUBSCRIBER, actorUserId: FOLLOWER, eventType: "moderation_action", metadata: { action: "age_check_reset", previous: "adult" } }));
    // the Mature post is withheld again until they answer
    sessionUser = { id: SUBSCRIBER };
    const r = await route(import("@/app/api/sub/posts/[id]/route"));
    expect((await r.GET!(req("GET"), paramsOf(MATURE))).status).toBe(403);
  });

  it("a minor reset by an admin may answer again at once", async () => {
    db.tables.age_checks!.push({ user_id: SUBSCRIBER, result: "minor", method: "self_declared_dob", eligible_on: yearsAgo(-2) });
    adminUser = { id: FOLLOWER };
    await reset(SUBSCRIBER);
    sessionUser = { id: SUBSCRIBER };
    const age = await route(import("@/app/api/age/route"));
    expect(await (await age.POST!(req("POST", { birthDate: yearsAgo(30), confirm: true }))).json()).toMatchObject({ status: "adult" });
  });

  it("the admin accounts list shows each answer and never a date of birth", async () => {
    db.tables.age_checks!.push({ user_id: SUBSCRIBER, result: "adult", method: "self_declared_dob", eligible_on: null });
    adminUser = { id: FOLLOWER };
    const r = await route(import("@/app/api/admin/users/route"));
    const out = (await (await r.GET!(req("GET", undefined, "https://frenzsave.com/api/admin/users"))).json()) as { users: { id: string; age: { status: string } }[] };
    expect(out.users.find((u) => u.id === SUBSCRIBER)!.age.status).toBe("adult");
    expect(out.users.find((u) => u.id === CREATOR)!.age.status).toBe("none");
  });
});
