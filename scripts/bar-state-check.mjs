/*
  Does the docked ad bar RENDER at all, and does the page actually scroll?

  Owner, 2026-09-01: "since the previous ad slots set up, all the multi are not
  working or showing". Two probes just agreed on something worse than a styling
  bug: the scroll-away nav is dead again AND no ad bar was found — and those two
  have one shared cause, because `TopBannerAd` returns null unless a banner is
  CONFIGURED, and when it returns null the nav has nothing to publish to and
  never hides.

  So this looks at the three things that decide it, on the real page, instead of
  reasoning about them: what /api/ads/config says, whether the bar element and
  its <ins> exist, and whether the page scrolls at all (a page that cannot
  scroll produces no scroll events, and the nav's whole trigger is a scroll
  direction).
*/

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://frenzsave.com";
const PATH = process.argv[3] ?? "/tiktok-video-downloader";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
});
const page = await ctx.newPage();

const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
page.on("console", (m) => {
  if (m.type() === "error" && !/Content Security|magsrv|pemsrv/.test(m.text())) errs.push(m.text().slice(0, 200));
});

await page.goto(`${BASE}${PATH}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(6000);

const snap = (label) =>
  page.evaluate((l) => {
    const fixed = [...document.querySelectorAll("div,nav")].filter(
      (el) => getComputedStyle(el).position === "fixed" && el.getBoundingClientRect().width > window.innerWidth * 0.9,
    );
    return {
      label: l,
      scrollY: Math.round(window.scrollY),
      docH: document.documentElement.scrollHeight,
      vh: window.innerHeight,
      canScroll: document.documentElement.scrollHeight > window.innerHeight + 50,
      insCount: document.querySelectorAll("ins[data-zoneid]").length,
      insZones: [...document.querySelectorAll("ins[data-zoneid]")].map((i) => i.getAttribute("data-zoneid")),
      navH: getComputedStyle(document.documentElement).getPropertyValue("--frenz-bottomnav-h").trim(),
      adH: getComputedStyle(document.documentElement).getPropertyValue("--frenz-bottomad-h").trim(),
      fixedBars: fixed.map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          h: Math.round(r.height),
          top: Math.round(r.top),
          z: cs.zIndex,
          transform: cs.transform === "none" ? "none" : cs.transform.slice(0, 34),
          links: el.querySelectorAll("a").length,
          hasIns: !!el.querySelector("ins[data-zoneid]"),
          ariaHidden: el.getAttribute("aria-hidden"),
        };
      }),
    };
  }, label);

const cfg = await page.evaluate(() =>
  fetch("/api/ads/config")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d ? { bottomNav: d.exoclickBottomNav, history: d.exoclickHistory, landing: d.exoclickLanding } : null))
    .catch((e) => ({ error: String(e) })),
);

const before = await snap("at rest");
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(200);
}
await page.waitForTimeout(1400);
const after = await snap("after scrolling down");

console.log(`${BASE}${PATH}\n`);
console.log(`config bottomNav: ${JSON.stringify(cfg?.bottomNav)}`);
console.log(`config history  : ${JSON.stringify(cfg?.history)}`);
console.log(`config landing  : ${JSON.stringify(cfg?.landing)}\n`);
for (const s of [before, after]) {
  console.log(`${s.label}: scrollY=${s.scrollY} docH=${s.docH} vh=${s.vh} canScroll=${s.canScroll}`);
  console.log(`   --frenz-bottomnav-h=${s.navH || "(unset)"}  --frenz-bottomad-h=${s.adH || "(unset)"}`);
  console.log(`   <ins> ${s.insCount} ${s.insZones.length ? `[${s.insZones.join(", ")}]` : ""}`);
  for (const b of s.fixedBars) {
    console.log(`   bar h=${b.h} top=${b.top} z=${b.z} links=${b.links} hasIns=${b.hasIns} aria-hidden=${b.ariaHidden} transform=${b.transform}`);
  }
}
if (errs.length) {
  console.log(`\npage errors (${errs.length}):`);
  for (const e of [...new Set(errs)].slice(0, 6)) console.log(`   ${e}`);
}

await browser.close();
