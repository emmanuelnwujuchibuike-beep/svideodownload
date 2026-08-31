/**
 * Visual + functional smoke test for the landing page after the hydration
 * boundary work: are all the sections still there, and does the Download form
 * actually respond to a tap once hydrated?
 *
 *   node scripts/landing-smoke.mjs http://localhost:3123/ out.png
 */
import { chromium, devices } from "playwright";

const URL_ = process.argv[2] ?? "http://localhost:3123/";
const OUT = process.argv[3] ?? "landing-smoke.png";

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();
await page.route("**/*", (route) => {
  const host = new URL(route.request().url()).hostname;
  return host === "localhost" || host === "127.0.0.1" ? route.continue() : route.abort();
});

const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

await page.goto(URL_, { waitUntil: "load", timeout: 60_000 });
await page.waitForTimeout(3000);

const sections = await page.evaluate(() => {
  const text = document.body.innerText;
  const has = (s) => text.toLowerCase().includes(s.toLowerCase());
  return {
    supportedPlatforms: has("Supported platforms"),
    exploreFeatures: has("Explore Features"),
    howItWorks: has("How it works") || has("steps"),
    faq: has("FAQ") || has("Frequently"),
    footerPresent: !!document.querySelector("footer"),
    platformTiles: document.querySelectorAll('[class*="rounded-[26%]"]').length,
    images: document.querySelectorAll("img").length,
    downloadButton: !!document.querySelector('button[type="submit"]'),
    forms: document.querySelectorAll("form").length,
  };
});

// Does the form actually respond? Type a URL and confirm the app reacts
// (the detected-platform line, or the button leaving its idle state).
await page.fill('input[type="url"], input[type="text"]', "https://www.tiktok.com/@a/video/123").catch(() => {});
await page.waitForTimeout(1200);
const reacted = await page.evaluate(() => {
  const t = document.body.innerText.toLowerCase();
  return { detectedLine: t.includes("detected"), inputValue: document.querySelector("input")?.value?.slice(0, 40) };
});

await page.screenshot({ path: OUT, fullPage: false });
await browser.close();

console.log("sections:", JSON.stringify(sections, null, 2));
console.log("form reaction:", JSON.stringify(reacted));
console.log("page errors:", errors.length ? errors : "none");
console.log("screenshot:", OUT);
