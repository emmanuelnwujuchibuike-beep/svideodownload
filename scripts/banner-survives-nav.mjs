/**
 * Does the docked banner SURVIVE a client-side navigation?
 *
 * Owner, 2026-08-31: "navigating still destroys the bottom banner."
 *
 * ── The stub fills exactly ONCE, and that is the point ───────────────────────
 *
 * ExoClick caps how often a zone serves the same visitor, so the second serve
 * after a navigation is frequently declined. The previous implementation tore
 * the live creative down on every navigation (`el.textContent = ""`) and then
 * asked for a replacement it usually did not get — trading a working banner for
 * a coin flip.
 *
 * So this stub serves creative #1 and then refuses everything after it, exactly
 * like a capped zone. A passing run means the banner is still on screen after
 * navigating away and back WITHOUT a second fill. A previous-behaviour run
 * loses it on the first navigation.
 *
 * This is one of the few questions about this integration a stub can answer
 * honestly: it is about OUR teardown, not about ExoClick's markup.
 *
 *   node scripts/banner-survives-nav.mjs http://localhost:3123
 */
import { chromium, devices } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3123";
const TAG = { cls: "eas6a97888e37", zoneId: "6015590" };

const LOADER = `
(function () {
  var served = 0;
  window.__exoServes = function () { return served; };
  function serve() {
    served++;
    var found = document.querySelectorAll('ins.${TAG.cls}:not([data-processed=true])');
    for (var i = 0; i < found.length; i++) {
      var ins = found[i];
      ins.setAttribute('data-processed', 'true');
      // A CAPPED zone: only the first request ever yields a creative.
      if (served > 1) continue;
      var box = document.createElement('div');
      box.setAttribute('data-gen', String(served));
      box.innerHTML = '<img alt="ad" style="display:block;width:320px;height:64px" ' +
        'src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">';
      ins.parentElement.insertBefore(box, ins);
    }
  }
  window.AdProvider = { push: function (c) { if (c && c.serve) serve(); } };
})();
`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();

await page.route("**/*", async (r) => {
  const u = new URL(r.request().url());
  if (u.hostname === "a.magsrv.com" && u.pathname.endsWith("ad-provider.js"))
    return r.fulfill({ status: 200, contentType: "application/javascript", body: LOADER });
  if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return r.abort();
  // The service worker reloads once on a cold profile — see the dead-tap notes.
  if (u.pathname === "/sw.js") return r.fulfill({ status: 404, body: "" });
  if (u.pathname === "/api/ads/config") {
    const res = await r.fetch();
    let j = {};
    try { j = await res.json(); } catch {}
    return r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...j, exoclickBottomNav: TAG, exoclickHistory: TAG }),
    });
  }
  return r.continue();
});

async function look(label) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await page.evaluate(() => ({
        creative: document.querySelector("[data-gen]")?.getAttribute("data-gen") ?? null,
        serves: typeof window.__exoServes === "function" ? window.__exoServes() : null,
        path: location.pathname,
      }));
      const ok = r.creative !== null;
      console.log(
        `  ${label.padEnd(34)} path=${String(r.path).padEnd(10)} creative=${String(r.creative).padEnd(5)} serves=${String(r.serves).padEnd(3)} ${ok ? "✅ still showing" : "❌ GONE"}`,
      );
      return ok;
    } catch {
      await page.waitForTimeout(600);
    }
  }
  console.log(`  ${label}  <context lost>`);
  return false;
}

await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60_000 });
await page
  .waitForFunction(() => !!document.querySelector("[data-gen]"), null, { timeout: 25_000 })
  .catch(() => console.log("   (no creative on first load — the stub never filled)"));
await page.waitForTimeout(600);

const results = [];
results.push(await look("1. first load"));

// Client-side navigation away…
await page.evaluate(() => {
  const a = [...document.querySelectorAll('a[href^="/"]')].find(
    (x) => x.getAttribute("href") === "/history",
  );
  if (a) a.click();
  else location.href = "/history";
});
await page.waitForTimeout(4000);
results.push(await look("2. after navigating away"));

// …and back.
await page.goBack({ waitUntil: "commit" }).catch(() => {});
await page.waitForTimeout(4000);
results.push(await look("3. after navigating back"));

const serves = await page.evaluate(() => window.__exoServes?.() ?? 0).catch(() => 0);
console.log(
  `\nVERDICT: ${results.every(Boolean) ? "✅ the banner survived every navigation" : "❌ the banner was destroyed by a navigation"}` +
    ` (the zone filled ONCE and was asked ${serves} time(s) in total)`,
);

await browser.close();
