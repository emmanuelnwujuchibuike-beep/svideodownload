/**
 * What is the landing page's LCP, right now, on a throttled phone?
 *
 * The 1.6-second budget is the owner's standing rule, and "seems the lcp is
 * broken" is a claim that has to be answered with a number rather than an
 * opinion — twice before, a confident guess about this page's timing turned out
 * to be measuring the harness.
 *
 * Runs each arm several times and reports the MEDIAN, because a single cold run
 * on a throttled connection has enough spread to prove whatever you hoped.
 *
 *   node scripts/lcp-check.mjs http://localhost:3123/ 5
 *
 * THIRD PARTIES ARE ALLOWED THROUGH by default — the ad loader is part of what
 * we are measuring. Pass BLOCK_THIRD_PARTY=1 to get the counterfactual, which
 * is how the 2026-08-30 "~340ms of LCP was ad creatives" number was found.
 */
import { chromium, devices } from "playwright";

const URL_ = process.argv[2] ?? "http://localhost:3123/";
const RUNS = Number(process.argv[3] ?? 5);
const BLOCK = process.env.BLOCK_THIRD_PARTY === "1";
/*
  🔴 The honest counterfactual. BLOCK_THIRD_PARTY also blocks Google Fonts, so
  that arm measures a page that never rendered its real text — it reported a
  396ms LCP for a page that had barely painted, and I nearly believed it.
  NO_ADS keeps every other third party and only stops the ad CONFIG resolving,
  so no placement mounts. Same page, same fonts, ads off.
*/
const NO_ADS = process.env.NO_ADS === "1";

/** Slow-4G + 4x CPU, the same conditions the dead-tap work measured under. */
async function throttle(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}

const COLLECT = `
  window.__lcp = 0;
  window.__longTasks = 0;
  window.__longTaskMs = 0;
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__lcp = Math.max(window.__lcp, e.startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) { window.__longTasks++; window.__longTaskMs += e.duration; }
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) {}
`;

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

const lcps = [];
const tasks = [];
const taskMs = [];
const timers = [];

for (let i = 0; i < RUNS; i++) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  await page.route("**/*", (r) => {
    const h = new URL(r.request().url()).hostname;
    const local = h === "localhost" || h === "127.0.0.1";
    if (!local && BLOCK) return r.abort();
    // The service worker reloads once on a cold profile; that is not LCP.
    const path = new URL(r.request().url()).pathname;
    if (local && path === "/sw.js") return r.fulfill({ status: 404, body: "" });
    if (NO_ADS && local && (path === "/api/ads/config" || path.startsWith("/api/ads")))
      return r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    return r.continue();
  });
  await throttle(ctx, page);
  await page.addInitScript(COLLECT);
  await page.goto(URL_, { waitUntil: "load", timeout: 90_000 });
  // Let post-load work (deferred ad furniture, the shell) settle.
  await page.waitForTimeout(8000);

  /*
    Retried: the page can navigate during the settle (a service-worker claim, an
    error-boundary reload) and destroy the execution context. Losing a run to
    that is fine; crashing the whole comparison is not.
  */
  const read = async () =>
    page.evaluate(() => ({
    lcp: Math.round(window.__lcp),
    tasks: window.__longTasks,
    taskMs: Math.round(window.__longTaskMs),
    /* Timers still armed after settle — a permanently-running interval is the
       kind of thing that makes a page "delay a lot" without touching LCP. */
    intervals: (() => {
      let n = 0;
      const id = setInterval(() => {}, 9999);
      clearInterval(id);
      n = Number(id);
      return n;
    })(),
  }));
  let m = null;
  for (let attempt = 0; attempt < 3 && !m; attempt++) {
    m = await read().catch(() => null);
    if (!m) await page.waitForTimeout(1000);
  }
  if (!m) {
    console.log(`  run ${i + 1}: skipped (the page navigated mid-measurement)`);
    await browser.close();
    continue;
  }
  lcps.push(m.lcp);
  tasks.push(m.tasks);
  taskMs.push(m.taskMs);
  timers.push(m.intervals);
  console.log(
    `  run ${i + 1}: LCP ${String(m.lcp).padStart(5)}ms   long tasks ${String(m.tasks).padStart(3)} (${m.taskMs}ms)   timer ids issued ~${m.intervals}`,
  );
  await browser.close();
}

console.log(`\n${BLOCK ? "THIRD PARTIES BLOCKED" : "third parties allowed"} — ${RUNS} runs`);
console.log(`  MEDIAN LCP        ${median(lcps)}ms`);
console.log(`  median long tasks ${median(tasks)} (${median(taskMs)}ms total)`);
console.log(`  median timer ids  ~${median(timers)}  (a proxy for how many timers the page created)`);
