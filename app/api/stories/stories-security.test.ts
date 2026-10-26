import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Stories Part 1 (2026-10-26) — the REAL routes, with the database clients replaced. The database
 * half (policies, grants, the expiry trigger, story_view_access) is proven against Postgres by
 * supabase/tests/0285_stories_security.pglite.mjs; here each route's own decisions are pinned:
 *
 *   S3  POST /api/stories publishes only the member's OWN upload, and never for a suspended account
 *   S1  DELETE /api/stories/:id ENDS the story through expire_own_story, as the member
 *   S6  POST /api/stories/:id/views records only when story_view_access says "ok"
 *   S4  a story reshare needs story_view_access "ok", not just the author's switch
 */
let db: FakeDb;
let user: { id: string } | null;
let memberRpc: ReturnType<typeof vi.fn<(name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>>>;
vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) }, rpc: (name: string, args: unknown) => memberRpc(name, args) }),
}));
vi.mock("@/lib/cache", () => ({ getCached: vi.fn(), cacheDelete: vi.fn(async () => {}) }));
vi.mock("@/lib/social/creator-notify-emit", () => ({ notifyNewStory: vi.fn(async () => {}) }));
vi.mock("@/lib/social/home-feed", () => ({ bustHomeFeedCache: vi.fn(async () => {}) }));
vi.mock("@/lib/notifications/publish", () => ({ publishNotification: vi.fn(async () => {}) }));
vi.mock("@/lib/social/messages", () => ({ sendMessage: vi.fn(async () => ({ ok: true })) }));

// reshare.ts reads its `hasSupabase` once, at load — so the env exists before the import
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sb.test");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test");
const { POST: createStory } = await import("./route");
const { DELETE: deleteStory } = await import("./[id]/route");
const { POST: recordView } = await import("./[id]/views/route");
const { reshare } = await import("@/lib/social/reshare");

const R2 = "https://media.test";
const ME = "0b6c2f1e-1d2c-4a8b-9c3d-1234567890ab";
const THEM = "9f8e7d6c-5b4a-4c3d-8e2f-ba0987654321";
const STORY = "20000000-0000-4000-8000-000000000001";
const img = (o: string) => `${R2}/${o}/images/1792999483123-k3j9x2.jpg`;
const vid = (o: string) => `${R2}/${o}/videos/1792999483123-k3j9x2.mp4`;
const post = (body: unknown) => new Request("https://x.test/api/stories", { method: "POST", body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const storyInserts = () => db.writes.filter((w) => w.table === "stories" && w.op === "insert");

beforeEach(() => {
  vi.stubEnv("R2_PUBLIC_BASE_URL", R2);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sb.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test");
  user = { id: ME };
  memberRpc = vi.fn<(name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>>();
  db = fakeDb({ profiles: [{ id: ME, handle: "me", is_suspended: false }], stories: [], story_views: [], privacy_settings: [] });
});

describe("S3 · POST /api/stories publishes only the member's own upload", () => {
  it("their own photo — written by the server, with NO client-chosen times", async () => {
    const res = await createStory(post({ mediaUrl: img(ME), mediaKind: "image", destination: "story" }));
    expect(res.status).toBe(200);
    const [w] = storyInserts();
    expect(w?.values).toEqual([expect.objectContaining({ user_id: ME, media_url: img(ME), media_kind: "image" })]);
    const row = (w?.values as Record<string, unknown>[])[0]!;
    expect(row).not.toHaveProperty("expires_at");
    expect(row).not.toHaveProperty("created_at");
  });

  it("their own video with their own cover", async () => {
    const res = await createStory(post({ mediaUrl: vid(ME), mediaKind: "video", thumbnailUrl: img(ME), destination: "story" }));
    expect(res.status).toBe(200);
    expect(storyInserts()).toHaveLength(1);
  });

  it.each([
    ["a file on another site (a tracking image)", { mediaUrl: "https://evil.test/pixel.gif", mediaKind: "image" }],
    ["another member's upload", { mediaUrl: img(THEM), mediaKind: "image" }],
    ["a video posing as a photo", { mediaUrl: vid(ME), mediaKind: "image" }],
    ["a URL with a query string", { mediaUrl: `${img(ME)}?track=1`, mediaKind: "image" }],
    ["another member's cover on my video", { mediaUrl: vid(ME), mediaKind: "video", thumbnailUrl: img(THEM) }],
    ["a foreign cover on my video", { mediaUrl: vid(ME), mediaKind: "video", thumbnailUrl: "https://evil.test/c.jpg" }],
  ])("🔴 refuses %s — and writes nothing", async (_label, body) => {
    const res = await createStory(post({ ...body, destination: "story" }));
    expect(res.status).toBe(400);
    expect(storyInserts()).toHaveLength(0);
  });

  it("🔴 a suspended account publishes no story", async () => {
    db.tables.profiles = [{ id: ME, handle: "me", is_suspended: true }];
    const res = await createStory(post({ mediaUrl: img(ME), mediaKind: "image", destination: "story" }));
    expect(res.status).toBe(403);
    expect(storyInserts()).toHaveLength(0);
  });

  it("signed out: 401, nothing written", async () => {
    user = null;
    const res = await createStory(post({ mediaUrl: img(ME), mediaKind: "image", destination: "story" }));
    expect(res.status).toBe(401);
    expect(storyInserts()).toHaveLength(0);
  });
});

describe("S1 · DELETE /api/stories/:id ends the story, as the member", () => {
  it("calls expire_own_story on the MEMBER's session — ownership is auth.uid() in the database", async () => {
    memberRpc.mockResolvedValue({ data: true, error: null });
    const res = await deleteStory(new Request("https://x.test"), params(STORY));
    expect(res.status).toBe(200);
    expect(memberRpc).toHaveBeenCalledWith("expire_own_story", { p_story: STORY });
    expect(db.writes).toEqual([]); // the service role does nothing here
  });
  it("not theirs (or no such story): 404", async () => {
    memberRpc.mockResolvedValue({ data: false, error: null });
    expect((await deleteStory(new Request("https://x.test"), params(STORY))).status).toBe(404);
  });
  it("a malformed id never reaches the database", async () => {
    expect((await deleteStory(new Request("https://x.test"), params("nope"))).status).toBe(404);
    expect(memberRpc).not.toHaveBeenCalled();
  });
});

describe("S6 · a view is recorded only when the viewer may see the story", () => {
  const view = (shot = false) => recordView(new Request(`https://x.test/api/stories/${STORY}/views${shot ? "?shot=1" : ""}`, { method: "POST" }), params(STORY));
  const viewWrites = () => db.writes.filter((w) => w.table === "story_views");

  it.each(["forbidden", "expired", "missing", "self"])("🔴 access %s: nothing is recorded", async (verdict) => {
    db.rpc.story_view_access = vi.fn(() => ({ data: verdict, error: null }));
    const body = await (await view()).json();
    expect(body.recorded).toBe(false);
    expect(viewWrites()).toHaveLength(0);
  });

  it("🔴 the check failing records nothing (fail closed)", async () => {
    db.rpc.story_view_access = vi.fn(() => ({ data: null, error: { message: "down" } }));
    expect((await (await view()).json()).recorded).toBe(false);
    expect(viewWrites()).toHaveLength(0);
  });

  it("access ok: the view is recorded for the SESSION's member", async () => {
    db.rpc.story_view_access = vi.fn(() => ({ data: "ok", error: null }));
    expect((await (await view()).json()).recorded).toBe(true);
    expect(db.rpc.story_view_access).toHaveBeenCalledWith({ p_story: STORY, p_viewer: ME });
    expect(viewWrites()[0]?.values).toEqual([{ story_id: STORY, viewer_id: ME }]);
  });

  it("a screenshot mark obeys the same gate", async () => {
    db.rpc.story_view_access = vi.fn(() => ({ data: "forbidden", error: null }));
    expect((await (await view(true)).json()).recorded).toBe(false);
    expect(viewWrites()).toHaveLength(0);
  });

  it("a malformed id records nothing and asks nothing", async () => {
    db.rpc.story_view_access = vi.fn(() => ({ data: "ok", error: null }));
    const res = await recordView(new Request("https://x.test", { method: "POST" }), params("not-a-uuid"));
    expect((await res.json()).recorded).toBe(false);
    expect(db.rpc.story_view_access).not.toHaveBeenCalled();
  });
});

describe("S4 · a story reshare needs the viewer to be able to SEE the story", () => {
  const live = new Date(Date.now() + 3_600_000).toISOString();
  beforeEach(() => {
    db.tables.stories = [{ id: STORY, user_id: THEM, media_url: img(THEM), media_kind: "image", allow_reshare: true, expires_at: live }];
  });

  it("🔴 blocked / private / hidden (access forbidden): refused, nothing written", async () => {
    db.rpc.story_view_access = vi.fn(() => ({ data: "forbidden", error: null }));
    const out = await reshare({ viewerId: ME, source: "story", sourceId: STORY, destination: "story" });
    expect(out).toEqual({ ok: false, reason: "forbidden" });
    expect(storyInserts()).toHaveLength(0);
  });

  it("🔴 the author's switch off still refuses, before anything else", async () => {
    db.tables.stories![0]!.allow_reshare = false;
    db.rpc.story_view_access = vi.fn(() => ({ data: "ok", error: null }));
    expect(await reshare({ viewerId: ME, source: "story", sourceId: STORY, destination: "story" })).toEqual({ ok: false, reason: "not-allowed" });
    expect(storyInserts()).toHaveLength(0);
  });

  it("visible and allowed: reshared, with provenance taken from the SOURCE row", async () => {
    db.rpc.story_view_access = vi.fn(() => ({ data: "ok", error: null }));
    const out = await reshare({ viewerId: ME, source: "story", sourceId: STORY, destination: "story" });
    expect(out.ok).toBe(true);
    expect(storyInserts()[0]?.values).toEqual([
      expect.objectContaining({ user_id: ME, media_url: img(THEM), reshared_from_story_id: STORY, reshared_from_user_id: THEM }),
    ]);
  });
});
