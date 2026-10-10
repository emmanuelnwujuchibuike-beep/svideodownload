import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

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
