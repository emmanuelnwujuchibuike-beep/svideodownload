/**
 * Does the ExoClick banner come back on a CLIENT-SIDE navigation?
 *
 * Owner, 2026-08-31: "history banner ad shows only once and doesnt show on
 * repeated entery of the history page unless the page is reloaded", and "the
 * bottom banner have same issue … mostly on signed in download pages".
 *
 * Run against the real app. Two things are stubbed, and only two:
 *
 *   • /api/ads/config — so a banner is configured without touching the live
 *     admin settings.
 *   • a.magsrv.com/ad-provider.js — replaced with a FAKE loader that reproduces
 *     the real one's contract exactly as `scripts/exoclick-loader-probe.mjs`
 *     measured it: on each AdProvider.push({serve:{}}) it selects
 *     `ins.eas…:not([data-processed=true])`, inserts its creative into a NEW DIV
 *     placed BEFORE the <ins> (never inside it), and stamps data-processed.
 *     A real fill cannot happen from localhost — the referer is unauthorised —
 *     so the fake is what makes the FILL observable. Its DOM behaviour is not
 *     invented; it is the measured behaviour.
 *
 * The component under test is unmodified and is doing all the real work.
 */
import { chromium, devices } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3123";
const TAG = { cls: "eas6a97888e37", zoneId: "6015590" };

const FAKE_LOADER = `
(function () {
  var serves = 0;
  window.__exoServes = function () { return serves; };
  function serve() {
    serves++;
    var sel = 'ins.${TAG.cls}:not([data-processed=true])';
    var found = document.querySelectorAll(sel);
    for (var i = 0; i < found.length; i++) {
      var ins = found[i];
      // Measured behaviour: a NEW div inserted BEFORE the ins, creative inside it.
      var box = document.createElement('div');
      box.setAttribute('data-fake-exo', String(serves));
      box.innerHTML = '<img alt="ad" style="display:block;width:320px;height:100px" ' +
        'src="data:image/svg+xml;utf8,' +
        encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="100"><rect width="320" height="100" fill="%23c026d3"/><text x="160" y="58" font-size="20" fill="white" text-anchor="middle">EXOCLICK ' + serves + '</text></svg>') + '">';
      ins.parentElement.insertBefore(box, ins);
      ins.setAttribute('data-processed', 'true');
    }
  }
  var q = window.AdProvider || [];
  window.AdProvider = { push: function (cmd) { if (cmd && cmd.serve) serve(); } };
  for (var j = 0; j < q.length; j++) window.AdProvider.push(q[j]);
})();
`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();

await page.route("**/*", async (r) => {
  const u = new URL(r.request().url());
  if (u.hostname === "a.magsrv.com" && u.pathname.endsWith("ad-provider.js")) {
    return r.fulfill({ status: 200, contentType: "application/javascript", body: FAKE_LOADER });
  }
  if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return r.abort();
  if (u.pathname === "/api/ads/config") {
    const res = await r.fetch();
    let json = {};
    try { json = await res.json(); } catch {}
    return r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...json, exoclickBottomNav: TAG, exoclickHistory: TAG }),
    });
  }
  return r.continue();
});

async function snapshot(label) {
  const s = await page.evaluate((cls) => {
    const ins = document.querySelector("ins." + cls);
    const host = ins ? ins.parentElement : null;
    const creative = document.querySelector("[data-fake-exo]");
    const r = creative ? creative.getBoundingClientRect() : null;
    return {
      insPresent: !!ins,
      insProcessed: ins ? ins.getAttribute("data-processed") : null,
      creativeGeneration: creative ? creative.getAttribute("data-fake-exo") : null,
      creativeInsideHost: !!(creative && host && host.contains(creative)),
      creativeBox: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
      hostChildTags: host ? [...host.children].map((n) => n.tagName) : null,
      serves: typeof window.__exoServes === "function" ? window.__exoServes() : null,
    };
  }, TAG.cls);
  console.log("\n---", label, "---");
  console.log(JSON.stringify(s, null, 2));
  return s;
}

console.log("Loading", BASE + "/");
await page.goto(BASE + "/", { waitUntil: "load", timeout: 60_000 });
// The bar is deferred two frames and the banner waits on /api/ads/config.
await page.waitForSelector(`ins.${TAG.cls}`, { timeout: 30_000 }).catch(() => console.log("!! no <ins> appeared"));
await page.waitForTimeout(2500);
const first = await snapshot("1. first load of /");

// A CLIENT-SIDE navigation to another marketing route — the bar itself is
// mounted from the marketing layout and does NOT unmount across this.
const href = await page.evaluate(() => {
  const a = [...document.querySelectorAll('a[href^="/"]')].find(
    (x) => !x.getAttribute("href").startsWith("//") && x.getAttribute("href").length > 1 && !x.getAttribute("href").includes("#"),
  );
  return a ? a.getAttribute("href") : null;
});
console.log("\nclient-side navigating to:", href);
await page.evaluate((h) => {
  const a = [...document.querySelectorAll('a[href="' + h + '"]')][0];
  a.click();
}, href);
await page.waitForTimeout(4000);
const second = await snapshot("2. after client-side nav (no reload)");

// And back again.
await page.goBack({ waitUntil: "commit" }).catch(() => {});
await page.waitForTimeout(4000);
const third = await snapshot("3. after going back");

const docReqs = [];
page.on("request", (r) => { if (r.resourceType() === "document") docReqs.push(r.url()); });

console.log("\n================ VERDICT ================");
console.log("serves after load / nav / back:", first.serves, "/", second.serves, "/", third.serves);
console.log("creative generation shown:     ", first.creativeGeneration, "/", second.creativeGeneration, "/", third.creativeGeneration);
console.log("creative inside our host:      ", first.creativeInsideHost, "/", second.creativeInsideHost, "/", third.creativeInsideHost);
const reServed = Number(second.serves) > Number(first.serves) && !!second.creativeGeneration;
console.log(reServed
  ? "✅ the banner RE-SERVED on a client-side navigation (the reported bug is fixed)"
  : "❌ no re-serve on client-side navigation — the bug is still present");

await page.screenshot({ path: "C:/Users/u/AppData/Local/Temp/navshots/exoclick-bottomnav.png", fullPage: false });
console.log("screenshot -> C:/Users/u/AppData/Local/Temp/navshots/exoclick-bottomnav.png");
await browser.close();
