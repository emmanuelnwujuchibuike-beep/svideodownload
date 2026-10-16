import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Exclusive Part 2 — who can get at exclusive content, through the REAL server modules
 * and route handlers (lib/sub/posts, lib/sub/moderation, lib/social/moderation, the report and
 * admin routes) over an in-memory database. The private bucket is replaced by a recorder: the
 * assertion that matters is whether a presigned link was ever MINTED for someone.
 */

let db: FakeDb;
let admin: { id: string } | null = null;
let sessionUser: { id: string; email?: string } | null = null;
const presign = vi.fn(async (key: string) => `https://private.example/${key}?sig=1`);
const audit = vi.fn(async (_entry: unknown) => {});

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) }, from: (t: string) => (db.client() as { from: (t: string) => unknown }).from(t) }) }));
vi.mock("@/lib/storage/r2", () => ({ hasPrivateR2: true, presignPrivateGet: (k: string) => presign(k), presignPrivatePut: vi.fn(), deletePrivate: vi.fn(), readPrivatePrefix: vi.fn() }));
vi.mock("@/lib/security/audit-log", () => ({ writeAuditLog: (p: unknown) => audit(p) }));
vi.mock("@/lib/admin/require-admin", async () => {
  const { NextResponse } = await import("next/server");
  return {
    getAdminUser: async () => admin,
    requireAdminApi: async () => (admin ? { ok: true, user: admin } : { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) }),
  };
});
vi.mock("@/lib/rate-limit", () => ({ trackLimiter: { limit: async () => ({ success: true }) }, clientId: () => "ip" }));
vi.mock("@/lib/landing/settings", async () => {
  const { SUB_DEFAULTS } = await import("@/lib/rewards/config");
  return { getLandingSettings: async () => ({ frenzRewards: { sub: SUB_DEFAULTS } }) };
});

const { openSubPost, listSubPosts, deleteSubPost } = await import("./posts");
const { reportSubTarget } = await import("./moderation");
const { moderate } = await import("@/lib/social/moderation");
const reportRoute = await import("@/app/api/report/route");
const reviewRoute = await import("@/app/api/admin/moderation/sub-review/route");
const modRoute = await import("@/app/api/admin/moderation/route");

const CREATOR = "00000000-0000-4000-8000-000000000001";
const SUBSCRIBER = "00000000-0000-4000-8000-000000000002";
const STRANGER = "00000000-0000-4000-8000-000000000003";
const ADMIN = "00000000-0000-4000-8000-000000000009";
const POST = "00000000-0000-4000-8000-0000000000a1";
const COMMENT = "00000000-0000-4000-8000-0000000000c1";
const KEY = `sub/${CREATOR}/secret-original.jpg`;
const future = () => new Date(Date.now() + 86_400_000).toISOString();

beforeEach(() => {
  admin = null;
  sessionUser = null;
  presign.mockClear();
  audit.mockClear();
  db = fakeDb({
    sub_posts: [{ id: POST, creator_id: CREATOR, caption: "paid caption", cover_url: null, status: "published", created_at: "2026-10-15T10:00:00.000Z" }],
    sub_post_media: [{ id: "m1", post_id: POST, idx: 0, media_kind: "image", object_key: KEY, thumb_key: null, width: 10, height: 10 }],
    sub_post_comments: [{ id: COMMENT, post_id: POST, user_id: SUBSCRIBER, body: "a comment", hidden_at: null }],
    creator_memberships: [{ id: "mem", creator_id: CREATOR, member_id: SUBSCRIBER, status: "active", billing: "sub", period_end: future() }],
    blocks: [],
    profiles: [{ id: CREATOR, handle: "creator", is_suspended: false, is_hidden: false }, { id: SUBSCRIBER, handle: "fan" }, { id: STRANGER, handle: "stranger" }],
    reports: [],
  });
  db.unique.reports = [["reporter_id", "target_type", "target_id"]];
  db.defaults.reports = { status: "open" }; // 0007's column default
});

const json = (r: Response) => r.json() as Promise<Record<string, unknown>>;

describe("private media access", () => {
  it("a signed-out visitor gets 401 and no link is minted", async () => {
    expect(await openSubPost(POST, null)).toMatchObject({ ok: false, status: 401 });
    expect(presign).not.toHaveBeenCalled();
  });
  it("a signed-in non-subscriber gets 403 and no link is minted", async () => {
    expect(await openSubPost(POST, STRANGER)).toMatchObject({ ok: false, status: 403 });
    expect(presign).not.toHaveBeenCalled();
  });
  it("the locked gallery gives a non-subscriber covers and counts — no caption, no key, no link", async () => {
    const out = await listSubPosts(CREATOR, STRANGER);
    expect(out.access).toBe(false);
    expect(out.posts[0]).toMatchObject({ caption: null, items: 1 });
    expect(out.posts[0]).not.toHaveProperty("open");
    expect(JSON.stringify(out)).not.toContain("secret-original");
    expect(presign).not.toHaveBeenCalled();
  });
  it("an active subscriber keeps access: the caption and five-minute links", async () => {
    const out = await openSubPost(POST, SUBSCRIBER);
    expect(out).toMatchObject({ ok: true, caption: "paid caption" });
    expect(presign).toHaveBeenCalledWith(KEY);
  });
  it("an expired subscription, or a block, is no access", async () => {
    db.tables.creator_memberships![0]!.period_end = "2026-01-01T00:00:00.000Z";
    expect(await openSubPost(POST, SUBSCRIBER)).toMatchObject({ ok: false, status: 403 });
    db.tables.creator_memberships![0]!.period_end = future();
    db.tables.blocks = [{ blocker_id: CREATOR, blocked_id: SUBSCRIBER }];
    expect(await openSubPost(POST, SUBSCRIBER)).toMatchObject({ ok: false, status: 403 });
    expect(presign).not.toHaveBeenCalled();
  });
});

describe("reporting exclusive content", () => {
  it("anyone who can see the tile may report the post, and learns nothing from it", async () => {
    sessionUser = { id: STRANGER };
    const res = await reportRoute.POST(new Request("https://x/api/report", { method: "POST", body: JSON.stringify({ targetType: "sub_post", targetId: POST, reason: "Inappropriate" }) }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
    expect(presign).not.toHaveBeenCalled();
    expect(db.tables.reports).toHaveLength(1);
    expect(db.tables.reports![0]).toMatchObject({ reporter_id: STRANGER, target_type: "sub_post", target_id: POST, reason: "Inappropriate" });
  });
  it("a repeat report by the same person is accepted quietly, without a second row", async () => {
    await reportSubTarget(STRANGER, "sub_post", POST, "Spam", null);
    expect(await reportSubTarget(STRANGER, "sub_post", POST, "Spam", null)).toEqual({ ok: true });
    expect(db.tables.reports).toHaveLength(1);
  });
  it("a comment can only be reported by someone who can read it", async () => {
    expect(await reportSubTarget(STRANGER, "sub_comment", COMMENT, "Harassment", null)).toMatchObject({ ok: false, status: 404 });
    expect(await reportSubTarget(CREATOR, "sub_comment", COMMENT, "Harassment", null)).toEqual({ ok: true });
  });
  it("no one reports their own post, a missing post, or a malformed id", async () => {
    expect(await reportSubTarget(CREATOR, "sub_post", POST, "Spam", null)).toMatchObject({ ok: false });
    expect(await reportSubTarget(STRANGER, "sub_post", "00000000-0000-4000-8000-0000000000ff", "Spam", null)).toMatchObject({ ok: false, status: 404 });
    expect(await reportSubTarget(STRANGER, "sub_post", "nope", "Spam", null)).toMatchObject({ ok: false, status: 400 });
    expect(db.tables.reports).toHaveLength(0);
  });
  it("a signed-out visitor cannot report", async () => {
    const res = await reportRoute.POST(new Request("https://x/api/report", { method: "POST", body: JSON.stringify({ targetType: "sub_post", targetId: POST, reason: "Spam" }) }));
    expect(res.status).toBe(401);
  });
});

describe("admin review and takedown", () => {
  const review = () => reviewRoute.GET(new Request(`https://x/api/admin/moderation/sub-review?type=sub_post&id=${POST}`));
  const act = (body: unknown) => modRoute.POST(new Request("https://x/api/admin/moderation", { method: "POST", body: JSON.stringify(body) }));

  it("a non-admin cannot review: 404, and no link is minted", async () => {
    sessionUser = { id: SUBSCRIBER };
    expect((await review()).status).toBe(404);
    expect(presign).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
  it("an admin reviews with five-minute links, and the review is audited", async () => {
    admin = { id: ADMIN };
    const res = await review();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await json(res);
    expect(body).toMatchObject({ caption: "paid caption", media: [{ kind: "image", url: expect.stringContaining("sig=") }] });
    expect(presign).toHaveBeenCalledWith(KEY);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ eventType: "moderation_review", actorUserId: ADMIN, userId: CREATOR, targetType: "sub_post", targetId: POST }));
  });
  it("only an admin can take a post down", async () => {
    expect((await act({ targetType: "sub_post", targetId: POST, action: "remove" })).status).toBe(403);
    expect(db.tables.sub_posts![0]!.status).toBe("published");
  });
  it("a takedown archives the post (media kept), resolves its reports, is audited, and ends access", async () => {
    await reportSubTarget(STRANGER, "sub_post", POST, "Inappropriate", null);
    admin = { id: ADMIN };
    expect((await act({ targetType: "sub_post", targetId: POST, action: "remove" })).status).toBe(200);
    expect(db.tables.sub_posts![0]).toMatchObject({ status: "archived", moderated_by: ADMIN });
    expect(db.tables.sub_post_media).toHaveLength(1);
    expect(db.tables.reports![0]!.status).toBe("actioned");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ eventType: "moderation_action", targetType: "sub_post", metadata: { action: "remove" } }));
    expect(await openSubPost(POST, SUBSCRIBER)).toMatchObject({ ok: false, status: 404 });
    // the creator cannot delete the evidence while it is under review
    expect(await deleteSubPost(CREATOR, POST)).toMatchObject({ ok: false, status: 409 });
    // and an admin can restore it
    expect((await act({ targetType: "sub_post", targetId: POST, action: "restore" })).status).toBe(200);
    expect(db.tables.sub_posts![0]!.status).toBe("published");
  });
  it("account actions are refused for exclusive targets", async () => {
    admin = { id: ADMIN };
    expect((await act({ targetType: "sub_post", targetId: POST, action: "suspend" })).status).toBe(400);
  });
  it("a comment takedown hides it (never deletes it)", async () => {
    admin = { id: ADMIN };
    expect(await moderate("sub_comment", COMMENT, "remove", ADMIN)).toEqual({ ok: true });
    expect(db.tables.sub_post_comments![0]!.hidden_at).toBeTruthy();
    expect(db.tables.sub_post_comments).toHaveLength(1);
  });
});
