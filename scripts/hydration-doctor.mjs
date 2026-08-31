/**
 * Why is a page not hydrating? Prints console errors, page errors, failed
 * requests, and when the primary button gets a React fiber.
 *
 *   node scripts/hydration-doctor.mjs http://localhost:3124/
 */
import { chromium, devices } from "playwright";

const URL_ = process.argv[2] ?? "http://localhost:3123/";
const THROTTLE = process.env.THROTTLE !== "0";

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();

// BLOCK_THIRD_PARTY=1 removes live ad networks from the picture, the same way
// scripts/interaction-ab.mjs does — an ad that navigates the page away looks
// exactly like a page that never hydrated.
if (process.env.BLOCK_THIRD_PARTY === "1") {
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "localhost" || host === "127.0.0.1" ? route.continue() : route.abort();
  });
}

if (THROTTLE) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}

const t0 = Date.now();
page.on("console", (m) => {
  if (["error", "warning"].includes(m.type())) {
    console.log(`[${Date.now() - t0}ms] console.${m.type()}: ${m.text().slice(0, 300)}`);
  }
});
page.on("pageerror", (e) => console.log(`[${Date.now() - t0}ms] PAGEERROR: ${String(e).slice(0, 400)}`));
page.on("requestfailed", (r) =>
  console.log(`[${Date.now() - t0}ms] REQFAIL: ${r.url().slice(-90)} ${r.failure()?.errorText ?? ""}`),
);
page.on("response", (r) => {
  if (r.status() >= 400) console.log(`[${Date.now() - t0}ms] HTTP ${r.status()}: ${r.url().slice(-90)}`);
});

await page.goto(URL_, { waitUntil: "commit", timeout: 60_000 });

let live = null;
const deadline = Date.now() + 30_000;
while (Date.now() < deadline && live === null) {
  const ok = await page
    .evaluate(() => {
      const el = document.querySelector('button[type="submit"], form button');
      return !!el && Object.keys(el).some((k) => k.startsWith("__react"));
    })
    .catch(() => false);
  if (ok) live = Date.now() - t0;
  else await page.waitForTimeout(100);
}

const diag = await page.evaluate(() => {
  const el = document.querySelector('button[type="submit"], form button');
  const root = document.getElementById("__next") ?? document.body.firstElementChild;
  return {
    buttonFound: !!el,
    buttonText: el?.textContent?.trim().slice(0, 40) ?? null,
    buttonKeys: el ? Object.keys(el).slice(0, 8) : [],
    anyFiberOnPage: [...document.querySelectorAll("div,button,form,section")]
      .slice(0, 400)
      .some((n) => Object.keys(n).some((k) => k.startsWith("__react"))),
    rootKeys: root ? Object.keys(root).filter((k) => k.startsWith("__react")).slice(0, 4) : [],
    nextDataPresent: typeof window.__next_f !== "undefined",
    flightChunks: Array.isArray(window.__next_f) ? window.__next_f.length : null,
  };
});

console.log("\n--- diagnosis ---");
console.log(`button interactive at: ${live ?? "NEVER (30s)"}`);
console.log(JSON.stringify(diag, null, 2));

await browser.close();
