/**
 * Interleaved production A/B: does deferring AdSense on APP routes make the
 * bottom navigation tappable sooner?
 *
 * ── Why it is done by rewriting the HTML ────────────────────────────────────
 *
 * The gate is a server-rendered inline `<script>` in the root layout, so it
 * cannot be toggled from the client and a deploy cannot be A/B'd against
 * itself. Rewriting the document body in flight gives both arms the same
 * origin, the same session, the same network and the same CPU — only the
 * branch differs. Comparing a pre-deploy run against a post-deploy one would
 * be comparing two sessions, which has produced false conclusions here before.
 *
 * BEFORE = production as it stands: AdSense injected immediately on any path
 *          that is not "/" (i.e. every app route).
 * AFTER  = the proposed gate: load-then-idle everywhere.
 *
 * Rewriting the AFTER arm rather than the BEFORE one means this measures the
 * change WITHOUT deploying it — and `rewrote=` is printed so a rewrite that
 * silently stopped matching cannot be read as "the change did nothing".
 *
 * 🔴 Both arms are intercepted so the interception cost is identical.
 *
 *   node scripts/adsense-defer-ab.mjs
 *   AB_PAIRS=4 AB_URL=https://frenzsave.com/launch.html node scripts/adsense-defer-ab.mjs
 */
import { chromium, devices } from "playwright";

const URL_TARGET = process.env.AB_URL ?? "https://frenzsave.com/launch.html";
const PAIRS = Number(process.env.AB_PAIRS ?? 4);
const NET = { latency: 40, down: (10 * 1024 * 1024) / 8, up: (10 * 1024 * 1024) / 8, cpu: 4 };

const COLLECT = [
  "window.__tasks = [];",
  "new PerformanceObserver((l) => { for (const e of l.getEntries())",
  "  window.__tasks.push({ t: Math.round(e.startTime), d: Math.round(e.duration) });",
  "}).observe({ type: 'longtask', buffered: true });",
  "window.__hydrated = (el) => !!el && Object.keys(el).some((k) => k.startsWith('__react'));",
].join("\n");

/**
 * The gate AS PRODUCTION CURRENTLY SERVES IT — deferred on the landing only,
 * immediate on every app route. Captured from the live HTML.
 */
const LIVE =
  'try{if(location.pathname!=="/"){l()}else{var i=function(){(window.requestIdleCallback||function(f){setTimeout(f,1500)})(l,{timeout:3000})};if(document.readyState==="complete"){i()}else{addEventListener("load",i,{once:true})}}}catch(err){l()}';
/** The proposed gate: load-then-idle on EVERY route. */
const DEFERRED =
  'var i=function(){(window.requestIdleCallback||function(f){setTimeout(f,1500)})(l,{timeout:4000})};try{if(document.readyState==="complete"){i()}else{addEventListener("load",i,{once:true})}}catch(err){l()}';
const median = (xs) => {
  const s = xs.filter((n) => typeof n === "number").sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

async function run(browser, arm) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: NET.latency, downloadThroughput: NET.down, uploadThroughput: NET.up,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: NET.cpu });
  await page.addInitScript(COLLECT);

  let rewrote = false;
  /* Intercept EVERY document in both arms so the cost is symmetric. */
  await page.route((u) => u.protocol === "https:" && u.hostname.endsWith("frenzsave.com"), async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const res = await route.fetch();
    let body = await res.text();
    if (arm === "after" && body.includes(LIVE)) {
      body = body.replace(LIVE, DEFERRED);
      rewrote = true;
    }
    return route.fulfill({ response: res, body });
  });

  const t0 = Date.now();
  await page.goto(URL_TARGET, { waitUntil: "commit", timeout: 90_000 }).catch(() => {});

  let navAt = null;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && navAt === null) {
    const ok = await page
      .evaluate(() => {
        const el = document.querySelector('nav a[href], nav button, [data-bottom-nav] a');
        return !!el && window.__hydrated(el);
      })
      .catch(() => false);
    if (ok) navAt = Date.now() - t0;
    else await page.waitForTimeout(60);
  }

  await page.waitForLoadState("load").catch(() => {});
  await page.waitForTimeout(2500);

  const out = await page.evaluate(() => {
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const ads = performance
      .getEntriesByType("resource")
      .find((r) => r.name.includes("adsbygoogle.js"));
    return {
      fcp: fcp ? Math.round(fcp.startTime) : null,
      tbt: window.__tasks.reduce((a, t) => a + Math.max(0, t.d - 50), 0),
      adsAt: ads ? Math.round(ads.startTime) : null,
    };
  });
  await ctx.close();
  return { ...out, navAt, rewrote };
}

const browser = await chromium.launch();
const rows = { before: [], after: [] };
for (let i = 0; i < PAIRS; i++) {
  for (const arm of ["before", "after"]) {
    const r = await run(browser, arm);
    rows[arm].push(r);
    console.log(
      `${arm.padEnd(6)} pair${i + 1}  FCP ${String(r.fcp).padStart(5)}  TBT ${String(r.tbt).padStart(5)}` +
        `  nav-tappable ${String(r.navAt).padStart(5)}  adsbygoogle@${String(r.adsAt).padStart(5)}` +
        (arm === "after" ? `  rewrote=${r.rewrote}` : ""),
    );
  }
}
await browser.close();

const sum = (a) => ({
  fcp: median(rows[a].map((r) => r.fcp)),
  tbt: median(rows[a].map((r) => r.tbt)),
  nav: median(rows[a].map((r) => r.navAt)),
  ads: median(rows[a].map((r) => r.adsAt)),
});
const b = sum("before");
const a = sum("after");
console.log(
  `\n=== ${PAIRS} interleaved pairs · ${URL_TARGET} · 4x CPU / fast-4G` +
    `\n           FCP    TBT   nav-tappable   adsbygoogle starts` +
    `\n  before ${String(b.fcp).padStart(5)}  ${String(b.tbt).padStart(5)}  ${String(b.nav).padStart(12)}  ${String(b.ads).padStart(17)}` +
    `\n  after  ${String(a.fcp).padStart(5)}  ${String(a.tbt).padStart(5)}  ${String(a.nav).padStart(12)}  ${String(a.ads).padStart(17)}` +
    `\n  delta  ${String(a.fcp - b.fcp).padStart(5)}  ${String(a.tbt - b.tbt).padStart(5)}  ${String(a.nav - b.nav).padStart(12)}` +
    `\n  raw before nav: ${rows.before.map((r) => r.navAt).join(", ")}` +
    `\n  raw after  nav: ${rows.after.map((r) => r.navAt).join(", ")}`,
);
