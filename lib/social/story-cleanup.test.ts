import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Stories Part 1 (2026-10-26, audit S1) — the REAL sweep (only `server-only`, the
 * database client, the storage delete and the CDN purge are replaced). The SQL
 * half — which rows still use a file — is proven against Postgres by
 * supabase/tests/0285_stories_security.pglite.mjs; here `story_media_references`
 * is scripted and the sweep's own decisions are pinned.
 */
let db: FakeDb;
const deleted: string[] = [];
const failKeys = new Set<string>();
const purged: string[][] = [];
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/storage", () => ({
  deleteStoredUpload: vi.fn(async (up: { key: string }) => {
    if (failKeys.has(up.key)) return false;
    deleted.push(up.key);
    return true;
  }),
}));
vi.mock("@/lib/storage/cdn-purge", () => ({
  purgeCdnUrls: vi.fn(async (urls: string[]) => {
    purged.push([...urls]);
    return { configured: true, purged: urls.length, errors: 0 };
  }),
}));
const { runStoryCleanup, ownedStoryFiles } = await import("./story-cleanup");

const R2 = "https://media.test";
const A = "0b6c2f1e-1d2c-4a8b-9c3d-1234567890ab";
const B = "9f8e7d6c-5b4a-4c3d-8e2f-ba0987654321";
const file = (owner: string, name: string, folder = "images") => `${R2}/${owner}/${folder}/${name}`;
const key = (url: string) => url.slice(R2.length + 1);
const past = new Date(Date.now() - 86_400_000).toISOString();
const future = new Date(Date.now() + 3_600_000).toISOString();
let inUse: string[];

beforeEach(() => {
  vi.stubEnv("R2_PUBLIC_BASE_URL", R2);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://sb.test");
  deleted.length = 0;
  purged.length = 0;
  failKeys.clear();
  inUse = [];
  db = fakeDb({ stories: [], story_views: [] });
  db.rpc.story_media_references = vi.fn((args: Record<string, unknown>) => ({
    data: (args.p_urls as string[]).filter((u) => inUse.includes(u)),
    error: null,
  }));
});

describe("ownedStoryFiles — what a story may ever delete", () => {
  const bases = { r2PublicBase: R2 };
  it("its author's own media and cover", () => {
    const row = { id: "s", user_id: A, media_url: file(A, "1792999483123-a.mp4", "videos"), thumbnail_url: file(A, "1792999483123-a-poster.jpg") };
    expect(ownedStoryFiles(row, bases).map((f) => f.upload.key)).toEqual([key(row.media_url), key(row.thumbnail_url)]);
  });
  it("a reshare's file, owned by the SOURCE's author", () => {
    const row = { id: "s", user_id: B, reshared_from_user_id: A, media_url: file(A, "1792999483123-a.jpg"), thumbnail_url: null };
    expect(ownedStoryFiles(row, bases)).toHaveLength(1);
  });
  it("🔴 never another member's file, a foreign URL, or an unattributable key", () => {
    expect(ownedStoryFiles({ id: "s", user_id: B, media_url: file(A, "1792999483123-a.jpg"), thumbnail_url: null }, bases)).toEqual([]);
    expect(ownedStoryFiles({ id: "s", user_id: A, media_url: "https://evil.test/x.jpg", thumbnail_url: null }, bases)).toEqual([]);
    expect(ownedStoryFiles({ id: "s", user_id: A, media_url: `${R2}/post-media/images/1782768190594-poster.jpg`, thumbnail_url: null }, bases)).toEqual([]);
  });
});

describe("runStoryCleanup", () => {
  it("removes an expired story, its viewer list, and its unused files — then forgets them at the CDN", async () => {
    const media = file(A, "1792999483123-a.mp4", "videos");
    const cover = file(A, "1792999483123-a-poster.jpg");
    db.tables.stories = [{ id: "s1", user_id: A, media_url: media, thumbnail_url: cover, expires_at: past }];
    db.tables.story_views = [{ story_id: "s1", viewer_id: B }];
    const out = await runStoryCleanup();
    expect(out).toMatchObject({ storiesDeleted: 1, viewsDeleted: 1, filesDeleted: 2, filesInUse: 0, errors: 0, retried: 0 });
    expect(deleted.sort()).toEqual([key(media), key(cover)].sort());
    expect(db.tables.stories).toEqual([]);
    expect(db.tables.story_views).toEqual([]);
    expect(purged.flat().sort()).toEqual([media, cover].sort());
  });

  it("🔴 never touches a LIVE story", async () => {
    db.tables.stories = [{ id: "live", user_id: A, media_url: file(A, "1792999483123-a.jpg"), thumbnail_url: null, expires_at: future }];
    const out = await runStoryCleanup();
    expect(out.storiesDeleted).toBe(0);
    expect(deleted).toEqual([]);
    expect(db.tables.stories).toHaveLength(1);
  });

  it("🔴 keeps a file something else still uses (a feed post, a chat), and still removes the story", async () => {
    const shared = file(A, "1792999483123-both.jpg");
    inUse = [shared];
    db.tables.stories = [{ id: "s1", user_id: A, media_url: shared, thumbnail_url: null, expires_at: past }];
    const out = await runStoryCleanup();
    expect(out).toMatchObject({ storiesDeleted: 1, filesDeleted: 0, filesInUse: 1 });
    expect(deleted).toEqual([]);
  });

  it("asks about the rows it is sweeping by id, so they never keep their own file alive", async () => {
    db.tables.stories = [{ id: "s1", user_id: A, media_url: file(A, "1792999483123-a.jpg"), thumbnail_url: null, expires_at: past }];
    await runStoryCleanup();
    expect(db.rpc.story_media_references).toHaveBeenCalledWith(expect.objectContaining({ p_exclude: ["s1"] }));
  });

  it("🔴 never deletes a foreign or another member's file — the row still goes", async () => {
    db.tables.stories = [
      { id: "s1", user_id: A, media_url: "https://evil.test/track.gif", thumbnail_url: null, expires_at: past },
      { id: "s2", user_id: B, media_url: file(A, "1792999483123-a.jpg"), thumbnail_url: null, expires_at: past },
    ];
    const out = await runStoryCleanup();
    expect(deleted).toEqual([]);
    expect(out.storiesDeleted).toBe(2);
  });

  it("🔴 a file that failed to delete KEEPS its story row, so the next run retries it", async () => {
    const stuck = file(A, "1792999483123-stuck.jpg");
    failKeys.add(key(stuck));
    db.tables.stories = [
      { id: "s1", user_id: A, media_url: stuck, thumbnail_url: null, expires_at: past },
      { id: "s2", user_id: A, media_url: file(A, "1792999483124-ok.jpg"), thumbnail_url: null, expires_at: past },
    ];
    const out = await runStoryCleanup();
    expect(out).toMatchObject({ storiesDeleted: 1, retried: 1, errors: 1 });
    expect(db.tables.stories.map((r) => r.id)).toEqual(["s1"]);
  });

  it("🔴 fails SAFE when the reference check fails: no file and no row is removed", async () => {
    db.rpc.story_media_references = vi.fn(() => ({ data: null, error: { message: "timeout", code: "57014" } }));
    db.tables.stories = [{ id: "s1", user_id: A, media_url: file(A, "1792999483123-a.jpg"), thumbnail_url: null, expires_at: past }];
    const out = await runStoryCleanup();
    expect(out).toMatchObject({ storiesDeleted: 0, filesDeleted: 0, retried: 1, errors: 1 });
    expect(deleted).toEqual([]);
    expect(db.tables.stories).toHaveLength(1);
  });

  it("is idempotent: a second run finds nothing to do", async () => {
    db.tables.stories = [{ id: "s1", user_id: A, media_url: file(A, "1792999483123-a.jpg"), thumbnail_url: null, expires_at: past }];
    await runStoryCleanup();
    deleted.length = 0;
    const again = await runStoryCleanup();
    expect(again).toMatchObject({ storiesDeleted: 0, filesDeleted: 0, errors: 0 });
    expect(deleted).toEqual([]);
  });

  it("logs counts only — never a media URL or a user id", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const media = file(A, "1792999483123-a.jpg");
    db.tables.stories = [{ id: "s1", user_id: A, media_url: media, thumbnail_url: null, expires_at: past }];
    await runStoryCleanup();
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain(media);
    expect(logged).not.toContain(A);
    info.mockRestore();
  });
});
