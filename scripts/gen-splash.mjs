/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE iOS NATIVE LAUNCH IMAGES — generated from the real lockup
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node scripts/gen-splash.mjs
 *
 * ── 🔴 WHY THIS FILE EXISTS IN THE REPO (owner, 2026-10-04) ────────────────
 *
 * "Why do I still see this [a bare F] instead of the writing FrenzSave."
 *
 * Because `public/splash/*.png` is what iOS paints, and iOS paints it BEFORE
 * any HTML, CSS or JS of ours exists. It is a flat image: it cannot animate,
 * and no change to `launch.html` or `boot-splash.tsx` can reach it. Those PNGs
 * were generated in July as "brand background + frenz-logo.png centered" — the
 * mark alone — so the brand arrived half-finished and sat there for the whole
 * document load, which is the longest-lived screen of a cold start.
 *
 * The generator that made them lived in a scratchpad and was never committed,
 * so there was no way to regenerate them when the wordmark shipped. That is
 * the actual defect behind the screenshot, and it is why this is a script in
 * `scripts/` rather than a one-off.
 *
 * ── IT RENDERS THE SAME LOCKUP launch.html DOES ────────────────────────────
 *
 * Same mark at the same size, same italic serif wordmark with the same
 * gradient, same 26px gap, same empty track — so the native image and the
 * document that replaces it are the same picture. The handoff then changes
 * nothing visible, which is the rule `3c892c2` already set for the other two
 * surfaces.
 *
 * 🔴 The track is drawn EMPTY, and the sweeping bar is not drawn at all. A
 * frozen bar baked into an image would be a progress indicator that is not
 * reporting anything — a fabricated statistic in picture form. The empty track
 * is simply the state before the bar arrives, and it reserves the bar's space
 * so nothing shifts when `launch.html` takes over.
 *
 * ⚠️ KEEP IN STEP WITH `SPLASH_SCREENS` in `app/layout.tsx` AND the
 * `apple-touch-startup-image` list in `public/launch.html`. A size added to
 * either without being generated here silently falls back to iOS's plain white
 * default on that device.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright";

const ROOT = process.cwd();

/** CSS px + DPR per device; the file name is the resulting PIXEL size. */
const SIZES = [
  { file: "1170x2532", width: 390, height: 844, ratio: 3 },
  { file: "1179x2556", width: 393, height: 852, ratio: 3 },
  { file: "1206x2622", width: 402, height: 874, ratio: 3 },
  { file: "1284x2778", width: 428, height: 926, ratio: 3 },
  { file: "1290x2796", width: 430, height: 932, ratio: 3 },
  { file: "1320x2868", width: 440, height: 956, ratio: 3 },
  { file: "1125x2436", width: 375, height: 812, ratio: 3 },
  { file: "750x1334", width: 375, height: 667, ratio: 2 },
];

/** The two backgrounds are launch.html's own theme-color metas. */
const THEMES = {
  light: { bg: "#ffffff", fallback: "#4338ca" },
  dark: { bg: "#050816", fallback: "#a5b4fc" },
};

const markDataUri = `data:image/png;base64,${readFileSync(join(ROOT, "public/brand/frenz-logo-splash.png")).toString("base64")}`;

/*
  Every value below is copied from `public/launch.html`'s `.fx*` rules. If one
  changes there it must change here, or the native image and the document stop
  being the same picture — which is the whole bug this file fixes.
*/
const page = (theme) => `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;background:${THEMES[theme].bg}}
.fx{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px}
.fx__mark{position:relative;width:104px;height:104px;max-width:26vw;max-height:26vw;border-radius:24%;overflow:hidden}
.fx__mark img{display:block;width:100%;height:100%}
.fx__word{font:italic 700 30px/1.08 Georgia,"Times New Roman","Hoefler Text",Didot,"Palatino Linotype",serif;letter-spacing:.004em;color:${THEMES[theme].fallback}}
@supports ((-webkit-background-clip:text) or (background-clip:text)){.fx__word{background:linear-gradient(100deg,#3b82f6 0%,#8b5cf6 38%,#d946ef 74%,#f472b6 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}}
.fx__track{width:132px;height:3px;border-radius:999px;background:rgba(99,102,241,.16)}
</style></head><body>
<div class="fx">
<span class="fx__mark"><img src="${markDataUri}" alt=""></span>
<span class="fx__word">Frenz<b>Save</b></span>
<span class="fx__track"></span>
</div></body></html>`;

const browser = await chromium.launch();
let written = 0;
for (const theme of ["light", "dark"]) {
  for (const s of SIZES) {
    const ctx = await browser.newContext({
      viewport: { width: s.width, height: s.height },
      deviceScaleFactor: s.ratio,
      colorScheme: theme,
    });
    const p = await ctx.newPage();
    await p.setContent(page(theme), { waitUntil: "load" });
    // The mark is a data URI and the font is a system serif, so there is
    // nothing to wait on beyond layout — but fonts.ready is cheap insurance
    // against a first-run glyph miss.
    await p.evaluate(() => document.fonts.ready);
    const out = join(ROOT, "public/splash", `${theme}-${s.file}.png`);
    const buf = await p.screenshot({ type: "png" });
    writeFileSync(out, buf);
    await ctx.close();
    written += 1;
    console.log(`${theme}-${s.file}.png  ${(buf.length / 1024).toFixed(0)} kB`);
  }
}
await browser.close();
console.log(`\n${written} splash images written to public/splash/`);
