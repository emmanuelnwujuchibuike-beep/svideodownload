/**
 * INTERLEAVED A/B on PRODUCTION for the LCP image quality.
 *
 * ── Why this can be measured before the change is deployed ───────────────────
 *
 * The fix is one query parameter on one request (`q=75` -> `q=50`), and
 * `/_next/image` is a live service on the production origin. So arm B can be
 * produced by rewriting that single URL in flight: same origin, same CDN, same
 * HTML, same 30 scripts competing for the same 1.6 Mbps — only the bytes of the
 * LCP resource differ. That is a far tighter comparison than two deploys.
 *
 * 🔴 BOTH ARMS ARE INTERCEPTED. `page.route` costs a round trip through Node on
 * every request it handles, and putting that cost in only one arm would be
 * measuring the harness. Arm A rewrites the URL to itself.
 *
 * 🔴 INTERLEAVED A,B,A,B in ONE session. This project has drawn false
 * conclusions from un-interleaved runs and from comparing across sessions; the
 * harness swings ~1s run to run either way, so pairs and medians are the only
 * readable signal.
 *
 *   node scripts/lcp-image-ab.mjs
 *   LCP_PAIRS=5 LCP_Q=50 node scripts/lcp-image-ab.mjs
 */
import { chromium, devices } from "playwright";

const TARGET = process.env.LCP_URL ?? "https://frenzsave.com/";
const PAIRS = Number(process.env.LCP_PAIRS ?? 4);
const QUALITY = process.env.LCP_Q ?? "50";
const PROFILE = process.env.LCP_PROFILE ?? "slow4g";

const NET = {
  slow4g: { latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8, cpu: 4 },
  fast4g: { latency: 40, down: (10 * 1024 * 1024) / 8, up: (10 * 1024 * 1024) / 8, cpu: 2 },
};

const COLLECT = [
  "window.__lcp = [];",
  "new PerformanceObserver((l) => {",
  "  for (const e of l.getEntries()) {",
  "    const el = e.element;",
  "    window.__lcp.push({ t: Math.round(e.startTime), el: el ? el.tagName : null,",
  "      src: (el && (el.currentSrc || el.src)) || '',",
  "      loadTime: Math.round(e.loadTime || 0) });",
  "  }",
  "}).observe({ type: 'largest-contentful-paint', buffered: true });",
].join("\n");

const READ = [
  "(() => {",
  "  const nav = performance.getEntriesByType('navigation')[0];",
  "  const fcp = performance.getEntriesByName('first-contentful-paint')[0];",
  "  const lcpEntry = window.__lcp[window.__lcp.length - 1] || {};",
  "  const img = performance.getEntriesByType('resource')",
  "    .filter((r) => r.name.includes('/_next/image') && r.name.includes('wallpapers'))",
  "    .sort((a, b) => b.transferSize - a.transferSize)[0];",
  "  return {",
  "    lcp: lcpEntry.t, el: lcpEntry.el,",
  "    fcp: fcp ? Math.round(fcp.startTime) : null,",
  "    load: nav ? Math.round(nav.loadEventStart) : null,",
  "    imgBytes: img ? img.transferSize : null,",
  "    imgStart: img ? Math.round(img.startTime) : null,",
  "    imgEnd: img ? Math.round(img.responseEnd) : null,",
  "    thirdBeforeLoad: performance.getEntriesByType('resource')",
  "      .filter((r) => !new URL(r.name).host.includes('frenzsave') && r.startTime < (nav ? nav.loadEventStart : 0))",
  "      .map((r) => new URL(r.name).host),",
  "  };",
  "})()",
].join("\n");

const median = (xs) => {
  const s = xs.filter((n) => typeof n === "number").sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

async function run(browser, arm) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const net = NET[PROFILE];
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: net.latency, downloadThroughput: net.down, uploadThroughput: net.up,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: net.cpu });
  await page.addInitScript(COLLECT);

  /* Identical interception in both arms; only arm B changes the value. */
  await page.route("**/_next/image**", (route) => {
    const url = route.request().url();
    if (arm === "before" || !url.includes("wallpapers")) return route.continue({ url });
    return route.continue({ url: url.replace(/([?&])q=\d+/, `$1q=${QUALITY}`) });
  });

  await page.goto(TARGET, { waitUntil: "load", timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const out = await page.evaluate(READ);
  await ctx.close();
  return out;
}

const browser = await chromium.launch();
const rows = { before: [], after: [] };
for (let i = 0; i < PAIRS; i++) {
  for (const arm of ["before", "after"]) {
    const r = await run(browser, arm);
    rows[arm].push(r);
    console.log(
      `${arm.padEnd(6)} pair${i + 1}  FCP ${String(r.fcp).padStart(5)}  LCP ${String(r.lcp).padStart(5)} <${r.el}>` +
        `  load ${String(r.load).padStart(5)}  image ${r.imgBytes} B  ${r.imgStart}->${r.imgEnd}ms` +
        `  3p-before-load: ${[...new Set(r.thirdBeforeLoad)].join(",") || "(none)"}`,
    );
  }
}
await browser.close();

const sum = (arm) => ({
  fcp: median(rows[arm].map((r) => r.fcp)),
  lcp: median(rows[arm].map((r) => r.lcp)),
  load: median(rows[arm].map((r) => r.load)),
  bytes: median(rows[arm].map((r) => r.imgBytes)),
});
const b = sum("before");
const a = sum("after");
console.log(
  `\n=== ${PROFILE}, ${PAIRS} interleaved pairs, ${TARGET}` +
    `\n            FCP     LCP    load    LCP-image bytes` +
    `\n  before  ${String(b.fcp).padStart(5)}  ${String(b.lcp).padStart(5)}  ${String(b.load).padStart(5)}  ${b.bytes}` +
    `\n  after   ${String(a.fcp).padStart(5)}  ${String(a.lcp).padStart(5)}  ${String(a.load).padStart(5)}  ${a.bytes}` +
    `\n  delta   ${String(a.fcp - b.fcp).padStart(5)}  ${String(a.lcp - b.lcp).padStart(5)}  ${String(a.load - b.load).padStart(5)}  ${a.bytes - b.bytes}` +
    `\n  raw before LCP: ${rows.before.map((r) => r.lcp).join(", ")}` +
    `\n  raw after  LCP: ${rows.after.map((r) => r.lcp).join(", ")}`,
);
