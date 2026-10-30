import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { APP_ONLY_PREFIXES, isAppOnlyPath } from "@/lib/auth/app-only-paths";
import { safeNext } from "@/lib/auth/safe-next";
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

/*
  Code review, 2026-10-30. (1) A guest's sign-in keeps the WHOLE address — a search, a ?ref= link — not just the path.
  (2) A link-preview fetcher (WhatsApp, X, iMessage…) asking for an app-only route gets the share card, so a shared
  profile, sound or reel draws its own preview; search and ad crawlers and people still get the sign-in redirect.
*/
const WHATSAPP = "WhatsApp/2.23.20.0 A";
// what iMessage sends for a link preview
const IMESSAGE = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0";
const GOOGLEBOT = "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const signInTarget = (res: Response) => {
  const to = new URL(res.headers.get("location") ?? "", ORIGIN);
  return { status: res.status, pathname: to.pathname, next: to.searchParams.get("next") };
};

describe("sign-in keeps the address as asked (query included)", () => {
  it("a search, a referral link and a profile tab come back with their query", async () => {
    for (const path of ["/search?q=cats", "/exclusive?ref=abc&from=wa", "/chris?tab=reels", "/sound/abc?t=12"]) {
      const target = signInTarget(await guest(path));
      expect(target, path).toEqual({ status: 307, pathname: "/login", next: path });
      // and the sign-in page accepts it as given (lib/auth/safe-next.ts)
      expect(safeNext(target.next), path).toBe(path);
    }
  });

  it("a query too long for safeNext keeps the path, never falling back to /home", async () => {
    const path = `/search?q=${"x".repeat(600)}`;
    expect(signInTarget(await guest(path)).next).toBe("/search");
  });
});

describe("link previews of app-only routes", () => {
  const cardFor = (res: Response) => {
    const rewrite = res.headers.get("x-middleware-rewrite");
    if (!rewrite) return null;
    const to = new URL(rewrite, ORIGIN);
    return to.pathname === "/api/share-card" ? { path: to.searchParams.get("path"), to: to.searchParams.get("to") } : null;
  };

  it("a preview fetcher gets the share card for a profile, a sound and a reel — not the login page", async () => {
    const cases: [string, string][] = [["/chris", "/u/chris"], ["/sound/abc", "/sound/abc"], ["/reels?tab=ai", "/reels"], ["/exclusive", "/exclusive"]];
    for (const ua of [WHATSAPP, IMESSAGE]) {
      for (const [path, internal] of cases) {
        const res = await guest(path, { "user-agent": ua });
        expect(res.headers.get("location"), `${ua} ${path}`).toBeNull();
        expect(cardFor(res), `${ua} ${path}`).toEqual({ path: internal, to: path });
      }
    }
  });

  it("🔴 Googlebot, AdSense, Bing and a person's browser still get the sign-in redirect (teeth)", async () => {
    for (const ua of [GOOGLEBOT, "Mediapartners-Google", "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", IPHONE, ""]) {
      const res = await guest("/chris", ua ? { "user-agent": ua } : {});
      expect(cardFor(res), ua).toBeNull();
      expect(signInTarget(res), ua).toEqual({ status: 307, pathname: "/login", next: "/chris" });
    }
  });

  it("only app-only routes: a public page is served as normal to a fetcher too", async () => {
    for (const path of ["/", "/about", "/tiktok-video-downloader"]) {
      const res = await guest(path, { "user-agent": WHATSAPP });
      expect(cardFor(res), path).toBeNull();
      expect(res.headers.get("location"), path).toBeNull();
    }
  });
});
