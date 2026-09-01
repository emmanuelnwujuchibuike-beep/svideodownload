/*
  Walk a page top to bottom and report every ExoClick placeholder that appears.

  The lazy slots only mount as they approach the viewport, so a probe that stops
  scrolling after a screen or two cannot tell "the slot is missing" from "the
  slot is further down the page" — and reporting the first as the second is how
  a working placement gets rewritten. This scrolls the whole document and
  records WHERE each <ins> appears and whether anything paints in it.
*/

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://frenzsave.com";
const PATH = process.argv[3] ?? "/";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
});
const page = await ctx.newPage();
await page.goto(`${BASE}${PATH}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(4000);

const seen = new Map();
const docH = await page.evaluate(() => document.documentElement.scrollHeight);
console.log(`${BASE}${PATH} — document ${docH}px\n`);

for (let y = 0; y <= docH; y += 600) {
  await page.evaluate((to) => window.scrollTo(0, to), y);
  await page.waitForTimeout(600);
  const found = await page.evaluate(() =>
    [...document.querySelectorAll("ins[data-zoneid]")].map((ins) => {
      const host = ins.parentElement;
      const r = host.getBoundingClientRect();
      let painted = 0;
      for (const el of host.querySelectorAll("*")) {
        const b = el.getBoundingClientRect();
        if (b.width >= 40 && b.height >= 40) painted++;
      }
      return {
        zone: ins.getAttribute("data-zoneid"),
        processed: ins.getAttribute("data-processed"),
        hostH: Math.round(r.height),
        docY: Math.round(r.top + window.scrollY),
        html: host.innerHTML.length,
        painted,
      };
    }),
  );
  for (const f of found) {
    const prev = seen.get(f.zone);
    // Keep the best observation — the one where it actually had content.
    if (!prev || f.html > prev.html) seen.set(f.zone, f);
  }
}

if (seen.size === 0) {
  console.log("🔴 no ExoClick <ins> appeared anywhere on this page");
} else {
  for (const [zone, f] of seen) {
    const verdict = f.painted > 0 ? "🟢 PAINTED" : f.processed ? "🟠 asked, empty" : "🟠 not processed";
    console.log(`  zone ${zone} at y=${f.docY}  host=${f.hostH}px html=${f.html} painted=${f.painted}  ${verdict}`);
  }
}

await browser.close();
