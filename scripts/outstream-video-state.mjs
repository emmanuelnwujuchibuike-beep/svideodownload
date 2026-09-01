/*
  The outstream <video> exists at 412x0. WHY does the player never start?

  Established by measurement, so none of this is guesswork any more:
    • the zone SERVES — `{"idzone":6015606,"type":"outstream_video", …}`;
    • 15926 bytes of real player markup land in our host;
    • a `<video>` element is created, 412 wide;
    • it stays 0 TALL for at least 14 seconds;
    • and `min-height` on the container makes NO difference (A/B measured), so
      the "the player had nothing to initialise in" story is wrong, and so is the
      `minHeight: 180` that was added and reverted on the strength of it.

  Width but no height means the player was constructed and then never got a
  video to size itself to. So look at the element itself: its source, its
  readyState, its error, whether the media request was even made and what came
  back. Plus the computed style on the wrapper, in case the height is being
  pinned to 0 by their own CSS rather than by the media failing.
*/

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://frenzsave.com";
const cfg = await (await fetch(`${BASE}/api/ads/config`)).json();
const tag = cfg.exoclickHistory;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  userAgent:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();

const media = [];
page.on("response", (r) => {
  const u = r.url();
  if (/\.(mp4|webm|m3u8|ts)(\?|$)/i.test(u) || /video/i.test(r.headers()["content-type"] ?? "")) {
    media.push(`${r.status()} ${(r.headers()["content-type"] ?? "?").slice(0, 30)} ${u.slice(0, 110)}`);
  }
});
page.on("requestfailed", (r) => {
  const u = r.url();
  if (/\.(mp4|webm|m3u8)(\?|$)/i.test(u) || /magsrv|bkcdn/.test(u)) {
    media.push(`FAILED ${u.slice(0, 110)} :: ${r.failure()?.errorText}`);
  }
});
const errs = [];
page.on("console", (m) => {
  if (m.type() === "error" && !/Content Security/.test(m.text())) errs.push(m.text().slice(0, 200));
});
page.on("pageerror", (e) => errs.push(`pageerror: ${String(e).slice(0, 200)}`));

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(2000);

await page.evaluate(
  async ({ cls, zoneId, src }) => {
    const host = document.createElement("div");
    host.id = "__vs";
    host.style.width = "100%";
    document.body.insertBefore(host, document.body.firstChild);
    window.scrollTo(0, 0);
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

await page.waitForTimeout(9000);

/*
  🔴 DOES A REAL SCROLL ROLL IT OUT?

  The player is loaded (`readyState: 4`) and held shut by `max-height: 0` on
  their own `_effect` div. Outstream units start on VIEWABILITY, which is
  normally an IntersectionObserver or a scroll handler — and neither has ever
  fired in these probes, because nothing has scrolled. That also makes this the
  one difference between the probe and the owner, who definitely scrolls.

  If viewability is the trigger it is also a DEADLOCK: a slot with zero height
  has zero intersection, so it can never become viewable, so it never opens, so
  it keeps zero height.
*/
const measure = () =>
  page.evaluate(() => {
    const host = document.getElementById("__vs");
    const v = host?.querySelector("video");
    const eff = host?.querySelector("[class*='_effect']");
    return {
      hostH: Math.round(host?.getBoundingClientRect().height ?? -1),
      videoH: v ? Math.round(v.getBoundingClientRect().height) : -1,
      paused: v?.paused ?? null,
      effectMaxH: eff ? getComputedStyle(eff).maxHeight : "n/a",
    };
  });

console.log(`before scroll : ${JSON.stringify(await measure())}`);
for (let i = 0; i < 5; i++) {
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(400);
}
await page.waitForTimeout(2500);
console.log(`after scroll  : ${JSON.stringify(await measure())}`);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(3000);
console.log(`back at top   : ${JSON.stringify(await measure())}\n`);

const state = await page.evaluate(() => {
  const host = document.getElementById("__vs");
  const v = host?.querySelector("video");
  const wrap = host?.querySelector("[class*='exo_wrapper']");
  const eff = host?.querySelector("[class*='_effect']");
  const box = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      rect: `${Math.round(r.width)}x${Math.round(r.height)}`,
      height: cs.height,
      minHeight: cs.minHeight,
      maxHeight: cs.maxHeight,
      paddingBottom: cs.paddingBottom,
      display: cs.display,
      position: cs.position,
      overflow: cs.overflow,
      aspectRatio: cs.aspectRatio,
    };
  };
  return {
    video: v
      ? {
          src: (v.currentSrc || v.src || "(none)").slice(0, 120),
          sources: [...v.querySelectorAll("source")].map((s) => s.src.slice(0, 120)),
          readyState: v.readyState,
          networkState: v.networkState,
          error: v.error ? `code ${v.error.code}: ${v.error.message}` : null,
          paused: v.paused,
          muted: v.muted,
          autoplay: v.autoplay,
          videoWidth: v.videoWidth,
          videoHeight: v.videoHeight,
          duration: v.duration,
          attrHeight: v.getAttribute("height"),
          style: box(v),
        }
      : null,
    exo_wrapper: box(wrap),
    effect: box(eff),
    hostHTMLSample: host?.innerHTML.slice(0, 300),
  };
});

console.log(JSON.stringify(state, null, 2));
console.log(`\n--- media requests (${media.length}) ---`);
for (const m of media.slice(0, 12)) console.log(`  ${m}`);
console.log(`--- page errors (${errs.length}) ---`);
for (const e of [...new Set(errs)].slice(0, 10)) console.log(`  ${e}`);

await browser.close();
