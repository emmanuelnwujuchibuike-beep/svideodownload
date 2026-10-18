import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REMOVED_SEO_PAGES } from "@/lib/seo/removed-seo-pages";
import { SEO_SLUGS } from "@/lib/seo/seo-pages";
import { CATEGORIES } from "@/lib/social/categories";

import { HANDLE_RE, isProfilePath, profileHandleFromPath, profilePath, profileRoute, RESERVED_HANDLES } from "./profile-url";

/**
 * Profiles at /:handle (owner, 2026-10-17): https://www.frenzsave.com/chris. The middleware's
 * decision, the link builder, and the guarantees that no handle can ever shadow an app page.
 */

const ROOT = process.cwd();

describe("the middleware's decision (profileRoute)", () => {
  it("/chris is served by the profile page — a rewrite, the address bar keeps /chris", () => {
    expect(profileRoute("/chris")).toEqual({ kind: "rewrite", to: "/u/chris" });
    expect(profileRoute("/chris/followers", "?x=1")).toEqual({ kind: "rewrite", to: "/u/chris/followers?x=1" });
    expect(profileRoute("/chris_99/card")).toEqual({ kind: "rewrite", to: "/u/chris_99/card" });
  });

  it("old /u/ links redirect permanently to /:handle, keeping the whole query (referral codes, tabs)", () => {
    expect(profileRoute("/u/chris")).toEqual({ kind: "redirect", to: "/chris" });
    expect(profileRoute("/u/chris", "?ref=ABC123&tab=sub")).toEqual({ kind: "redirect", to: "/chris?ref=ABC123&tab=sub" });
    expect(profileRoute("/u/chris/followers", "?a=1")).toEqual({ kind: "redirect", to: "/chris/followers?a=1" });
    expect(profileRoute("/u/Chris")).toEqual({ kind: "redirect", to: "/chris" });
  });

  it("one canonical spelling: upper case and encoded forms redirect to lowercase /:handle", () => {
    expect(profileRoute("/Chris", "?ref=x")).toEqual({ kind: "redirect", to: "/chris?ref=x" });
    expect(profileRoute("/%63hris")).toEqual({ kind: "redirect", to: "/chris" });
  });

  it("an app route, a category hub or a downloader page is never touched", () => {
    for (const p of ["/feed", "/reels", "/ai", "/wallpapers", "/admin", "/profile", "/downloads", "/music", "/tiktok-downloader", "/", "/u", "/api/health", "/Feed"]) expect(profileRoute(p), p).toBeNull();
  });

  it("invalid or undecodable names fall through to the usual 404, never a crash", () => {
    for (const p of ["/ab", "/a-b-c", "/way_too_long_for_a_handle_x", "/%E0%A4%A", "/ch.ris", "/u/%E0%A4%A", "/u/feed", "/u/a"]) expect(profileRoute(p), p).toBeNull();
  });

  it("a reserved handle (none exist, 2026-10-17) keeps working at /u/ — it is never redirected onto a page", () => {
    expect(profileRoute("/u/feed")).toBeNull();
    expect(profilePath("feed")).toBe("/u/feed");
  });
});

describe("the link builder", () => {
  it("builds /:handle, with sub-pages and queries", () => {
    expect(profilePath("chris")).toBe("/chris");
    expect(profilePath("@chris")).toBe("/chris");
    expect(profilePath("chris", "/followers")).toBe("/chris/followers");
    expect(profilePath("chris", "followers")).toBe("/chris/followers");
    expect(profilePath("chris", "?tab=sub")).toBe("/chris?tab=sub");
  });
  it("a legacy handle outside the format keeps the old, working /u/ path (encoded) — never a page", () => {
    expect(profilePath("Chris_X")).toBe("/u/Chris_X");
    expect(profilePath("a b")).toBe("/u/a%20b");
    expect(profilePath(null)).toBe("/u/");
  });
  it("recognises a profile path in either form", () => {
    expect(profileHandleFromPath("/chris")).toBe("chris");
    expect(profileHandleFromPath("/chris/followers")).toBe("chris");
    expect(profileHandleFromPath("/u/chris/card")).toBe("chris");
    for (const p of ["/feed", "/", "/tiktok-downloader", "/p/abc", "/u"]) expect(isProfilePath(p), p).toBe(false);
  });
});

describe("🔴 no handle can ever shadow an app page", () => {
  const topLevel = (dir: string) =>
    readdirSync(join(ROOT, dir)).filter((n) => {
      if (n.startsWith("(") || n.startsWith("[") || n.startsWith("_") || n.startsWith(".")) return false;
      return statSync(join(ROOT, dir, n)).isDirectory();
    });
  const routes = [...topLevel("app"), ...readdirSync(join(ROOT, "app")).filter((g) => g.startsWith("(")).flatMap((g) => topLevel(join("app", g)))];
  const publicDirs = topLevel("public");

  it("scans the real route tree", () => {
    expect(routes).toEqual(expect.arrayContaining(["u", "api", "feed", "reels", "ai", "admin", "profile"]));
  });

  it("every top-level route and public folder that LOOKS like a handle is reserved", () => {
    const unreserved = [...routes, ...publicDirs].filter((n) => HANDLE_RE.test(n) && !RESERVED_HANDLES.has(n));
    expect(unreserved).toEqual([]);
  });

  it("teeth: a new top-level route not on the list is caught", () => {
    const fake = [...routes, "newpage"];
    expect(fake.filter((n) => HANDLE_RE.test(n) && !RESERVED_HANDLES.has(n))).toEqual(["newpage"]);
  });

  it("every category hub is reserved (they share the /:slug route)", () => {
    for (const c of CATEGORIES) expect(RESERVED_HANDLES.has(c), c).toBe(true);
  });

  it("no downloader page, live or retired (next.config redirects), can look like a handle", () => {
    expect(SEO_SLUGS.filter((s) => HANDLE_RE.test(s))).toEqual([]);
    expect(REMOVED_SEO_PAGES.map((r) => r.from).filter((s) => HANDLE_RE.test(s))).toEqual([]);
  });

  it("new handles are refused for every reserved name (the sign-up/edit rule uses the same list)", () => {
    const profileSrc = readFileSync(join(ROOT, "lib", "social", "profile.ts"), "utf8");
    expect(profileSrc).toContain("if (!HANDLE_RE.test(h) || RESERVED_HANDLES.has(h)) return null;");
  });
});

describe("the middleware wiring", () => {
  const mw = readFileSync(join(ROOT, "middleware.ts"), "utf8");
  it("decides before the prefetch shortcut and the auth path; redirects are permanent (308)", () => {
    expect(mw.indexOf("profileRoute(")).toBeLessThan(mw.indexOf('next-router-prefetch'));
    expect(mw).toContain("return NextResponse.redirect(new URL(profile.to, request.url), 308);");
  });
  it("every pass-through carries the rewrite (no bare NextResponse.next({ request }) left)", () => {
    expect(mw).not.toContain("NextResponse.next({ request })");
    expect((mw.match(/proceed\(\{ request \}\)/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});
