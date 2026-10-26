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
// Stories Part 4 (B7): the file's own verdict (lib/social/story-media.ts, tested with real box layouts in lib/media)
type Verdict = { ok: true; durationSec: number; codec: string } | { ok: false; reason: string; message: string };
let videoVerdict: Verdict = { ok: true, durationSec: 12, codec: "avc1" };
const checkStoryVideo = vi.fn(async (_url: string) => videoVerdict);
vi.mock("@/lib/social/story-media", () => ({ checkStoryVideo: (url: string) => checkStoryVideo(url) }));
const deleted: string[] = [];
vi.mock("@/lib/storage", () => ({ deleteStoredUpload: vi.fn(async (up: { key: string }) => (deleted.push(up.key), true)) }));

// reshare.ts reads its `hasSupabase` once, at load — so the env exists before the import
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sb.test");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test");
const { POST: createStory } = await import("./route");
const { DELETE: deleteStory } = await import("./[id]/route");
const { POST: recordView, GET: viewers } = await import("./[id]/views/route");
const { cacheDelete } = await import("@/lib/cache");
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

/*
  Stories Part 4 (2026-10-26, audit B7): a story video is judged from the FILE on the server — length and a codec every
  phone plays — before any row exists; a refused story-only upload nothing else uses is removed.
*/
describe("B7 · story videos: length and playback, decided by the server", () => {
  beforeEach(() => {
    videoVerdict = { ok: true, durationSec: 12, codec: "avc1" };
    checkStoryVideo.mockClear();
    deleted.length = 0;
    db.rpc.story_media_references = vi.fn(() => ({ data: [], error: null }));
  });
  const postVideo = (over: Record<string, unknown> = {}) => createStory(post({ mediaUrl: vid(ME), mediaKind: "video", thumbnailUrl: img(ME), destination: "story", ...over }));

  it("a 12 s H.264 video: published, checked from its own URL", async () => {
    expect((await postVideo()).status).toBe(200);
    expect(checkStoryVideo).toHaveBeenCalledWith(vid(ME));
    expect(storyInserts()).toHaveLength(1);
  });

  it("a photo story is not probed at all", async () => {
    expect((await createStory(post({ mediaUrl: img(ME), mediaKind: "image", destination: "story" }))).status).toBe(200);
    expect(checkStoryVideo).not.toHaveBeenCalled();
  });

  it.each([
    ["too long", { ok: false, reason: "too_long", message: "Story videos can be up to 60 seconds. Trim it and try again." }],
    ["HEVC", { ok: false, reason: "codec", message: "This video is in HEVC…" }],
    ["unreadable", { ok: false, reason: "unreadable", message: "We couldn't read that video." }],
  ] as const)("🔴 %s: 400 with the reason, no story row, and the orphaned upload + its cover removed", async (_l, v) => {
    videoVerdict = v as Verdict;
    const res = await postVideo();
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: v.message, reason: v.reason });
    expect(storyInserts()).toHaveLength(0);
    expect(deleted.sort()).toEqual([`${ME}/images/1792999483123-k3j9x2.jpg`, `${ME}/videos/1792999483123-k3j9x2.mp4`].sort());
  });

  it("🔴 a file something else still uses is kept", async () => {
    videoVerdict = { ok: false, reason: "too_long", message: "x" };
    db.rpc.story_media_references = vi.fn(() => ({ data: [vid(ME)], error: null }));
    await postVideo();
    expect(deleted).toEqual([`${ME}/images/1792999483123-k3j9x2.jpg`]);
  });

  it("🔴 the reference check failing keeps everything (a kept file beats a deleted one in use)", async () => {
    videoVerdict = { ok: false, reason: "too_long", message: "x" };
    db.rpc.story_media_references = vi.fn(() => ({ data: null, error: { message: "down" } }));
    await postVideo();
    expect(deleted).toEqual([]);
  });

  it("story + feed post: refused as a whole, but the file is kept for the member to post to the feed", async () => {
    videoVerdict = { ok: false, reason: "too_long", message: "x" };
    expect((await postVideo({ destination: "both" })).status).toBe(400);
    expect(deleted).toEqual([]);
  });

  it("feed posts and reels are not touched by the story rule", async () => {
    videoVerdict = { ok: false, reason: "too_long", message: "x" };
    await createStory(post({ mediaUrl: vid(ME), mediaKind: "video", thumbnailUrl: img(ME), destination: "reel" }));
    expect(checkStoryVideo).not.toHaveBeenCalled();
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

/*
  Stories Part 3 (2026-10-26): the answer the client marks a ring by. `recorded` only when the row exists,
  `available: false` (one flag for ended / gone / no longer allowed) takes the story off screen.
*/
describe("Part 3 · what the view POST answers", () => {
  const view = () => recordView(new Request(`https://x.test/api/stories/${STORY}/views`, { method: "POST" }), params(STORY));
  const rows = () => db.tables.story_views!;
  beforeEach(() => vi.mocked(cacheDelete).mockClear());

  it.each(["forbidden", "expired", "missing"])("🔴 %s → available:false, and the reason is not told", async (verdict) => {
    db.rpc.story_view_access = vi.fn(() => ({ data: verdict, error: null }));
    const body = await (await view()).json();
    expect(body).toEqual({ ok: true, recorded: false, available: false });
  });

  it("the check failing (a database hiccup) keeps the story on screen — and records nothing", async () => {
    db.rpc.story_view_access = vi.fn(() => ({ data: null, error: { message: "down" } }));
    expect(await (await view()).json()).toEqual({ ok: true, recorded: false, available: true });
  });

  it("🔴 the write failing is recorded:false — the client must not grey the ring", async () => {
    db.rpc.story_view_access = vi.fn(() => ({ data: "ok", error: null }));
    db.failOn.story_views = "write failed";
    expect(await (await view()).json()).toEqual({ ok: true, recorded: false, available: true });
  });

  it("a first view writes ONE row and drops only this viewer's ring caches", async () => {
    db.rpc.story_view_access = vi.fn(() => ({ data: "ok", error: null }));
    expect((await (await view()).json()).recorded).toBe(true);
    expect(rows()).toHaveLength(1);
    expect(vi.mocked(cacheDelete).mock.calls.map((c) => c[0]).sort()).toEqual([`stories:${ME}:all`, `stories:${ME}:following`, `stories:${ME}:friends`]);
  });

  it("🔴 a duplicate view: still one row, written ON CONFLICT DO NOTHING, no cache traffic", async () => {
    db.rpc.story_view_access = vi.fn(() => ({ data: "ok", error: null }));
    await view();
    vi.mocked(cacheDelete).mockClear();
    expect((await (await view()).json()).recorded).toBe(true);
    expect(rows()).toHaveLength(1);
    expect(cacheDelete).not.toHaveBeenCalled();
  });

  /*
    Stories Part 4 (B5): no client can detect a screenshot, so a `?shot=1` is an unverifiable claim — never written,
    never notified, whatever the switch says. A member's saved switch is untouched.
  */
  it("🔴 a screenshot claim is never recorded — not on a fresh story, not on an existing view, switch on or off", async () => {
    db.rpc.story_view_access = vi.fn(() => ({ data: "ok", error: null }));
    db.tables.privacy_settings = [{ user_id: ME, story_screenshot_alerts: true }];
    const shot = () => recordView(new Request(`https://x.test/api/stories/${STORY}/views?shot=1`, { method: "POST" }), params(STORY));
    expect(await (await shot()).json()).toEqual({ ok: true, recorded: false, available: true, reason: "unsupported" });
    expect(rows()).toHaveLength(0);
    await view();
    await shot();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.screenshot_at ?? null).toBeNull();
    expect(db.tables.privacy_settings).toEqual([{ user_id: ME, story_screenshot_alerts: true }]); // the member's choice stays
  });

  it("🔴 the settings and the Seen-by sheet no longer promise screenshot detection", async () => {
    const { readFileSync } = await import("node:fs");
    const privacy = readFileSync("features/social/privacy-editor.tsx", "utf8");
    const sheet = readFileSync("features/social/story-viewers-sheet.tsx", "utf8");
    expect(privacy).not.toContain("See who screenshots your stories.");
    expect(privacy).toContain("Not available yet");
    expect(sheet).not.toContain("They can only be reported from the installed app");
    expect(sheet).toContain("nobody is ever reported here");
  });

  it("signed out: nothing recorded, nothing asked", async () => {
    user = null;
    db.rpc.story_view_access = vi.fn(() => ({ data: "ok", error: null }));
    expect((await (await view()).json()).recorded).toBe(false);
    expect(db.rpc.story_view_access).not.toHaveBeenCalled();
  });
});

describe("the viewer list stays the author's", () => {
  const list = () => viewers(new Request(`https://x.test/api/stories/${STORY}/views`), params(STORY));
  beforeEach(() => {
    db.tables.stories = [{ id: STORY, user_id: THEM }];
    db.tables.story_views = [{ story_id: STORY, viewer_id: ME, viewed_at: "2026-10-26T10:00:00Z", screenshot_at: null }];
  });

  it("🔴 signed out: 401, and no view record leaves", async () => {
    user = null;
    const res = await list();
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain(ME);
  });

  it("🔴 a viewer who is not the author: 403, even one who is IN the list", async () => {
    const res = await list();
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain("viewedAt");
  });

  it("the author: their viewers", async () => {
    user = { id: THEM };
    const body = await (await list()).json();
    expect(body.viewers.map((v: { id: string }) => v.id)).toEqual([ME]);
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
