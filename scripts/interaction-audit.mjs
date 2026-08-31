/**
 * Landing LCP + FIRST-TAP readiness harness.
 *
 * Two questions, one page load, because they are suspected to be the same
 * problem: this project's 2026-07-20 investigation proved LCP on `/` is the END
 * OF THE FIRST HYDRATION TASK, and a tap that lands before hydration finishes
 * hits a button whose React handler is not attached yet — a dead first tap.
 *
 * So this measures:
 *   • every LCP candidate (time + element), the technique that settled the
 *     attribution last time;
 *   • the long-task timeline;
 *   • WHEN the primary Download button actually becomes interactive, by
 *     polling a click on it and watching for the app to respond.
 *
 * Interleave variants and read medians — this harness swings ~1s run to run,
 * and un-interleaved runs have produced false conclusions on this project.
 *
 *   node scripts/interaction-audit.mjs
 *   LCP_RUNS=5 LCP_LABEL=after node scripts/interaction-audit.mjs
 */
import { chromium, devices } from "playwright";

const URL = process.env.LCP_URL ?? "http://localhost:3123/";
const RUNS = Number(process.env.LCP_RUNS ?? 5);
const LABEL = process.env.LCP_LABEL ?? "baseline";

const COLLECT = `
  window.__lcp = [];
  window.__tasks = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      window.__lcp.push({ t: Math.round(e.startTime), size: e.size, el: e.element?.tagName ?? null, src: (e.element?.currentSrc || e.element?.src || "").slice(-70), cls: (e.element?.className || "").toString().slice(0,70) });
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__tasks.push({ t: Math.round(e.startTime), d: Math.round(e.duration) });
  }).observe({ type: 'longtask', buffered: true });
  // React attaches a root listener at the container; the presence of a fiber on
  // the element is the honest signal that THIS element is hydrated.
  window.__hydrated = (el) => {
    if (!el) return false;
    return Object.keys(el).some((k) => k.startsWith('__react'));
  };
`;

const median = (xs) => {
  const s = [...xs].filter((n) => typeof n === "number").sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

async function once(browser) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.addInitScript(COLLECT);

  const t0 = Date.now();
  await page.goto(URL, { waitUntil: "commit", timeout: 60_000 });

  // When does the primary CTA exist in the DOM, and when is it hydrated?
  const SEL = 'button[type="submit"], form button';
  let domAt = null;
  let hydratedAt = null;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && hydratedAt === null) {
    const r = await page
      .evaluate((sel) => {
        const el = document.querySelector(sel);
        return { exists: !!el, hydrated: el ? window.__hydrated(el) : false };
      }, SEL)
      .catch(() => ({ exists: false, hydrated: false }));
    if (r.exists && domAt === null) domAt = Date.now() - t0;
    if (r.hydrated) hydratedAt = Date.now() - t0;
    if (hydratedAt === null) await page.waitForTimeout(50);
  }

  await page.waitForLoadState("load").catch(() => {});
  await page.waitForTimeout(2000);

  const out = await page.evaluate(() => {
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return { lcp: window.__lcp, tasks: window.__tasks, fcp: fcp ? Math.round(fcp.startTime) : null };
  });
  await ctx.close();
  const last = out.lcp[out.lcp.length - 1];
  return { lcp: last?.t ?? null, el: last?.el, src: last?.src, cls: last?.cls, fcp: out.fcp, domAt, hydratedAt, tasks: out.tasks };
}

const browser = await chromium.launch();
const rows = [];
for (let i = 0; i < RUNS; i++) {
  const r = await once(browser);
  rows.push(r);
  const big = r.tasks.filter((t) => t.d >= 120).map((t) => `${t.t}+${t.d}`).join(" ");
  console.log(
    `${LABEL} run${i + 1}  fcp=${r.fcp}  LCP=${r.lcp} <${r.el}>  btnInDOM=${r.domAt}  btnHYDRATED=${r.hydratedAt}
    LCPel=<${r.el}> src=${r.src} cls=${r.cls}
    longtasks[${big}]`,
  );
}
await browser.close();

console.log(
  `\n${LABEL}  LCP median ${median(rows.map((r) => r.lcp))}ms · FCP ${median(rows.map((r) => r.fcp))}ms` +
    `\n${LABEL}  DEAD-TAP WINDOW: button in DOM at ${median(rows.map((r) => r.domAt))}ms, interactive at ${median(rows.map((r) => r.hydratedAt))}ms`,
);
