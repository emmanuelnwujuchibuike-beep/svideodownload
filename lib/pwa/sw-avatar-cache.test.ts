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

function route(url: string, destination = "image") {
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
  runInNewContext(SW("routes.js"), ctx);
  listener!({ request: { method: "GET", url, destination, mode: "no-cors", referrer: "" }, respondWith: () => {} });
  return { picked, swx };
}

describe("service worker: avatars are cached apart, cache-first", () => {
  it("a versioned avatar is answered cache-first from AVATAR_CACHE", () => {
    const { picked, swx } = route(`${STORAGE}/avatar-1790745090148.jpg?v=1790745090822`);
    expect(picked).toEqual([`cacheFirst:${swx.AVATAR_CACHE as string}`]);
    expect(swx.KEEP).toContain(swx.AVATAR_CACHE);
    expect((swx.LIMITS as Record<string, number>)[swx.AVATAR_CACHE as string]).toBeGreaterThanOrEqual(100);
  });

  it("teeth: an unversioned avatar or any other image still revalidates in IMAGE_CACHE", () => {
    const a = route(`${STORAGE}/avatar-1790745090148.jpg`);
    expect(a.picked).toEqual([`swr:${a.swx.IMAGE_CACHE as string}`]);
    const t = route(`${STORAGE}/thumb-123.jpg?v=1`);
    expect(t.picked).toEqual([`swr:${t.swx.IMAGE_CACHE as string}`]);
  });

  it("the worker version was bumped with the routing change (installed apps only update on a bump)", () => {
    expect(Number(/SWX\.VERSION\s*=\s*"v(\d+)"/.exec(SW("config.js"))?.[1])).toBeGreaterThanOrEqual(26);
  });
});
