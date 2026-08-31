/**
 * Does the ExoClick FULLPAGE INTERSTITIAL actually fire?
 *
 * Owner, 2026-08-31: "you did not do the main exoclick interstitial ad zone,
 * cause is not showing anything." It WAS built — settings key, admin field,
 * config route, call site — and still could not run, because the call sat below
 * the VAST interstitial's master switch, which defaults to OFF and which the
 * owner had turned off precisely because they were removing that video.
 *
 * A wiring bug, invisible from the code unless you follow the whole chain. So
 * this drives the chain end to end:
 *
 *     back-swipe (popstate) → triggers.tsx → requestVastInterstitial("ambient")
 *       → showExoClickInterstitial() → <ins> + AdProvider.push({serve:{}})
 *
 * The BACK-SWIPE moment is used rather than idle because it is instant; idle is
 * a 45-second timer and tests nothing extra.
 *
 * Two things are stubbed and only two: `/api/ads/config`, so a tag is
 * configured without touching live settings, and the provider script, because a
 * real fill needs an authorised referer and localhost never gets one. The stub
 * reproduces the loader's MEASURED contract (see exoclick-loader-probe.mjs).
 *
 *   node scripts/exoclick-interstitial-check.mjs http://localhost:3123
 */
import { chromium, devices } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3123";
/** The owner's actual tag: fullpage interstitial, served from pemsrv. */
const TAG = { cls: "eas6a97888e33", zoneId: "6016704", src: "https://a.pemsrv.com/ad-provider.js" };

const LOADER = `
(function () {
  window.__exoServed = 0;
  window.AdProvider = {
    push: function (cmd) {
      if (!cmd || !cmd.serve) return;
      window.__exoServed++;
      var found = document.querySelectorAll('ins.${TAG.cls}:not([data-processed=true])');
      for (var i = 0; i < found.length; i++) {
        var ins = found[i];
        ins.setAttribute('data-processed', 'true');
        // Measured contract: a NEW div inserted BEFORE the <ins>. A fullpage
        // unit then positions itself over the page.
        var box = document.createElement('div');
        box.setAttribute('data-fullpage-ad', '1');
        box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;font:600 20px system-ui';
        box.textContent = 'EXOCLICK FULLPAGE INTERSTITIAL';
        ins.parentElement.insertBefore(box, ins);
      }
    },
  };
})();
`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();

const beacons = [];
await page.route("**/*", async (r) => {
  const u = new URL(r.request().url());
  if (u.hostname === "a.pemsrv.com" && u.pathname.endsWith("ad-provider.js"))
    return r.fulfill({ status: 200, contentType: "application/javascript", body: LOADER });
  if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return r.abort();
  if (u.pathname === "/sw.js") return r.fulfill({ status: 404, body: "" });
  if (u.pathname === "/api/track") {
    try {
      const b = JSON.parse(r.request().postData() ?? "{}");
      if (b.kind === "banner") beacons.push(`${b.slot}:${b.filled ? "filled" : "empty"}`);
    } catch {}
    return r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  }
  if (u.pathname === "/api/ads/config") {
    const res = await r.fetch();
    let j = {};
    try { j = await res.json(); } catch {}
    // The tag is configured. The VAST interstitial master switch is left at
    // whatever the real settings say — the point is that it must not matter.
    return r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...j, exoclickInterstitial: TAG }),
    });
  }
  return r.continue();
});

await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60_000 });
await page.waitForTimeout(2500);

/*
  🔴 A CLIENT-SIDE navigation, then back.

  Two `page.goto` calls followed by `goBack` are three FULL document loads, so
  the back lands in a brand-new document and `popstate` never fires in the one
  that registered the listener. The trigger looks broken when it is not — which
  is exactly what this script reported the first time it ran.
*/
await page.evaluate(() => {
  const link = [...document.querySelectorAll("a[href]")].find(
    (a) => a.getAttribute("href") === "/history",
  );
  if (link) link.click();
  else history.pushState({}, "", "/history");
});
await page.waitForTimeout(2500);
console.log("going back (the back-swipe moment)…");
await page.evaluate(() => history.back());

// The trigger fires on popstate, then dynamic-imports the request module.
let shown = false;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(400);
  shown = await page
    .evaluate(() => !!document.querySelector("[data-fullpage-ad]"))
    .catch(() => false);
  if (shown) break;
}

const served = await page.evaluate(() => window.__exoServed ?? 0).catch(() => 0);
console.log(`\n  serve pushes: ${served}`);
console.log(`  beacons:      ${beacons.length ? beacons.join(", ") : "none"}`);
console.log(`  takeover on screen: ${shown}`);
console.log(
  shown
    ? "\n✅ the ExoClick fullpage interstitial fired on back-swipe"
    : "\n❌ nothing rendered — the chain is broken somewhere between popstate and the <ins>",
);

await browser.close();
