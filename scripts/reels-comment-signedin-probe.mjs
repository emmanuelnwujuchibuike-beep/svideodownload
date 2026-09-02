/**
 * The reels comment crash, on the branch the owner actually hits: SIGNED IN.
 *
 * A guest probe found nothing, and that is itself the clue — a guest gets
 * `canComment:false` and posts that happened to have no comments, so neither
 * the composer nor a single comment ROW was ever rendered. The owner is signed
 * in and opening reels that have comments.
 *
 *   node scripts/reels-comment-signedin-probe.mjs <email> <password> [postId]
 */
import { chromium, devices } from "playwright";

const BASE = process.env.PROBE_BASE ?? "https://frenzsave.com";
const [EMAIL, PASSWORD, POST_ID] = process.argv.slice(2);
if (!EMAIL || !PASSWORD) {
  console.log("usage: node scripts/reels-comment-signedin-probe.mjs <email> <password> [postId]");
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();

const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (e) => pageErrors.push(`${e.name}: ${e.message}`));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  // The ad networks' CSP report-only noise drowns everything else out.
  if (/Content Security Policy|adtrafficquality|doubleclick|navigator.vibrate/.test(t)) return;
  consoleErrors.push(t.slice(0, 400));
});

console.log("1. logging in…");
await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 90_000 });
await page.waitForTimeout(2500);

/* The panel offers OTP first; the password field may be behind a toggle. */
for (const label of [/password/i, /use password/i, /sign in with password/i]) {
  const t = page.getByRole("button", { name: label }).first();
  if ((await t.count()) > 0) {
    await t.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(600);
    break;
  }
}
await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL).catch(() => {});
const pw = page.locator('input[type="password"]').first();
if ((await pw.count()) === 0) {
  console.log("   no password field on /login — dumping controls:");
  console.log(await page.evaluate(() => [...document.querySelectorAll("button,input")].map((e) => `${e.tagName}:${e.type ?? ""}:${(e.textContent || e.name || "").trim().slice(0, 40)}`).join("\n")));
  await browser.close();
  process.exit(1);
}
await pw.fill(PASSWORD);
await page.locator('button[type="submit"]').first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(7000);
console.log("   url now:", page.url());

const me = await page.evaluate(async () => {
  const r = await fetch("/api/streak", { credentials: "same-origin" });
  return r.status;
});
console.log("   session check /api/streak:", me);

const target = POST_ID ? `${BASE}/reels?post=${POST_ID}` : `${BASE}/reels`;
console.log(`2. opening ${target}`);
await page.goto(target, { waitUntil: "load", timeout: 90_000 });
await page.waitForTimeout(7000);

console.log("3. clicking the comment control…");
const btn = page.locator('button[aria-label*="omment" i]').first();
console.log("   controls found:", await page.locator('button[aria-label*="omment" i]').count());
await btn.click({ force: true, timeout: 8000 }).catch((e) => console.log("   click failed:", e.message));
await page.waitForTimeout(7000);

const state = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    boundary: /Something went wrong|That didn.t load right/i.test(text),
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    snippet: text.slice(0, 400).replace(/\n+/g, " | "),
  };
});

console.log("\n=== RESULT ===");
console.log("ERROR BOUNDARY VISIBLE:", state.boundary);
console.log("dialogs:", state.dialogs);
console.log("text:", state.snippet);
console.log("\n--- page errors ---\n" + (pageErrors.join("\n") || "(none)"));
console.log("\n--- console errors (ads filtered) ---\n" + (consoleErrors.slice(0, 15).join("\n") || "(none)"));

await page.screenshot({ path: "C:/Users/u/AppData/Local/Temp/navshots/reels-comment-signedin.png", fullPage: false });
console.log("\nshot: C:/Users/u/AppData/Local/Temp/navshots/reels-comment-signedin.png");
await browser.close();
