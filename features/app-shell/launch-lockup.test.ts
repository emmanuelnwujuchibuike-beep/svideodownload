import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THREE LAUNCH SURFACES, ONE PICTURE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-04: "Why do I still see this [a bare F] instead of the
 * writing FrenzSave."
 *
 * A cold start on an installed iPhone shows three things in a row:
 *
 *   1. public/splash/*.png      iOS paints it BEFORE any of our code exists
 *   2. public/launch.html       the manifest start_url
 *   3. #frenz-boot              covers the gap after launch.html navigates
 *
 * `3c892c2` made 2 and 3 match. Nothing had ever touched 1 — the PNGs were
 * generated in July with the mark alone, by a script that lived in a
 * scratchpad and was never committed, so they could not be regenerated when
 * the wordmark shipped. The brand therefore arrived half-finished on the
 * screen that is held LONGEST, which is the whole report.
 *
 * These assertions exist because the failure mode is drift between files that
 * no one edits together.
 */

const ROOT = process.cwd();
const src = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("the generator that makes the native launch images is committed", () => {
  it("exists, so the PNGs can be regenerated when the lockup changes", () => {
    /*
      The actual root cause. A build step that only exists on one machine is a
      build step that silently stops being run.
    */
    const gen = src("scripts/gen-splash.mjs");
    expect(gen).toContain("public/splash");
    expect(gen).toContain("FrenzSave");
  });

  it("covers every size the two apple-touch-startup-image lists name", () => {
    const gen = src("scripts/gen-splash.mjs");
    const layout = src("app/layout.tsx");
    const launch = src("public/launch.html");
    // every size in the layout's SPLASH_SCREENS must be generated AND linked
    const sizes = [...layout.matchAll(/file: "(\d+x\d+)"/g)].map((m) => m[1]);
    expect(sizes.length).toBeGreaterThan(5);
    for (const size of sizes) {
      expect(gen, `${size} is not generated`).toContain(`"${size}"`);
      expect(launch, `${size} is not linked in launch.html`).toContain(`${size}.png`);
    }
  });

  it("every generated image is actually on disk, light and dark", () => {
    const sizes = [...src("app/layout.tsx").matchAll(/file: "(\d+x\d+)"/g)].map((m) => m[1]);
    for (const size of sizes) {
      for (const theme of ["light", "dark"]) {
        const f = join(ROOT, "public/splash", `${theme}-${size}.png`);
        // teeth: a missing file silently falls back to iOS's plain white default
        expect(statSync(f).size, `${theme}-${size}.png`).toBeGreaterThan(5_000);
      }
    }
  });
});

describe("the lockup is the same picture on every surface", () => {
  const launch = src("public/launch.html");
  const boot = src("features/app-shell/boot-splash.tsx");
  const gen = src("scripts/gen-splash.mjs");

  it("the wordmark is set identically in all three", () => {
    const FONT = 'italic 700 30px/1.08 Georgia,"Times New Roman","Hoefler Text",Didot,"Palatino Linotype",serif';
    for (const [name, s] of [["launch.html", launch], ["boot-splash", boot], ["gen-splash", gen]] as const) {
      expect(s, name).toContain(FONT);
      expect(s, name).toContain("linear-gradient(100deg,#3b82f6 0%,#8b5cf6 38%,#d946ef 74%,#f472b6 100%)");
    }
  });

  it("🔴 each one sets a solid colour BEFORE the gradient", () => {
    /*
      `background-clip:text` needs `text-fill-color:transparent`, and a browser
      with the latter but not the former renders INVISIBLE TEXT — on the launch
      screen, which would look exactly like the white screen all of this exists
      to prevent. The fallback must be outside the @supports.
    */
    for (const [name, s] of [["launch.html", launch], ["boot-splash", boot], ["gen-splash", gen]] as const) {
      const i = s.indexOf("letter-spacing:.004em;color:");
      expect(i, `${name} has no pre-@supports colour`).toBeGreaterThan(-1);
      expect(s.indexOf("@supports"), name).toBeGreaterThan(-1);
    }
  });
});

describe("the written reveal plays exactly where there is no image in front of it", () => {
  it("launch.html does NOT redraw in an installed launch", () => {
    /*
      The native image already shows the finished word there, so drawing it
      again is a flicker. `.fx` is display:none outside these modes, so this
      rule covers every case in which that lockup is seen at all.
    */
    expect(src("public/launch.html")).toContain(
      "@media (display-mode:standalone),(display-mode:fullscreen),(display-mode:minimal-ui){.fx__word{animation:none;-webkit-clip-path:none;clip-path:none}}",
    );
  });

  it("#frenz-boot DOES write it, and only outside installed modes", () => {
    const boot = src("features/app-shell/boot-splash.tsx");
    expect(boot).toContain("@media not all and (display-mode:standalone)");
    expect(boot).toContain("animation:frenz-boot-write");
    expect(boot).toContain("@keyframes frenz-boot-write");
  });

  it("reduced motion shows the finished word instantly, not a slower draw", () => {
    const boot = src("features/app-shell/boot-splash.tsx");
    const rm = boot.slice(boot.indexOf("@media (prefers-reduced-motion:reduce)"));
    expect(rm).toContain(".frenz-boot__word");
    expect(rm).toContain("clip-path:none");
  });
});

describe("the precached document was invalidated", () => {
  it("SWX.VERSION moved, because /launch.html is served cache-first", () => {
    /*
      `/launch.html` is in PRECACHE_DOCUMENTS. Without a bump an installed PWA
      keeps serving the copy it already has — which is exactly how the previous
      wordmark change reached production and still showed the old screen on the
      owner's phone.
    */
    const cfg = src("public/sw/config.js");
    expect(cfg).toContain('SWX.PRECACHE_DOCUMENTS = ["/launch.html"]');
    expect(cfg).toContain('SWX.VERSION = "v25"');
    expect(cfg).toContain("// v25 (2026-10-04)");
  });
});
