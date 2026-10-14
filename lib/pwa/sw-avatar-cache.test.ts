import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

/**
 * Avatars get their own cache-first cache (owner, 2026-10-10: "the users chat
 * avatar always reloads … it shouldn't even be noticeable"). The 80-entry
 * IMAGE_CACHE was being filled by feed thumbnails, evicting every face, so each
 * entry to Chats re-fetched them (~1 s per avatar from storage).
 *
 * Runs the REAL config.js + routes.js in a VM and records which strategy and
 * cache the fetch router picks.
 */
const SW = (f: string) => readFileSync(join(process.cwd(), "public", "sw", f), "utf8");
const STORAGE = "https://wmimmsrtafazowjperog.supabase.co/storage/v1/object/public/media/00d46d9a";

async function route(url: string, destination = "image") {
  let listener: ((e: unknown) => void) | null = null;
  const picked: string[] = [];
  const self = {
    location: new URL("https://frenzsave.com/sw.js"),
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (type === "fetch") listener = fn;
    },
  };
  const ctx = { self, URL, Response, console, caches: {}, fetch: () => Promise.reject(new Error("no network in test")) };
  runInNewContext(SW("config.js"), ctx);
  const swx = (self as unknown as { SWX: Record<string, unknown> }).SWX;
  swx.cacheFirst = (_r: unknown, cache: string) => void picked.push(`cacheFirst:${cache}`);
  swx.staleWhileRevalidate = (_r: unknown, cache: string) => void picked.push(`swr:${cache}`);
  // 2026-10-14: images first ask the kept-history cache (a miss here), then fall through
  swx.fromHistoryThumbs = async () => {
    picked.push("kept?");
    return null;
  };
  runInNewContext(SW("routes.js"), ctx);
  let answered: unknown;
  listener!({ request: { method: "GET", url, destination, mode: "no-cors", referrer: "" }, respondWith: (r: unknown) => void (answered = r) });
  await answered;
  return { picked: picked.filter((x) => x !== "kept?"), asked: picked, swx };
}

describe("service worker: avatars are cached apart, cache-first", () => {
  it("a versioned avatar is answered cache-first from AVATAR_CACHE", async () => {
    const { picked, swx } = await route(`${STORAGE}/avatar-1790745090148.jpg?v=1790745090822`);
    expect(picked).toEqual([`cacheFirst:${swx.AVATAR_CACHE as string}`]);
    expect(swx.KEEP).toContain(swx.AVATAR_CACHE);
    expect((swx.LIMITS as Record<string, number>)[swx.AVATAR_CACHE as string]).toBeGreaterThanOrEqual(100);
  });

  it("teeth: an unversioned avatar or any other image still revalidates in IMAGE_CACHE", async () => {
    const a = await route(`${STORAGE}/avatar-1790745090148.jpg`);
    expect(a.picked).toEqual([`swr:${a.swx.IMAGE_CACHE as string}`]);
    const t = await route(`${STORAGE}/thumb-123.jpg?v=1`);
    expect(t.picked).toEqual([`swr:${t.swx.IMAGE_CACHE as string}`]);
  });

  it("2026-10-14: other images ask the kept-history cache first; versioned avatars never do", async () => {
    const t = await route(`${STORAGE}/thumb-123.jpg?v=1`);
    expect(t.asked).toEqual(["kept?", `swr:${t.swx.IMAGE_CACHE as string}`]);
    const a = await route(`${STORAGE}/avatar-1790745090148.jpg?v=1790745090822`);
    expect(a.asked).not.toContain("kept?");
  });

  it("the worker version was bumped with the routing change (installed apps only update on a bump)", async () => {
    expect(Number(/SWX\.VERSION\s*=\s*"v(\d+)"/.exec(SW("config.js"))?.[1])).toBeGreaterThanOrEqual(26);
  });
});

describe("service worker v27: rendered avatars, and a cache that survives deploys (2026-10-10)", () => {
  const RENDER = "https://wmimmsrtafazowjperog.supabase.co/storage/v1/render/image/public/media/00d46d9a";
  it("the rendered avatar the app now draws is answered cache-first from AVATAR_CACHE", async () => {
    const { picked, swx } = await route(`${RENDER}/avatar-1790745090148.jpg?v=1790745090822&width=128&height=128&resize=cover&quality=70`);
    expect(picked).toEqual([`cacheFirst:${swx.AVATAR_CACHE as string}`]);
  });

  it("the avatar cache is not named after the SW version, so a deploy does not empty it", async () => {
    const { swx } = await route(`${RENDER}/avatar-1.jpg?v=1`);
    expect(swx.AVATAR_CACHE as string).not.toContain(swx.VERSION as string);
    expect(swx.KEEP).toContain(swx.AVATAR_CACHE);
  });

  it("teeth: an unversioned render, or a render that is not an avatar, is not kept forever", async () => {
    const unversioned = await route(`${RENDER}/avatar-1.jpg?width=128`);
    expect(unversioned.picked).not.toContain(`cacheFirst:${unversioned.swx.AVATAR_CACHE as string}`);
    const post = await route(`${RENDER}/post-1.jpg?v=1&width=128`);
    expect(post.picked).not.toContain(`cacheFirst:${post.swx.AVATAR_CACHE as string}`);
  });
});
