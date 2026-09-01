/*
  Are the bottom NAV and the docked AD BAR ever visible at the same time?

  Owner, 2026-09-01: "the exoclick bottom banner shows a bit when the nav is
  showing, and when the banner is showing the bottom nav shows halfly … anyone
  that is showing should hide the other completely".

  🔴 THIS IS A CHECK THAT DOES NOT NEED AN AD TO FILL. Both bars are our own
  elements moved by our own CSS, so their geometry is fully measurable whatever
  the network does — unlike every fill probe in this folder, which can only ever
  say "inconclusive" once the zones are frequency-capped.

  It measures the VISIBLE BAND of each bar (the part actually inside the
  viewport) after settling in each scroll direction, and reports any overlap —
  the sliver of nav peeking above a short banner, or the strip of banner still
  showing under a restored nav.
*/

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://frenzsave.com";
const PAGES = ["/", "/history", "/tiktok-video-downloader"];

const READ = () => {
  const vh = window.innerHeight;
  /** How much of an element is actually inside the viewport, in px. */
  const band = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const top = Math.max(r.top, 0);
    const bottom = Math.min(r.bottom, vh);
    const cs = getComputedStyle(el);
    const hidden = cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0";
    return {
      visible: hidden ? 0 : Math.max(0, Math.round(bottom - top)),
      height: Math.round(r.height),
      top: Math.round(r.top),
      z: cs.zIndex,
    };
  };

  // The nav is the fixed bottom bar containing the tab links.
  const fixedBars = [...document.querySelectorAll("div,nav")].filter((el) => {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed") return false;
    const r = el.getBoundingClientRect();
    return r.width > window.innerWidth * 0.9 && r.height > 8 && r.height < 200;
  });
  const nav = fixedBars.find((el) => el.querySelectorAll("a").length >= 3) ?? null;
  // The ad bar is the other full-width fixed bottom bar — it holds an <ins> or
  // an ad slot, and never tab links.
  const bar =
    fixedBars.find((el) => el !== nav && (el.querySelector("ins[data-zoneid]") || el.querySelector("[data-ad-zone]"))) ??
    fixedBars.find((el) => el !== nav && el.getAttribute("aria-hidden") !== null) ??
    null;

  return { vh, nav: band(nav), bar: band(bar) };
};

const browser = await chromium.launch();
let bad = 0;

for (const path of PAGES) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  console.log(`\n${"=".repeat(70)}\n${BASE}${path}\n${"=".repeat(70)}`);
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } catch (e) {
    console.log(`  NAV FAILED: ${e.message}`);
    await ctx.close();
    continue;
  }
  await page.waitForTimeout(4000);

  const report = async (label) => {
    // Settle well past the 300ms transition so this measures a RESTING state,
    // never the crossfade — a transient overlap mid-slide is the animation.
    await page.waitForTimeout(1400);
    const s = await page.evaluate(READ);
    const n = s.nav ? `${s.nav.visible}px visible (h=${s.nav.height} top=${s.nav.top} z=${s.nav.z})` : "not found";
    const b = s.bar ? `${s.bar.visible}px visible (h=${s.bar.height} top=${s.bar.top} z=${s.bar.z})` : "not found";
    const both = (s.nav?.visible ?? 0) > 1 && (s.bar?.visible ?? 0) > 1;
    if (both) bad++;
    console.log(`  ${label}\n    nav: ${n}\n    bar: ${b}\n    ${both ? "🔴 BOTH VISIBLE AT REST" : "🟢 only one on screen"}`);
  };

  await report("at rest, top of page:");
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(180);
  }
  await report("after scrolling DOWN:");
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(180);
  }
  await report("after scrolling UP:");
  await ctx.close();
}

await browser.close();
console.log(`\n${bad ? `🔴 ${bad} resting state(s) showed both bars` : "🟢 never both at rest"}`);
