import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { EDGE_CACHE_HEADER, EDGE_CACHED_SOURCES } from "./edge-cache";

/*
  Owner, 2026-10-31: the landing and downloader pages waited 0.55–0.85 s for a first byte because Cloudflare
  revalidated a prerendered page on every visit. The edge header must reach exactly those pages — and never a member
  page, which would hand one person's page to another. Matched with Next's OWN compiled path-to-regexp.
*/
const require = createRequire(import.meta.url);
const { pathToRegexp } = require("next/dist/compiled/path-to-regexp") as { pathToRegexp: (p: string) => RegExp };
const matches = (path: string, sources: readonly string[] = EDGE_CACHED_SOURCES) => sources.some((s) => pathToRegexp(s).test(path));

describe("edge caching for the cold-entry pages", () => {
  it("covers the landing and the downloader pages", () => {
    for (const p of ["/", "/tiktok-video-downloader", "/instagram-reels-downloader", "/snapchat-story-downloader"]) expect(matches(p), p).toBe(true);
  });
  it("never covers a member page, an API route, or anything nested", () => {
    for (const p of ["/downloads", "/home", "/history", "/messages", "/u/chris", "/api/download", "/tiktok-video-downloader/2026/10/x", "/admin"]) expect(matches(p), p).toBe(false);
  });
  it("is Cloudflare's own header (browsers ignore it), with a short edge life and a background refresh", () => {
    expect(EDGE_CACHE_HEADER.key).toBe("Cloudflare-CDN-Cache-Control");
    expect(EDGE_CACHE_HEADER.value).toMatch(/^max-age=\d{2,3}, stale-while-revalidate=\d+$/);
  });
  it("next.config.ts applies it", () => {
    expect(readFileSync("next.config.ts", "utf8")).toMatch(/\.\.\.EDGE_CACHED_SOURCES\.map\(\(source\) => \(\{ source, headers: \[\{ \.\.\.EDGE_CACHE_HEADER \}\] \}\)\)/);
  });
  it("teeth: a catch-all pattern would also cover member pages", () => {
    expect(matches("/downloads", ["/:page*"])).toBe(true);
  });
});
