/**
 * APK vs PWA vs Chrome — where does the app-shell startup actually go?
 *
 * The APK is a TWA: its `start_url` is `/launch.html` (app/manifest.ts), a
 * hand-written static loader that paints branding and then `location.replace`s
 * to the real page. So an installed cold start is TWO document loads, and the
 * browser's is one. That difference is measurable and is the first thing to
 * check before blaming "Android".
 *
 * A TWA runs the SAME Chrome engine as Chrome Android, so anything that differs
 * here is our startup chain, not the WebView.
 *
 * Measures, per arm: FCP, LCP, long-task time (a Total-Blocking-Time proxy),
 * the JS on the wire, request count, and — the number that actually matters on
 * a phone — WHEN THE BOTTOM NAV BECOMES TAPPABLE.
 *
 *   node scripts/app-startup-audit.mjs
 *   AUDIT_RUNS=3 AUDIT_PROFILE=mid node scripts/app-startup-audit.mjs
 */
import { chromium, devices } from "playwright";

const BASE = process.env.AUDIT_BASE ?? "https://frenzsave.com";
const RUNS = Number(process.env.AUDIT_RUNS ?? 3);
const PROFILE = process.env.AUDIT_PROFILE ?? "mid";

/** Rough device classes, so "low-end Android" is a setting and not a vibe. */
const PROFILES = {
  low: { latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8, cpu: 6 },
  mid: { latency: 40, down: (10 * 1024 * 1024) / 8, up: (10 * 1024 * 1024) / 8, cpu: 4 },
  high: { latency: 20, down: (30 * 1024 * 1024) / 8, up: (15 * 1024 * 1024) / 8, cpu: 1 },
};

const COLLECT = [
  "window.__lcp = []; window.__tasks = []; window.__t0 = performance.now();",
  "new PerformanceObserver((l) => { for (const e of l.getEntries())",
  "  window.__lcp.push({ t: Math.round(e.startTime), el: e.element ? e.element.tagName : null });",
  "}).observe({ type: 'largest-contentful-paint', buffered: true });",
  "new PerformanceObserver((l) => { for (const e of l.getEntries())",
  "  window.__tasks.push({ t: Math.round(e.startTime), d: Math.round(e.duration) });",
  "}).observe({ type: 'longtask', buffered: true });",
  // React attaches a fiber to the element once the subtree is hydrated; that is
  // the honest 'this control now responds' signal, not 'it is on screen'.
  "window.__hydrated = (el) => !!el && Object.keys(el).some((k) => k.startsWith('__react'));",
].join("\n");

const median = (xs) => {
  const s = xs.filter((n) => typeof n === "number").sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

async function run(browser, label, url) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const p = PROFILES[PROFILE];
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: p.latency, downloadThroughput: p.down, uploadThroughput: p.up,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: p.cpu });
  await page.addInitScript(COLLECT);

  let jsBytes = 0;
  let requests = 0;
  page.on("response", (r) => {
    requests++;
    const h = r.headers()["content-length"];
    if (/javascript/.test(r.headers()["content-type"] ?? "") && h) jsBytes += Number(h);
  });

  const t0 = Date.now();
  await page.goto(url, { waitUntil: "commit", timeout: 90_000 }).catch(() => {});

  /* The bottom nav is the app's primary control surface. Poll for it becoming
     REACTIVE, not merely present — the gap between the two is the dead-tap
     window a member actually feels. */
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
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      fcp: fcp ? Math.round(fcp.startTime) : null,
      lcp: window.__lcp.length ? window.__lcp[window.__lcp.length - 1].t : null,
      lcpEl: window.__lcp.length ? window.__lcp[window.__lcp.length - 1].el : null,
      ttfb: nav ? Math.round(nav.responseStart) : null,
      load: nav ? Math.round(nav.loadEventStart) : null,
      // Long-task time beyond the 50ms each task is "allowed" — the TBT proxy.
      tbt: window.__tasks.reduce((a, t) => a + Math.max(0, t.d - 50), 0),
      longest: window.__tasks.reduce((a, t) => Math.max(a, t.d), 0),
      tasks: window.__tasks.filter((t) => t.d >= 150).map((t) => `${t.t}+${t.d}`),
      href: location.pathname,
    };
  });
  await ctx.close();
  return { ...out, navAt, jsBytes: Math.round(jsBytes / 1024), requests };
}

const ARMS = [
  ["APK  (start_url)", `${BASE}/launch.html`],
  ["PWA  (home direct)", `${BASE}/home`],
  ["Chrome (landing)", `${BASE}/`],
];

const browser = await chromium.launch();
const rows = new Map(ARMS.map(([l]) => [l, []]));
/* Interleaved: one of each arm per pass, so a network wobble hits all arms
   equally instead of ruining one. */
for (let i = 0; i < RUNS; i++) {
  for (const [label, url] of ARMS) {
    const r = await run(browser, label, url);
    rows.get(label).push(r);
    console.log(
      `${label.padEnd(20)} run${i + 1}  FCP ${String(r.fcp).padStart(5)}  LCP ${String(r.lcp).padStart(5)}` +
        `  TBT ${String(r.tbt).padStart(5)}  longest ${String(r.longest).padStart(4)}` +
        `  nav-tappable ${String(r.navAt).padStart(5)}  js ${String(r.jsBytes).padStart(4)}kB` +
        `  reqs ${String(r.requests).padStart(3)}  ended at ${r.href}`,
    );
    if (r.tasks.length) console.log(`${" ".repeat(22)}long tasks >=150ms: ${r.tasks.join(" ")}`);
  }
}
await browser.close();

console.log(`\n=== medians  [${PROFILE}: ${PROFILES[PROFILE].cpu}x CPU]  n=${RUNS}`);
console.log("arm                    FCP    LCP    TBT   nav-tappable   JS    reqs");
for (const [label, rs] of rows) {
  console.log(
    `${label.padEnd(20)} ${String(median(rs.map((r) => r.fcp))).padStart(5)}` +
      `  ${String(median(rs.map((r) => r.lcp))).padStart(5)}` +
      `  ${String(median(rs.map((r) => r.tbt))).padStart(5)}` +
      `  ${String(median(rs.map((r) => r.navAt))).padStart(12)}` +
      `  ${String(median(rs.map((r) => r.jsBytes))).padStart(4)}kB` +
      `  ${String(median(rs.map((r) => r.requests))).padStart(4)}`,
  );
}
