/**
 * REPRODUCE the reels comment crash, rather than reason about it.
 *
 * Owner, 2026-09-01: opening comments on a reel shows "something went wrong,
 * try again". A previous session attributed this to a stale-tab ChunkLoadError
 * and shipped an auto-reload for it — and the report has not gone away, which
 * means either that was not the cause or it is not the only one.
 *
 * So this captures what actually happens, on production, in a FRESH context
 * (no stale manifest can exist), and prints every signal at once: page errors,
 * console errors, failed requests, the comments API's real status and body, and
 * whether the error boundary rendered.
 *
 *   node scripts/reels-comment-probe.mjs
 *   node scripts/reels-comment-probe.mjs https://frenzsave.com/reels
 */
import { chromium, devices } from "playwright";

const TARGET = process.argv[2] ?? "https://frenzsave.com/reels";

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();

const pageErrors = [];
const consoleErrors = [];
const failed = [];
const apiCalls = [];

page.on("pageerror", (e) => pageErrors.push(`${e.name}: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
});
page.on("requestfailed", (r) =>
  failed.push(`${r.failure()?.errorText ?? "?"}  ${r.url().slice(0, 140)}`),
);
page.on("response", async (r) => {
  const u = r.url();
  if (!/\/api\/posts\/[^/]+\/comments/.test(u)) return;
  let body = "";
  try {
    body = (await r.text()).slice(0, 500);
  } catch {
    body = "(unreadable)";
  }
  apiCalls.push(`${r.status()} ${r.request().method()} ${u.slice(-70)}\n      ${body}`);
});

console.log(`opening ${TARGET}`);
await page.goto(TARGET, { waitUntil: "load", timeout: 90_000 }).catch((e) => console.log("goto:", e.message));
await page.waitForTimeout(6000);

/* The comment control. Several shapes have shipped over time, so try them in
   order of specificity rather than assuming the current one. */
const SELECTORS = [
  'button[aria-label*="omment" i]',
  'button[title*="omment" i]',
  '[data-testid*="comment"]',
  'button:has(svg[class*="message"])',
];

let clicked = null;
for (const sel of SELECTORS) {
  const el = page.locator(sel).first();
  if ((await el.count()) === 0) continue;
  try {
    await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await el.click({ force: true, timeout: 5000 });
    clicked = sel;
    break;
  } catch {
    /* try the next shape */
  }
}
console.log("clicked:", clicked ?? "(NOTHING MATCHED — no comment control found)");
await page.waitForTimeout(6000);

const state = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    errorBoundary: /Something went wrong|That didn.t load right/i.test(text),
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    mentionsComment: /comment/i.test(text),
    heading: document.querySelector("h1,h2")?.textContent?.slice(0, 80) ?? null,
    snippet: text.slice(0, 300).replace(/\n+/g, " | "),
  };
});

console.log("\n=== RESULT ===");
console.log("error boundary visible:", state.errorBoundary);
console.log("open dialogs:", state.dialogs);
console.log("heading:", state.heading);
console.log("page text:", state.snippet);
console.log("\n--- comments API calls ---\n" + (apiCalls.join("\n") || "(none — the request was never made)"));
console.log("\n--- page errors ---\n" + (pageErrors.join("\n") || "(none)"));
console.log("\n--- console errors ---\n" + (consoleErrors.slice(0, 12).join("\n") || "(none)"));
console.log("\n--- failed requests ---\n" + (failed.slice(0, 12).join("\n") || "(none)"));

await page.screenshot({ path: "C:/Users/u/AppData/Local/Temp/navshots/reels-comment-probe.png" });
console.log("\nshot: C:/Users/u/AppData/Local/Temp/navshots/reels-comment-probe.png");
await browser.close();
