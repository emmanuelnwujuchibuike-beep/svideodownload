import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * The Story Viewer design (design/Frenz-Story-Viewer-design.zip, 2026-10-26) — the backend each of its controls
 * stands on, with the REAL routes over an in-memory database:
 *
 *   Allow replies      PATCH /api/stories/:id (the author only) + POST /api/stories/reply obeys it (0288)
 *   reactions          a reaction naming its story is counted once per person (story_reactions, 0288)
 *   Seen by totals     real counts: viewers, reactions, reshares — never a sample number
 *   a reply            names its story: refused past a block or when the story is not that author's
 */
let db: FakeDb;
let user: { id: string } | null;
const sendMessage = vi.fn(async () => ({ ok: true }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }));
vi.mock("@/lib/cache", () => ({ getCached: vi.fn(), cacheDelete: vi.fn(async () => {}) }));
vi.mock("@/lib/social/messages", () => ({ getOrCreateConversation: vi.fn(async () => ({ ok: true, id: "c1" })), sendMessage: (...a: unknown[]) => sendMessage(...(a as [])) }));
vi.mock("@/lib/push/web-push", () => ({ sendPushToUser: vi.fn(async () => {}) }));

const { POST: reply } = await import("./reply/route");
const { PATCH: patchStory } = await import("./[id]/route");
const { GET: viewers } = await import("./[id]/views/route");

const ME = "0b6c2f1e-1d2c-4a8b-9c3d-1234567890ab";
const AUTHOR = "9f8e7d6c-5b4a-4c3d-8e2f-ba0987654321";
const OTHER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const STORY = "20000000-0000-4000-8000-000000000001";
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const send = (body: unknown) => reply(new Request("https://x.test/api/stories/reply", { method: "POST", body: JSON.stringify(body) }));
const access = (verdict: string) => (db.rpc.story_view_access = vi.fn(() => ({ data: verdict, error: null })));

beforeEach(() => {
  user = { id: ME };
  sendMessage.mockClear();
  db = fakeDb({
    stories: [{ id: STORY, user_id: AUTHOR, allow_replies: true }],
    story_reactions: [],
    story_views: [],
    profiles: [{ id: ME, handle: "me", display_name: "Me", avatar_url: null }],
    privacy_settings: [],
  });
  access("ok");
});

describe("a reply that names its story", () => {
  it("is delivered, and a reaction is counted once per person — reacting again replaces the emoji", async () => {
    expect((await send({ toUserId: AUTHOR, text: "🔥", storyId: STORY, reaction: true })).status).toBe(200);
    expect((await send({ toUserId: AUTHOR, text: "😍", storyId: STORY, reaction: true })).status).toBe(200);
    expect(db.tables.story_reactions).toEqual([expect.objectContaining({ story_id: STORY, reactor_id: ME, emoji: "😍" })]);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("a text reply is not a reaction", async () => {
    await send({ toUserId: AUTHOR, text: "nice one", storyId: STORY });
    expect(db.tables.story_reactions).toEqual([]);
  });

  it("🔴 the author's 'Allow replies' off: 403, nothing sent, nothing counted", async () => {
    db.tables.stories![0]!.allow_replies = false;
    const res = await send({ toUserId: AUTHOR, text: "🔥", storyId: STORY, reaction: true });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Replies are off for this story.");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(db.tables.story_reactions).toEqual([]);
  });

  it.each(["forbidden", "expired", "missing"])("🔴 a story the replier may not see (%s): 403, nothing sent", async (verdict) => {
    access(verdict);
    expect((await send({ toUserId: AUTHOR, text: "hi", storyId: STORY })).status).toBe(403);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("🔴 a story that is not that author's: 403 (a reply cannot be aimed at someone else through it)", async () => {
    expect((await send({ toUserId: OTHER, text: "hi", storyId: STORY })).status).toBe(403);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("an older client that names no story still replies as before", async () => {
    expect((await send({ toUserId: AUTHOR, text: "hi" })).status).toBe(200);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("0288 not applied: the reply still goes (replies stay on), the count is simply skipped", async () => {
    db.failOn.story_reactions = "relation does not exist";
    expect((await send({ toUserId: AUTHOR, text: "🔥", storyId: STORY, reaction: true })).status).toBe(200);
  });
});

describe("PATCH /api/stories/:id — the author's 'Allow replies'", () => {
  const patch = (body: unknown) => patchStory(new Request("https://x.test", { method: "PATCH", body: JSON.stringify(body) }), params(STORY));

  it("the author turns it off", async () => {
    user = { id: AUTHOR };
    expect((await patch({ allowReplies: false })).status).toBe(200);
    expect(db.tables.stories![0]!.allow_replies).toBe(false);
  });

  it("🔴 anyone else: 404, the story untouched", async () => {
    expect((await patch({ allowReplies: false })).status).toBe(404);
    expect(db.tables.stories![0]!.allow_replies).toBe(true);
  });

  it("signed out 401 · not a boolean 400", async () => {
    user = null;
    expect((await patch({ allowReplies: false })).status).toBe(401);
    user = { id: AUTHOR };
    expect((await patch({ allowReplies: "no" })).status).toBe(400);
  });
});

describe("Seen by — real totals", () => {
  const list = () => viewers(new Request(`https://x.test/api/stories/${STORY}/views`), params(STORY));
  beforeEach(() => {
    user = { id: AUTHOR };
    db.tables.story_views = [
      { story_id: STORY, viewer_id: ME, viewed_at: "2026-10-26T10:00:00Z", screenshot_at: null },
      { story_id: STORY, viewer_id: OTHER, viewed_at: "2026-10-26T09:00:00Z", screenshot_at: null },
    ];
    db.tables.story_reactions = [{ story_id: STORY, reactor_id: ME, emoji: "🔥" }];
    db.tables.stories!.push({ id: "30000000-0000-4000-8000-000000000001", user_id: OTHER, reshared_from_story_id: STORY });
  });

  it("viewers, reactions and reshares are counted from the database, and who reacted is marked", async () => {
    const body = await (await list()).json();
    expect(body.totals).toEqual({ viewers: 2, reactions: 1, reshares: 1 });
    expect(body.viewers.map((v: { id: string; reacted: boolean }) => [v.id, v.reacted])).toEqual([
      [ME, true],
      [OTHER, false],
    ]);
  });

  it("🔴 0288 not applied: reactions is null (shown as a dash) — never a made-up 0", async () => {
    db.failOn.story_reactions = "relation does not exist";
    const body = await (await list()).json();
    expect(body.totals.reactions).toBeNull();
    expect(body.totals.viewers).toBe(2);
  });

  it("🔴 still the author's alone", async () => {
    user = { id: ME };
    expect((await list()).status).toBe(403);
  });
});

describe("migration 0288", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0288_story_replies_reactions.sql"), "utf8");
  const body = sql.replace(/--[^\n]*/g, "");
  it("adds the switch with the default ON, and an author-read-only reactions table nobody writes directly", () => {
    expect(body).toContain("add column if not exists allow_replies boolean not null default true;");
    expect(body).toContain("primary key (story_id, reactor_id)");
    expect(body).toContain("references public.stories (id) on delete cascade");
    expect(body).toContain("alter table public.story_reactions enable row level security;");
    expect(body).toContain("and s.user_id = (select auth.uid())");
    expect(body).toContain("revoke all on table public.story_reactions from anon;");
    expect(body).toContain("revoke insert, update, delete, truncate, references, trigger on table public.story_reactions from authenticated;");
  });
  it("survives the migration runner: no dollar-quoted body, no semicolon inside a string, 0285/0287 untouched", () => {
    expect(body).not.toContain("$$");
    expect(body).not.toMatch(/'[^'\n]*;[^'\n]*'/);
    expect(body).not.toMatch(/story_view_access|create or replace function/);
  });
  it("is catalogued: a data domain and the member's data export", () => {
    expect(readFileSync(join(process.cwd(), "lib/platform/data-domains.ts"), "utf8")).toContain('"story_reactions"');
    expect(readFileSync(join(process.cwd(), "lib/portability/tables.ts"), "utf8")).toContain('story_reactions: "reactor_id"');
  });
});
