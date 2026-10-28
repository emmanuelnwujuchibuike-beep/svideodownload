import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { reachableFiles } from "./css-entry";

/**
 * The cold-entry stylesheet split (2026-10-27). Pins:
 *  · the reach walk follows static imports, re-exports and literal dynamic imports, and nothing else;
 *  · it actually reaches the landing's own components (a walk that silently found nothing would ship a landing
 *    with no utilities);
 *  · the root layout imports NO stylesheet, (marketing) imports entry.css, and EVERY other page has globals.css
 *    from itself or an ancestor layout — a page with neither would render unstyled.
 */
const ROOT = process.cwd();
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

describe("reachableFiles", () => {
  it("follows static, re-export and dynamic imports — and skips what nothing imports (teeth: a fixture)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "css-entry-"));
    mkdirSync(path.join(dir, "app"));
    mkdirSync(path.join(dir, "lib"));
    writeFileSync(path.join(dir, "app/page.tsx"), 'import { A } from "@/lib/a";\nconst B = () => import("../lib/b");\nexport { C } from "@/lib/c";\nimport type { T } from "@/lib/t";\n');
    for (const f of ["a", "b", "c", "t", "unused"]) writeFileSync(path.join(dir, `lib/${f}.ts`), "export const x = 1;\n");
    const got = reachableFiles(dir, ["app/page.tsx"]).map((f) => path.relative(dir, f).split(path.sep).join("/"));
    expect(got).toEqual(["app/page.tsx", "lib/a.ts", "lib/b.ts", "lib/c.ts"]);
  });

  it("reaches the landing, its downloader and the root chrome; leaves app-only screens out", () => {
    const got = new Set(reachableFiles(ROOT).map(rel));
    // the landing itself is the static app/route.ts now (no stylesheet import); the rest of the marketing tree is reached
    expect(got.has("app/(marketing)/[downloader]/page.tsx")).toBe(true);
    expect(got.has("app/(marketing)/layout.tsx")).toBe(true);
    expect(got.has("app/layout.tsx")).toBe(true);
    expect(got.has("features/app-shell/boot-splash.tsx")).toBe(true);
    expect(got.has("components/layout/site-header.tsx")).toBe(true);
    // a signed-in-only screen is not in the landing's sheet
    expect(got.has("features/social/conversation-room.tsx")).toBe(false);
    expect(got.size).toBeGreaterThan(300);
  });
});

/** Every page.tsx under app/, with the stylesheet it ends up with. */
function pagesWithoutStylesheet(appDir: string): string[] {
  const pages: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) {
        if (n !== "api") walk(p);
      } else if (n === "page.tsx") pages.push(p);
    }
  };
  walk(appDir);
  const importsCss = (file: string) => existsSync(file) && /^import\s+"[./]+(?:app|entry)\.css";/m.test(readFileSync(file, "utf8"));
  return pages
    .filter((page) => {
      let d = path.dirname(page);
      if (importsCss(page)) return false;
      while (d.startsWith(appDir) && d !== appDir) {
        if (importsCss(path.join(d, "layout.tsx"))) return false;
        d = path.dirname(d);
      }
      return true;
    })
    .map((p) => path.relative(appDir, p).split(path.sep).join("/"));
}

describe("every page gets a stylesheet", () => {
  const app = path.join(ROOT, "app");
  it("the root layout carries none; (marketing) carries entry.css; the full sheet goes everywhere else", () => {
    expect(readFileSync(path.join(app, "layout.tsx"), "utf8")).not.toMatch(/^import\s+"\.\/(globals|entry)\.css";/m);
    expect(readFileSync(path.join(app, "(marketing)/layout.tsx"), "utf8")).toMatch(/^import "\.\.\/entry\.css";/m);
    expect(readFileSync(path.join(app, "(app)/layout.tsx"), "utf8")).toMatch(/^import "\.\.\/app\.css";/m);
    expect(readFileSync(path.join(app, "app.css"), "utf8")).toMatch(/@import "\.\/globals\.css";[\s\S]*@config "\.\.\/tailwind\.config\.ts";/);
    // 2026-10-28: the landing sheet uses the FULL config — the reach-walked one went stale in Vercel's build cache and the
    // React landing shipped without its own classes. A stale-proof smaller sheet needs a build that tracks its inputs.
    const entry = readFileSync(path.join(app, "entry.css"), "utf8");
    expect(entry).toMatch(/@import "\.\/globals\.css";[\s\S]*@config "\.\.\/tailwind\.config\.ts";/);
    expect(entry).not.toMatch(/@config "\.\.\/tailwind\.entry\.config\.ts"/);
  });
  it("nothing imports globals.css directly — both sheets go through their own @config (measured: a direct import got the entry config)", () => {
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(n) && /^import\s+"[./]+globals\.css";/m.test(readFileSync(p, "utf8"))) offenders.push(rel(p));
      }
    };
    walk(app);
    expect(offenders).toEqual([]);
  });
  it("no page is left without one", () => {
    expect(pagesWithoutStylesheet(app)).toEqual([]);
  });
  it("teeth: a page in a section with no stylesheet IS reported", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "css-pages-"));
    mkdirSync(path.join(dir, "styled/deep"), { recursive: true });
    mkdirSync(path.join(dir, "bare"));
    writeFileSync(path.join(dir, "styled/layout.tsx"), 'import "../app.css";\n');
    writeFileSync(path.join(dir, "styled/deep/page.tsx"), "export default 1;\n");
    writeFileSync(path.join(dir, "bare/page.tsx"), "export default 1;\n");
    expect(pagesWithoutStylesheet(dir)).toEqual(["bare/page.tsx"]);
  });
});

/**
 * The BUILT artifact (2026-10-27): the first build of the split shipped the SAME small sheet to both groups — Tailwind
 * compiled globals.css with the entry config. Only the real CSS can show that, so when a build exists the signed-in
 * shell's sheet must be clearly larger than the marketing one, and the root layout must carry neither.
 */
describe.skipIf(!existsSync(path.join(ROOT, ".next/app-build-manifest.json")))("the built stylesheets", () => {
  const manifest = () => JSON.parse(readFileSync(path.join(ROOT, ".next/app-build-manifest.json"), "utf8")).pages as Record<string, string[]>;
  const cssOf = (key: string) => (manifest()[key] ?? []).filter((f) => f.endsWith(".css")).map((f) => readFileSync(path.join(ROOT, ".next", f), "utf8")).join("");
  it("the marketing sheet is smaller than the full one", () => {
    const entry = cssOf("/(marketing)/layout");
    const full = cssOf("/(app)/layout");
    expect(entry.length).toBeGreaterThan(50_000);
    expect(full.length).toBeGreaterThan(entry.length * 1.1);
    expect(cssOf("/layout").length).toBeLessThan(20_000);
  });
});
