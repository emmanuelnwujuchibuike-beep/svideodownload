import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * PART 10 — the middleware runs only where it has work to do.
 *
 * Production logs (2026-10-09, 46 min): 54% of all Edge Middleware invocations
 * were the service worker and its modules. This runs the REAL matcher pattern
 * from middleware.ts against sample paths, so a future edit that lets static
 * files back in — or, worse, lets a guarded page out — turns this red.
 */
const src = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
const pattern = /matcher: \[[\s\S]*?"(\/\(\(\?!.*?\)\.\*\))",\s*\]/.exec(src)?.[1];
const matches = (path: string) => new RegExp(`^${pattern!.replace(/\\\\/g, "\\")}$`).test(path);

describe("middleware matcher", () => {
  it("the pattern is found", () => expect(pattern).toBeTruthy());

  it("skips the service worker, its modules, the manifest and static files", () => {
    for (const p of ["/sw.js", "/sw/routes.js", "/sw/config.js", "/manifest.webmanifest", "/launch.html", "/fonts/x.woff2", "/media/a.mp4", "/brand/logo.png", "/.well-known/assetlinks.json"]) {
      expect(matches(p), p).toBe(false);
    }
  });

  it("teeth: still runs on every page and API that needs a session or a guard", () => {
    for (const p of ["/", "/downloads", "/admin", "/admin/login", "/account", "/ai/character-replace", "/studio", "/messages", "/api/me", "/api/v1/app/me", "/history", "/ai", "/ai/text-to-video", "/frenz-aix", "/advertise/create"]) {
      expect(matches(p), p).toBe(true);
    }
  });

  it("SEO: skips the static /frenz-ai guides — that segment only", () => {
    for (const p of ["/frenz-ai", "/frenz-ai/", "/frenz-ai/kling-ai", "/frenz-ai/text-to-video"]) expect(matches(p), p).toBe(false);
  });
});
