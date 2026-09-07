/**
 * DOES THE FIRST SW-CONTROLLED LOAD COME BACK UNSTYLED?
 *
 * Owner, 2026-09-07, with a screenshot of the landing rendered with no CSS at
 * all: "when i open the website on broswer it first shows this like is a cache
 * or device cache and untill i refresh thats when it then shows the main page."
 *
 * A raw image at natural size with unstyled text below it is a stylesheet that
 * did not apply. First load broken + refresh fixes it is the signature of
 * something served from a cache, so this reproduces the sequence a returning
 * visitor actually performs:
 *
 *   1. visit  — the service worker installs (it does NOT control this load)
 *   2. wait   — until it is activated and controlling
 *   3. visit  — the first SW-CONTROLLED navigation, which is the one reported
 *   4. reload — the refresh that is said to fix it
 *
 * Reports, per step: how many stylesheets the document accepted, how many rules
 * they carry (a sheet that 404s still appears in `styleSheets` with zero), and
 * whether the body actually has the app's own background.
 *
 * 🔴 PRODUCTION ONLY.  node scripts/unstyled-first-load-probe.mjs
 */
import { chromium, devices } from "playwright";

const BASE = process.env.PROBE_BASE ?? "https://frenzsave.com";
const PATH = process.env.PROBE_PATH ?? "/";

const browser = await chromium.launch();
// A persistent-ish context: service workers are allowed, and state carries
// between the navigations below the way it does for a returning visitor.
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();

const cssFailures = [];
page.on("response", (r) => {
  if (/\.css(\?|$)/.test(r.url()) && r.status() >= 400) cssFailures.push(`${r.status()} ${r.url().slice(0, 110)}`);
});

const report = async (label) => {
  const s = await page.evaluate(() => {
    let sheets = 0;
    let rules = 0;
    for (const sh of Array.from(document.styleSheets)) {
      sheets += 1;
      try {
        rules += sh.cssRules?.length ?? 0;
      } catch {
        /* cross-origin sheet — cannot count, not our concern */
      }
    }
    const body = getComputedStyle(document.body);
    return {
      sheets,
      rules,
      bodyBg: body.backgroundColor,
      // The landing's H1 is heavily styled; unstyled it falls back to the UA size.
      controlled: !!navigator.serviceWorker?.controller,
    };
  });
  const bad = s.rules === 0;
  console.log(
    `  ${label.padEnd(34)} sheets=${String(s.sheets).padStart(2)} rules=${String(s.rules).padStart(5)} ` +
      `bodyBg=${s.bodyBg.padEnd(22)} swControlled=${s.controlled}${bad ? "   <-- UNSTYLED" : ""}`,
  );
};

console.log(`═══ ${BASE}${PATH} ═══`);

await page.goto(BASE + PATH, { waitUntil: "load", timeout: 90_000 }).catch(() => {});
await report("1. first visit (SW installing)");

// Wait for the worker to take control.
await page.waitForTimeout(6000);
await page.evaluate(() => navigator.serviceWorker?.ready).catch(() => {});
await page.waitForTimeout(2000);

await page.goto(BASE + PATH, { waitUntil: "load", timeout: 90_000 }).catch(() => {});
await report("2. SW-CONTROLLED navigation");

await page.reload({ waitUntil: "load", timeout: 90_000 }).catch(() => {});
await report("3. after a refresh");

console.log(`\n  CSS responses that failed: ${cssFailures.length}`);
for (const f of cssFailures) console.log(`    ${f}`);

await ctx.close();
await browser.close();
