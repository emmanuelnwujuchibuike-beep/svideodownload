/*
  The one ExoClick unit that demonstrably RENDERS: does it reach the reader?

  Where each zone actually stands, all measured on production:

    sticky       6016708  serves, and the creative dump caught it PAINTING a real
                          `IMG 300x250` at `position: fixed; z-index: 999999`
    history      6015606  serves a real 19s video, loads it (`readyState: 4`),
                          then never adds `exo_wrapper_show`, so their own
                          `max-height: 0` holds it shut. Their gate, not ours.
    interstitial 6016704  serves, arms `.ex-over-top`, never displays it
    bottomnav    6016480  `{"zones":[null]}` — genuinely no demand

  So the sticky is the only one that can put something on screen today, and it
  mounts on the downloader's fetch-RESULT card — which no probe has ever reached,
  because every one of them has tested the landing page in its initial state.

  This drives the real flow: paste a link, fetch, wait for the result card, then
  watch the sticky slot across the 3.5s retry and past 10s. It is therefore also
  an end-to-end test of the fix that stopped us deleting live creatives.
*/

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://frenzsave.com";
const LINK = process.argv[3] ?? "https://www.tiktok.com/@tiktok/video/7106594312292453675";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  userAgent:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (/no ads|zone|placement/i.test(t) && !/Content Security/.test(t)) console.log(`    [exo] ${t.slice(0, 150)}`);
});

console.log(`${BASE}  —  fetching ${LINK}\n`);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(3000);

// Paste the link into the downloader's input and submit the way a reader would.
const input = page.locator('input[type="url"], input[type="text"]').first();
await input.waitFor({ state: "visible", timeout: 20_000 });
await input.click();
await input.fill(LINK);
await page.waitForTimeout(300);
await input.press("Enter");
console.log("submitted; waiting for the result card…");

// The result card is whatever appears with the ExoClick sticky slot in it.
const SNAP = () => {
  const inses = [...document.querySelectorAll("ins[data-zoneid]")].map((ins) => {
    const host = ins.parentElement;
    const r = host.getBoundingClientRect();
    let best = null;
    for (const el of host.querySelectorAll("*")) {
      if (el.tagName === "STYLE" || el.tagName === "SCRIPT") continue;
      const b = el.getBoundingClientRect();
      if (b.width >= 40 && b.height >= 40) {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        if (!best || b.width * b.height > best.w * best.h) {
          best = { tag: el.tagName, w: Math.round(b.width), h: Math.round(b.height), pos: cs.position, top: Math.round(b.top) };
        }
      }
    }
    return {
      zone: ins.getAttribute("data-zoneid"),
      processed: ins.getAttribute("data-processed"),
      hostH: Math.round(r.height),
      htmlLen: host.innerHTML.length,
      biggest: best,
    };
  });
  return { inses, hasResult: !!document.querySelector("video, [class*='preview'], [class*='Preview']") };
};

let sawCard = false;
for (const t of [4000, 7000, 10000, 14000, 20000]) {
  await page.waitForTimeout(t === 4000 ? 4000 : 3000 + (t === 20000 ? 3000 : 0));
  const s = await page.evaluate(SNAP);
  if (s.hasResult) sawCard = true;
  console.log(`\n  t~${t}ms  resultCard=${s.hasResult}  <ins> count=${s.inses.length}`);
  for (const i of s.inses) {
    const b = i.biggest;
    console.log(
      `    zone ${i.zone} host=${i.hostH}px html=${i.htmlLen} processed=${i.processed} biggest=${b ? `${b.tag} ${b.w}x${b.h} pos=${b.pos} top=${b.top}` : "none"}`,
    );
  }
}

const final = await page.evaluate(SNAP);
const painted = final.inses.filter((i) => i.biggest);
console.log("");
if (!sawCard) console.log("🟠 the fetch never produced a result card — the sticky slot never mounted (extraction, not ads)");
else if (painted.length) {
  for (const p of painted) console.log(`🟢 ON SCREEN: zone ${p.zone} showing ${p.biggest.tag} ${p.biggest.w}x${p.biggest.h} at top=${p.biggest.top}`);
} else console.log("🔴 result card reached, but no ExoClick unit painted anything");

await page.screenshot({ path: "scripts/.sticky-result.png", fullPage: false });
console.log("screenshot: scripts/.sticky-result.png");
await browser.close();
