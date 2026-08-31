/**
 * What ExoClick's `ad-provider.js` REALLY does with an `<ins>` placeholder.
 *
 * Written because two ad bugs were being argued from reading minified source,
 * and the standing hypothesis turned out to be wrong. This drives the LIVE
 * loader in a real browser and answers three questions:
 *
 *   Q1  When the loader processes an `<ins>`, where does the creative go —
 *       INSIDE the `<ins>` (what features/monetization/exoclick-sticky.tsx used
 *       to assume) or somewhere else?
 *
 *   Q2  After a React-style UNMOUNT + REMOUNT, does a second
 *       `AdProvider.push({serve:{}})` pick up the new `<ins>`, or does the
 *       loader only ever fill placeholders it saw at its own initialisation?
 *       (The 2026-08-31 handoff assumed the latter, which would have made the
 *       "shows once, needs a reload" bug unfixable in the client.)
 *
 *   Q3  With the HOST element persisting and only its contents rebuilt — the
 *       bottom-nav bar's lifecycle, since it is mounted from a bar that
 *       survives client-side navigation — does a re-serve still happen?
 *
 * Run it with no site and no credentials:
 *
 *     node scripts/exoclick-loader-probe.mjs
 *
 * NOTE ON FILL: the harness is served from 127.0.0.1, so the referer is not an
 * authorised domain and the response is always `no ads to display`. That is
 * fine and deliberate — every question above is about the loader's DOM
 * MECHANICS, which run identically either way. It is not a fill test.
 */
import http from "node:http";
import { chromium } from "playwright";

/** Defaults are the history outstream tag (parses to eas6a97888e37 / 6015590). */
const CLS = process.env.EXO_CLS || "eas6a97888e37";
const ZONE = process.env.EXO_ZONE || "6015590";

const html = `<!doctype html><html><head><meta charset="utf-8"><title>exoclick loader probe</title></head>
<body><h1>probe</h1><div id="host"></div>
<script>
/* Mirrors exoclick-sticky.tsx: React owns an empty HOST, the <ins> is built
   imperatively inside it, and the fill watcher observes the HOST subtree. */
window.__obsFired = false;
window.buildIns = function () {
  const host = document.getElementById("host");
  host.textContent = "";
  const ins = document.createElement("ins");
  ins.className = ${JSON.stringify(CLS)};
  ins.setAttribute("data-zoneid", ${JSON.stringify(ZONE)});
  ins.style.display = "block";
  ins.style.width = "100%";
  host.appendChild(ins);
  window.__ins = ins;
  /* The OLD detection: watch the <ins> itself for children. */
  window.__obsFired = false;
  new MutationObserver(() => { if (ins.childElementCount > 0) window.__obsFired = true; })
    .observe(ins, { childList: true });
  return true;
};
window.dropHost = function () { document.getElementById("host").textContent = ""; };
window.serve = function () {
  try { (window.AdProvider = window.AdProvider || []).push({ serve: {} }); return "pushed"; }
  catch (e) { return "threw: " + e.message; }
};
window.snapshot = function (label) {
  const host = document.getElementById("host");
  const ins = window.__ins;
  const live = ins && ins.isConnected;
  return {
    label,
    hostChildren: [...host.children].map((n) => n.tagName),
    insChildCount: live ? ins.childElementCount : null,
    insDataProcessed: live ? ins.getAttribute("data-processed") : null,
    oldObserverOnInsFired: window.__obsFired,
    creativeIsSiblingOfIns: live && !!ins.previousElementSibling,
    siblingInner: live && ins.previousElementSibling
      ? ins.previousElementSibling.innerHTML.slice(0, 200) : null,
    requestsSoFar: (window.AdProvider && typeof window.AdProvider.getDebugMessages === "function")
      ? window.AdProvider.getDebugMessages().filter((m) => /is being served/.test(m)).length
      : "unknown",
  };
};
</script>
<script async type="application/javascript" src="https://a.magsrv.com/ad-provider.js"></script>
</body></html>`;

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 900 } });

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
await page
  .waitForFunction(() => window.AdProvider && typeof window.AdProvider.push === "function", null, {
    timeout: 20000,
  })
  .catch(() => console.log("!! AdProvider never became an object — is the network reachable?"));

const shots = [];
async function phase(label, fn) {
  await fn();
  await page.evaluate(() => window.serve());
  await page.waitForTimeout(4000);
  shots.push(await page.evaluate((l) => window.snapshot(l), label));
}

// Q1 + first serve.
await phase("1. first build + serve", () => page.evaluate(() => window.buildIns()));
// Q2: full teardown and rebuild — the /history lifecycle.
await phase("2. host emptied, ins rebuilt (remount)", async () => {
  await page.evaluate(() => window.dropHost());
  await page.waitForTimeout(400);
  await page.evaluate(() => window.buildIns());
});
// Q3: host never left the DOM, contents rebuilt — the bottom-nav lifecycle.
await phase("3. persistent host, ins rebuilt in place", () => page.evaluate(() => window.buildIns()));

for (const s of shots) {
  console.log("\n===============", s.label, "===============");
  console.log(JSON.stringify(s, null, 2));
}

const msgs = await page.evaluate(() =>
  window.AdProvider.getDebugMessages().filter((m) => /is being served|no ads|handling the response/.test(m)),
);
console.log("\n--- loader request log ---");
for (const m of msgs) console.log("   ", m);

const served = shots.at(-1).requestsSoFar;
console.log(
  `\nVERDICT: ${served} ad request(s) issued across 3 serves — ` +
    (served >= 3 ? "the loader RE-SERVES a fresh <ins> every time." : "re-serving did NOT happen."),
);
console.log(
  `VERDICT: creative lands as a SIBLING of the <ins>: ${shots[0].creativeIsSiblingOfIns}; ` +
    `an observer on the <ins> itself fired: ${shots[0].oldObserverOnInsFired}.`,
);

await browser.close();
server.close();
