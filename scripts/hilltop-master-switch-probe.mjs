/**
 * WITH THE MASTER SWITCH OFF, DOES THE LANDING STILL RENDER A HILLTOP SLOT?
 *
 * Owner, 2026-09-03: "i turned off hiltop main switch but i still see the
 * landing video slider."
 *
 * `/api/ads/config` already reports `hilltop.enabled:false` and nulls every tag,
 * so this asks the only question left: in a browser with NO cache, does anything
 * Hilltop-shaped reach the page? A clean context here vs. what the owner sees on
 * their device separates "the gate is broken" from "their browser is holding a
 * stale config".
 *
 * 🔴 PRODUCTION ONLY.  node scripts/hilltop-master-switch-probe.mjs
 */
import { chromium, devices } from "playwright";

const BASE = process.env.PROBE_BASE ?? "https://frenzsave.com";
const PATHS = (process.env.PROBE_PATHS ?? "/,/history").split(",");

const browser = await chromium.launch();

for (const path of PATHS) {
  // A brand-new context every time: no HTTP cache, no storage, no service worker.
  const ctx = await browser.newContext({ ...devices["Pixel 7"], serviceWorkers: "block" });
  const page = await ctx.newPage();

  const adHosts = [];
  page.on("request", (r) => {
    const u = r.url();
    if (/hilltop|hlt|videoslider|dcbc7|acscdn|cdn-jsdelivr-ads/i.test(u)) adHosts.push(u.slice(0, 120));
  });

  let cfg = null;
  page.on("response", async (r) => {
    if (r.url().includes("/api/ads/config")) {
      try {
        const j = await r.json();
        cfg = {
          enabled: j?.hilltop?.enabled,
          slotSource: j?.hilltopSlotSource,
          videoSlider: j?.hilltopVideoSlider,
          banners: Object.keys(j?.hilltopBanners ?? {}),
          cacheHeader: r.headers()["cache-control"] ?? null,
          age: r.headers()["age"] ?? null,
        };
      } catch { /* not json */ }
    }
  });

  console.log(`\n═══ ${BASE}${path} (cold context) ═══`);
  await page.goto(BASE + path, { waitUntil: "load", timeout: 90_000 }).catch(() => console.log("  (load timed out)"));
  for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 800); await page.waitForTimeout(350); }
  await page.waitForTimeout(9000);

  console.log(`  /api/ads/config → ${JSON.stringify(cfg)}`);

  const dom = await page.evaluate(() =>
    [...document.querySelectorAll('[id^="hilltop-"], iframe[title="Advertisement"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.id || null,
        tag: el.tagName.toLowerCase(),
        box: `${Math.round(r.width)}x${Math.round(r.height)}`,
        hasChildren: el.children.length,
        html: el.outerHTML.slice(0, 180),
      };
    }),
  );
  console.log(`  Hilltop containers / ad iframes in the DOM: ${dom.length}`);
  for (const d of dom) console.log(`    <${d.tag}> id=${d.id} ${d.box} children=${d.hasChildren} ${d.html.replace(/\s+/g, " ")}`);
  console.log(`  requests to Hilltop-looking hosts: ${adHosts.length}`);
  for (const u of adHosts.slice(0, 8)) console.log(`    ${u}`);

  await ctx.close();
}

await browser.close();
