import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { APP_ONLY_PREFIXES, isAppOnlyPath } from "@/lib/auth/app-only-paths";
import { middleware } from "@/middleware";

/**
 * App-only routes (owner, 2026-10-29, AdSense review): a signed-out request is answered with a redirect to sign-in
 * BEFORE any render — the server never builds a feed, post, reel, profile or sound for a guest. These drive the real
 * middleware with real requests and assert on the response it returns.
 */

const ORIGIN = "https://www.frenzsave.com";
const APP = join(process.cwd(), "app");

/** Every page.tsx as its URL path, route groups stripped (dynamic segments kept as [x]). */
function pageUrls(): string[] {
  return (readdirSync(APP, { recursive: true }) as string[])
    .filter((f) => /(^|[\\/])page\.tsx$/.test(f))
    .map((f) => {
      const segs = relative(APP, join(APP, f))
        .replace(/\\/g, "/")
        .replace(/(^|\/)page\.tsx$/, "")
        .split("/")
        .filter((seg) => seg && !/^\(.*\)$/.test(seg));
      return `/${segs.join("/")}`;
    });
}

async function guest(path: string, headers: Record<string, string> = {}) {
  return middleware(new NextRequest(`${ORIGIN}${path}`, { headers }));
}

describe("app-only routes", () => {
  it("every listed prefix is a real route (no dead entries)", () => {
    const urls = pageUrls();
    for (const prefix of APP_ONLY_PREFIXES) {
      expect(urls.some((u) => u === prefix || u.startsWith(`${prefix}/`)), `${prefix} has no page`).toBe(true);
    }
  });

  it("matches whole segments only", () => {
    expect(isAppOnlyPath("/sound/123")).toBe(true);
    expect(isAppOnlyPath("/u/chris")).toBe(true);
    expect(isAppOnlyPath("/account/security")).toBe(true);
    expect(isAppOnlyPath("/soundtrack")).toBe(false);
    expect(isAppOnlyPath("/unsubscribe")).toBe(false);
    expect(isAppOnlyPath("/advertise")).toBe(false);
    expect(isAppOnlyPath("/about")).toBe(false);
  });

  it("sends a guest to /login with ?next= for every app-only route — no render", async () => {
    const paths = ["/home", "/reels", "/explore", "/sounds", "/friends", "/history", "/messages", "/profile", "/saved",
      "/notifications", "/search", "/quests", "/exclusive", "/feed", "/account/security", "/advertise/campaigns", "/sound/abc"];
    for (const path of paths) {
      const res = await guest(path);
      expect(res.status, path).toBe(307);
      const to = new URL(res.headers.get("location") ?? "", ORIGIN);
      expect(to.pathname, path).toBe("/login");
      expect(to.searchParams.get("next"), path).toBe(path);
    }
  });

  it("sends a guest to /login for a profile at /<handle>, keeping the address they asked for", async () => {
    const res = await guest("/chris");
    expect(res.status).toBe(307);
    const to = new URL(res.headers.get("location") ?? "", ORIGIN);
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("next")).toBe("/chris");
  });

  it("does not let a prefetch header slip a guest past the guard", async () => {
    const res = await guest("/home", { "next-router-prefetch": "1" });
    expect(res.status).toBe(307);
  });

  it("leaves public pages alone (teeth: an over-broad guard fails here)", async () => {
    for (const path of ["/", "/about", "/blog", "/wallpapers", "/tiktok-video-downloader", "/advertise", "/unsubscribe"]) {
      const res = await guest(path);
      expect(res.headers.get("location"), path).toBeNull();
    }
  });
});
