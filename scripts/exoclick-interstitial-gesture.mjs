/*
  Does ExoClick's fullpage interstitial need a USER GESTURE to show?

  The creative dump found the overlay injected into our host but hidden:

      DIV.ex-over-top 0x0 pos=fixed disp=none z=2147483647
        DIV.ex-over-front / .ex-over-btn-container / .ex-over-inner-container

  `display: none` is not a no-fill — the markup is there, styled, with the
  maximum possible z-index. It is ARMED and waiting for its moment. Our
  integration waits 6s, sees nothing painted, calls `host.remove()`, and deletes
  it — then falls through to the VAST video, which is exactly the owner's report:
  "the main interstitial ad doesnt show, rather is the video i used as
  interstilla before that i already removed".

  This decides the fix rather than guessing at it: arm the zone, then TAP, and
  watch whether the overlay becomes visible. If a gesture is what it wants, the
  integration has to ARM EARLY and let their script pick the moment — not ask for
  it at the instant we want to show one and delete it when it does not appear.
*/

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://frenzsave.com";
const cfg = await (await fetch(`${BASE}/api/ads/config`)).json();
const tag = cfg.exoclickInterstitial;
if (!tag) {
  console.log("No interstitial configured on production.");
  process.exit(0);
}
console.log(`interstitial zone ${tag.zoneId} cls ${tag.cls} src ${tag.src}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  userAgent:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(2500);

await page.evaluate(
  async ({ cls, zoneId, src }) => {
    const host = document.createElement("div");
    host.id = "__probe_host";
    host.style.width = "100%";
    document.body.appendChild(host);
    const ins = document.createElement("ins");
    ins.className = cls;
    ins.setAttribute("data-zoneid", zoneId);
    host.appendChild(ins);
    await new Promise((resolve) => {
      const el = document.createElement("script");
      el.async = true;
      el.src = src;
      el.onload = () => resolve(true);
      el.onerror = () => resolve(false);
      document.head.appendChild(el);
    });
    try {
      (window.AdProvider = window.AdProvider ?? []).push({ serve: {} });
    } catch {
      /* the push is the ask */
    }
  },
  { cls: tag.cls, zoneId: tag.zoneId, src: tag.src },
);

const state = () =>
  page.evaluate(() => {
    const o = document.querySelector(".ex-over-top");
    if (!o) return { present: false };
    const cs = getComputedStyle(o);
    const r = o.getBoundingClientRect();
    return {
      present: true,
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      w: Math.round(r.width),
      h: Math.round(r.height),
      // Did it move itself out of our host and onto <body>?
      parent: o.parentElement?.id || o.parentElement?.tagName,
      inner: o.innerHTML.length,
    };
  });

await page.waitForTimeout(6000);
console.log(`\nAFTER 6s ARMED, NO GESTURE:\n  ${JSON.stringify(await state())}`);

// A real tap, in the middle of the page.
await page.touchscreen.tap(206, 500);
await page.waitForTimeout(2500);
console.log(`\nAFTER TAP #1:\n  ${JSON.stringify(await state())}`);

await page.touchscreen.tap(206, 400);
await page.waitForTimeout(2500);
console.log(`\nAFTER TAP #2:\n  ${JSON.stringify(await state())}`);

// Scroll, in case it is scroll-triggered rather than tap-triggered.
await page.mouse.wheel(0, 1200);
await page.waitForTimeout(3000);
console.log(`\nAFTER SCROLL:\n  ${JSON.stringify(await state())}`);

await browser.close();
