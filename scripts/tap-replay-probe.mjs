/**
 * Does the pending-tap script actually REPLAY? Mechanism only.
 *
 * dead-tap-check.mjs asks the product question ("did the app respond"), which
 * conflates the replay with whatever the form then does. This asks the narrow
 * one: was a click re-dispatched on the button after it hydrated?
 */
import { chromium, devices } from "playwright";

const URL_ = process.argv[2] ?? "http://localhost:3123/";

const PROBE = `
  window.__hydrated = (el) => !!el && Object.keys(el).some((k) => k.startsWith('__react'));
  window.__log = [];
  // Wrap .click() so a programmatic replay is distinguishable from a real press.
  const orig = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function () {
    window.__log.push({ kind: 'programmatic-click', tag: this.tagName, t: Math.round(performance.now()) });
    return orig.apply(this, arguments);
  };
  addEventListener('click', (e) => {
    const b = e.target && e.target.closest && e.target.closest('button');
    if (!b) return;
    window.__log.push({
      kind: 'click-event', t: Math.round(performance.now()),
      hydrated: window.__hydrated(b), trusted: e.isTrusted,
    });
  }, true);
`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();
const STRIP = process.env.STRIP === "1";
await page.route("**/*", async (r) => {
  const h = new URL(r.request().url()).hostname;
  if (h !== "localhost" && h !== "127.0.0.1") return r.abort();
  if (!STRIP || r.request().resourceType() !== "document") return r.continue();
  const res = await r.fetch();
  const re = new RegExp(
    "<script[^>]*>(?:(?!<\\/script>)[\\s\\S])*?data-no-tap-replay(?:(?!<\\/script>)[\\s\\S])*?<\\/script>",
    "g",
  );
  const body = (await res.text()).replace(re, "");
  return r.fulfill({ response: res, body });
});
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.emulateNetworkConditions", {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
});
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await page.addInitScript(PROBE);

const navs = [];
page.on("framenavigated", (f) => { if (f === page.mainFrame()) navs.push(f.url()); });
await page.goto(URL_, { waitUntil: "commit", timeout: 60_000 });

const SEL = 'button[type="submit"]';
const deadline = Date.now() + 30_000;
let ok = false;
while (Date.now() < deadline) {
  const s = await page
    .evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? (window.__hydrated(el) ? "hydrated" : "painted") : "absent";
    }, SEL)
    .catch(() => "absent");
  if (s === "painted") {
    ok = true;
    break;
  }
  if (s === "hydrated") break;
}
console.log("landed in dead window:", ok);
if (ok) await page.evaluate((sel)=>{const b=document.querySelector(sel); if(b) b.click();}, SEL).catch((e)=>console.log("click err",e.message));

await page.waitForTimeout(12_000);
console.log("URL after tap:", page.url());
console.log("navigations:", navs);
const log = await page.evaluate(() => window.__log);
console.log("\nevent log:");
for (const l of log) console.log("  ", JSON.stringify(l));
const replay = log.find((l) => l.kind === "programmatic-click");
console.log("\nREPLAY HAPPENED:", !!replay, replay ? `at ${replay.t}ms` : "");
await browser.close();
