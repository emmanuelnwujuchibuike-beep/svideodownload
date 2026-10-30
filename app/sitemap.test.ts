import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { isAppOnlyPath } from "@/lib/auth/app-only-paths";
import { REMOVED_SEO_PAGES } from "@/lib/seo/removed-seo-pages";
import { getPrimaryPages } from "@/lib/seo/seo-pages";
import { CATEGORIES } from "@/lib/social/categories";

import sitemap from "./sitemap";

type Entry = ReturnType<typeof sitemap>[number];

// a clock no real content date can match
const FAKE_NOW = new Date("2031-01-01T00:00:00.000Z");

/** Entries whose lastmod is the clock at generation time — a build stamp, not a content date. */
function clockDates(entries: Entry[], now: Date): string[] {
  return entries.filter((e) => e.lastModified !== undefined && new Date(e.lastModified).getTime() === now.getTime()).map((e) => e.url);
}

describe("sitemap lastmod", () => {
  afterEach(() => vi.useRealTimers());

  function generateAt(now: Date): Entry[] {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    return sitemap();
  }

  it("no entry carries the generation time as its lastmod", () => {
    expect(clockDates(generateAt(FAKE_NOW), FAKE_NOW)).toEqual([]);
  });

  it("the guard catches a build-time date (teeth)", () => {
    const bad: Entry[] = [{ url: "https://x/a", lastModified: FAKE_NOW }, { url: "https://x/b", lastModified: "2026-06-10" }];
    expect(clockDates(bad, FAKE_NOW)).toEqual(["https://x/a"]);
  });

  it("every lastmod that is present is a valid date", () => {
    for (const e of sitemap()) if (e.lastModified !== undefined) expect(Number.isNaN(new Date(e.lastModified).getTime()), e.url).toBe(false);
  });

  it("real dates survive: blog posts and guides keep theirs", () => {
    const dated = sitemap().filter((e) => e.lastModified !== undefined).map((e) => e.url);
    expect(dated.some((u) => u.includes("/blog/"))).toBe(true);
    expect(dated.some((u) => u.endsWith("/frenz-ai"))).toBe(true);
  });

  it("source never reintroduces a build-time date", () => {
    const src = readFileSync("app/sitemap.ts", "utf8");
    expect(src).not.toMatch(/new Date\(\)/);
    expect(src).not.toMatch(/lastModified:\s*now/);
  });
});

/** Paths the sitemap must never list (owner, 2026-10-29): app-only routes, merged variants, category hubs, the AI tools. */
function forbidden(paths: string[]): string[] {
  const removed = new Set(REMOVED_SEO_PAGES.map((r) => `/${r.from}`));
  const hubs = new Set(CATEGORIES.map((c) => `/${c}`));
  return paths.filter((p) => isAppOnlyPath(p) || removed.has(p) || hubs.has(p) || p === "/ai" || p.startsWith("/ai/"));
}

describe("sitemap contents — public content only (owner, 2026-10-29)", () => {
  const paths = sitemap().map((e) => new URL(e.url).pathname);

  it("lists no gated route, no deleted variant, no category hub and no AI tool", () => {
    expect(forbidden(paths)).toEqual([]);
  });

  it("the guard catches each kind (teeth)", () => {
    const bad = ["/explore", "/u/chris", `/${REMOVED_SEO_PAGES[0]!.from}`, `/${CATEGORIES[0]}`, "/ai/text-to-video", "/about"];
    expect(forbidden(bad)).toEqual(bad.slice(0, 5));
  });

  it("lists exactly the 11 platform pages, one per platform", () => {
    const downloaders = paths.filter((p) => /-downloader$/.test(p));
    expect(downloaders.sort()).toEqual(getPrimaryPages().map((p) => `/${p.slug}`).sort());
    expect(downloaders).toHaveLength(11);
  });

  it("keeps the owner's public pages", () => {
    for (const p of ["/", "/about", "/contact", "/privacy", "/terms", "/dmca", "/glossary", "/help", "/trust", "/pricing", "/frenz-ai", "/wallpapers", "/developers", "/advertise", "/blog", "/learn", "/topics"]) {
      expect(paths, p).toContain(p);
    }
    expect(paths.some((p) => p.startsWith("/blog/"))).toBe(true);
    expect(paths.some((p) => p.startsWith("/learn/"))).toBe(true);
  });
});
