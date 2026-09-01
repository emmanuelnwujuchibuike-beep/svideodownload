/*
  The sticky unit is in the JSX for the result card but never reaches the DOM.

  The end-to-end run proved the card renders — "Detected TikTok", a PreviewCard,
  and our own FetchedAd all painted — while the only `ins[data-zoneid]` on the
  page was the bottom-nav zone. So `ExoClickSticky` returned `null` for the
  sticky slot on a page where the SAME component, same hooks, returned an element
  for the bottom-nav slot.

  `return null` has exactly four causes:

      if (!mounted || !ready || !showAds || !tag) return null;

  `mounted`, `ready` and `showAds` are shared with the bottom-nav instance, which
  rendered — so they are true. That leaves `tag`, which comes from
  `/api/ads/config` -> `d.exoclickSticky`. Production serves that key, so this
  reads it the way the component does and reports which of the four is actually
  false, instead of me reasoning about it a fourth time.
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
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(2500);

const input = page.locator('input[type="url"], input[type="text"]').first();
await input.waitFor({ state: "visible", timeout: 20_000 });
await input.click();
await input.fill(LINK);
await input.press("Enter");
await page.waitForTimeout(12_000);

const out = await page.evaluate(async () => {
  const cfg = await fetch("/api/ads/config").then((r) => (r.ok ? r.json() : null)).catch(() => null);

  // Our host is an empty <div> whose only child is the <ins>, or a div the
  // loader has filled. Find every <ins> and every plausible empty host.
  const inses = [...document.querySelectorAll("ins[data-zoneid]")].map((i) => ({
    zone: i.getAttribute("data-zoneid"),
    cls: i.className,
    parentCls: i.parentElement?.className || "(none)",
  }));

  // Where the sticky SHOULD be: the wrapper `mb-3` immediately before FetchedAd.
  const mb3 = [...document.querySelectorAll("div.mb-3")].map((d) => ({
    childCount: d.childElementCount,
    html: d.innerHTML.slice(0, 80),
  }));

  return {
    configKeys: cfg ? Object.keys(cfg) : null,
    exoclickSticky: cfg?.exoclickSticky ?? null,
    exoclickBottomNav: cfg?.exoclickBottomNav ?? null,
    inses,
    mb3,
    hasPreviewCard: !!document.querySelector("[class*='scroll-mt-24']"),
  };
});

console.log(JSON.stringify(out, null, 2));

const stickyPresent = out.inses.some((i) => i.zone === String(out.exoclickSticky?.zoneId));
console.log("");
if (!out.exoclickSticky) console.log("🔴 /api/ads/config returned NO exoclickSticky — the component correctly renders nothing");
else if (stickyPresent) console.log(`🟢 sticky <ins> present for zone ${out.exoclickSticky.zoneId}`);
else console.log(`🔴 config HAS exoclickSticky (zone ${out.exoclickSticky.zoneId}) but no <ins> for it is in the DOM`);

await browser.close();
