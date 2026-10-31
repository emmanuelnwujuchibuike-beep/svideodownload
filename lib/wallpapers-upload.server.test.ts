import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * 2026-10-26 (owner: "Wallpapers are refusing to upload … refusing double uploading and then stopped"): uploads go
 * straight to storage with one signed URL per file, and the server makes the row from the STORED file. Storage is
 * scripted here; the database is the in-memory one.
 */
let db: FakeDb;
const stored = new Map<string, Blob>();
const removed: string[] = [];
const storage = {
  createSignedUploadUrl: vi.fn(async (key: string) => ({ data: { token: `tok:${key}`, path: key }, error: null })),
  download: vi.fn(async (key: string) => (stored.has(key) ? { data: stored.get(key)!, error: null } : { data: null, error: { message: "not found" } })),
  remove: vi.fn(async (keys: string[]) => (removed.push(...keys), { data: null, error: null })),
  upload: vi.fn(async () => ({ data: {}, error: null })),
  getPublicUrl: (key: string) => ({ data: { publicUrl: `https://sb.test/storage/v1/object/public/wallpapers/${key}` } }),
};
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => Object.assign(Object.create(db.client() as object) as object, { from: (t: string) => (db.client() as { from: (t: string) => unknown }).from(t), storage: { from: () => storage } }) }));
vi.mock("@/lib/media/thumbnail", () => ({ makeThumbnail: async () => null }));
const { signWallpaperUploads, commitWallpaperUpload } = await import("./wallpapers-upload");

const UID = "11111111-1111-4111-8111-111111111111";
const member = { kind: "member" as const, userId: UID };
/** a real 2×3 PNG header (the size reader needs only the header) */
const png = () => {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3]);
  return new Blob([b], { type: "image/png" });
};

beforeEach(() => {
  db = fakeDb({ wallpapers: [] });
  stored.clear();
  removed.length = 0;
});

describe("sign", () => {
  it("one signed upload per file, every key in the member's OWN folder", async () => {
    const out = await signWallpaperUploads(member, [{ type: "image/jpeg", size: 6_000_000 }, { type: "image/png", size: 9_000_000 }], 20);
    expect(out.ok && out.uploads.map((u) => u.key.startsWith(`members/${UID}/`))).toEqual([true, true]);
  });
  it("🔴 a type, a size over 50 MB, or too many files: refused before anything is signed", async () => {
    expect(await signWallpaperUploads(member, [{ type: "image/gif", size: 10 }], 20)).toMatchObject({ ok: false });
    expect(await signWallpaperUploads(member, [{ type: "image/jpeg", size: 51 * 1024 * 1024 }], 20)).toMatchObject({ ok: false });
    // a 4K PNG between 20 and 50 MB is accepted (owner, 2026-10-31: 4K stays 4K)
    expect((await signWallpaperUploads(member, [{ type: "image/png", size: 35 * 1024 * 1024 }], 20)).ok).toBe(true);
    expect(await signWallpaperUploads(member, Array.from({ length: 21 }, () => ({ type: "image/jpeg", size: 10 })), 20)).toMatchObject({ ok: false });
  });
});

describe("commit", () => {
  it("the stored file becomes a row, measured from its own bytes", async () => {
    const key = `members/${UID}/1-abc.png`;
    stored.set(key, png());
    const out = await commitWallpaperUpload(member, key, { title: "Sky", category: "Community" });
    expect(out).toMatchObject({ ok: true, width: 2, height: 3 });
    expect(db.tables.wallpapers![0]).toMatchObject({ title: "Sky", source: "member", uploaded_by: UID, width: 2, height: 3, status: "published" });
  });
  it.each([
    ["another member's folder", "members/22222222-2222-4222-8222-222222222222/1-abc.png"],
    ["the curated folder", "curated/1-abc.png"],
    ["a path escape", `members/${UID}/../x.png`],
    ["a nested path", `members/${UID}/thumbs/1.png`],
  ])("🔴 %s: refused, nothing read", async (_l, key) => {
    expect(await commitWallpaperUpload(member, key, { title: "x", category: "x" })).toEqual({ ok: false, error: "That upload isn't yours." });
    expect(storage.download).not.toHaveBeenCalledWith(key);
  });
  it("🔴 not really an image: refused and the stored file is deleted", async () => {
    const key = `members/${UID}/1-abc.png`;
    stored.set(key, new Blob([new Uint8Array(64)], { type: "image/png" }));
    expect(await commitWallpaperUpload(member, key, { title: "x", category: "x" })).toMatchObject({ ok: false });
    expect(removed).toEqual([key]);
    expect(db.tables.wallpapers).toEqual([]);
  });
});
