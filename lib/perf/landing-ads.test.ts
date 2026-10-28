import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/*
  Owner, 2026-10-28: "make sure nothing blocks the Adsterra scripts, the pop-under and the Smartlink". The static
  landing runs no React; its ad runtime is the app's OWN modules bundled to public/landing/ads.js
  (scripts/build-landing-ads.mjs). These pin that the bundle is real, current and wired.
*/
const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const SOURCES = [
  "features/monetization/landing-ads.ts",
  "features/monetization/direct-link-runtime.ts",
  "features/monetization/inject.ts",
  "features/monetization/ad-inventory-client.ts",
  "lib/monetization/popunder-guard.ts",
  "lib/monetization/open-observer.ts",
  "lib/monetization/direct-link.ts",
  "lib/monetization/spot-popunder.ts",
  "lib/monetization/ads-config-client.ts",
];

describe("the landing's ad runtime", () => {
  it("public/landing/ads.js is the bundle of the app's modules, and exports what the landing calls", () => {
    const js = read("public/landing/ads.js");
    for (const m of ["popunder-guard.ts", "open-observer.ts", "direct-link-runtime.ts", "inject.ts"]) expect(js).toContain(m);
    expect(js).toMatch(/export\s*\{[^}]*\barmSpots\b[^}]*\}/);
    for (const name of ["openSpot", "globalScripts", "installPopunderGuard"]) expect(js).toMatch(new RegExp(`as ${name}[,\\s}]`));
  });
  it("the bundle is not older than any module it is built from (run node scripts/build-landing-ads.mjs)", () => {
    const built = statSync(path.join(root, "public/landing/ads.js")).mtimeMs;
    for (const s of SOURCES) expect(statSync(path.join(root, s)).mtimeMs, `${s} changed after ads.js was built`).toBeLessThanOrEqual(built + 1000);
  });
  it("🔴 the landing never replaces window.open for good (it blocked the pop-under and the Smartlink)", () => {
    const extras = read("public/landing/extras.js");
    expect(extras).not.toMatch(/window\.open\s*=/);
    expect(extras).toContain("installPopunderGuard()");
    expect(extras).toContain("globalScripts()");
  });
  it("the result's spots are the app's: resultPreview on the preview, download on Save, opened inside the tap", () => {
    const r = read("public/landing/result.js");
    expect(r).toContain('data-ad-spot="resultPreview"');
    expect(r).toContain('data-ad-spot="download"');
    expect(r).toContain('armSpots(["resultPreview", "download"])');
    // the download spot fires BEFORE the first await of the click (a pop-up outside the gesture is blocked)
    const click = r.slice(r.indexOf('btn.addEventListener("click"'));
    expect(click.indexOf('openSpot("download")')).toBeGreaterThan(0);
    expect(click.indexOf('openSpot("download")')).toBeLessThan(click.indexOf("await "));
  });
  it("ads.js is part of the content hash that versions the landing scripts", () => {
    expect(read("app/route.ts")).toMatch(/const FILES = \[[^\]]*"ads\.js"/);
  });
});
