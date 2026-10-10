import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/*
  Part 7 §55 (2026-10-07). Frenz AI is a private utility, never indexed
  (owner, 2026-09-09; app/robots.ts). 2026-10-09: the owner's SEO brief added a
  SEPARATE public explainer surface at /frenz-ai (lib/seo/guides.ts) — the
  TOOLS below are unchanged and stay out of the index. Every page under app/(marketing)/ai was
  already noindex — this walks the directory so a page ADDED later cannot
  quietly be the exception.
*/
const ROOT = path.resolve(__dirname, "../..");
const AI_DIR = path.join(ROOT, "app", "(marketing)", "ai");
const NOINDEX = /robots:\s*\{\s*index:\s*false,\s*follow:\s*false/;

/** Pure: the pages among `files` that do not declare noindex. */
export function indexablePages(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([f, src]) => f.endsWith("page.tsx") && !NOINDEX.test(src))
    .map(([f]) => f);
}

describe("Frenz AI pages are never indexed", () => {
  it("every /ai page declares robots noindex,nofollow", () => {
    const files: Record<string, string> = {};
    for (const f of readdirSync(AI_DIR, { recursive: true }) as string[]) {
      if (f.endsWith("page.tsx")) files[f] = readFileSync(path.join(AI_DIR, f), "utf8");
    }
    expect(Object.keys(files).length).toBeGreaterThan(10);
    expect(indexablePages(files)).toEqual([]);
  });

  it("robots.txt disallows /ai and the sitemap lists no /ai URL", () => {
    expect(readFileSync(path.join(ROOT, "app/robots.ts"), "utf8")).toMatch(/const disallow = \[[^\]]*"\/ai"/);
    const sitemap = readFileSync(path.join(ROOT, "app/sitemap.ts"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(sitemap).not.toMatch(/["'`]\/ai[/"'`]/);
  });

  it("teeth: a page without the tag is reported", () => {
    expect(indexablePages({ "new/page.tsx": 'export const metadata = { title: "New" };' })).toEqual(["new/page.tsx"]);
  });
});
