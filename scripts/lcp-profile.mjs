/**
 * PRODUCTION LCP profiler — "what is the main thread actually doing?"
 *
 * ── Why this exists, when `interaction-audit.mjs` already measures LCP ───────
 *
 * That harness answers WHEN. After 2026-09-01 the open question is WHAT: LCP on
 * `/` is 1720ms unthrottled and 4824ms at slow-4G/4x CPU, and it barely moves
 * between unthrottled and fast-4G/2x — so the cost is CPU, not bytes, and a
 * number alone cannot say which code is spending it.
 *
 * So this takes a real V8 SAMPLING PROFILE across the whole load and aggregates
 * self time by script, then by function. That is the only artefact that can
 * name the work; long-task entries give a duration and no attribution at all.
 *
 * 🔴 PRODUCTION ONLY. Dev-server hydration timings are artefacts on this
 * project (recorded twice), and localhost is an unauthorised ad referer, so a
 * localhost run does not even load the same page.
 *
 *   node scripts/lcp-profile.mjs
 *   LCP_URL=https://frenzsave.com/ LCP_RUNS=3 LCP_LABEL=after node scripts/lcp-profile.mjs
 *   LCP_PROFILE=fast4g node scripts/lcp-profile.mjs   # fast4g | slow4g | none
 */
import { chromium, devices } from "playwright";

const TARGET = process.env.LCP_URL ?? "https://frenzsave.com/";
const RUNS = Number(process.env.LCP_RUNS ?? 3);
const LABEL = process.env.LCP_LABEL ?? "baseline";
const PROFILE = process.env.LCP_PROFILE ?? "slow4g";

/**
 * Lighthouse's own mobile presets, so numbers compare to its report — plus the
 * two CROSSED profiles that separate the variables Lighthouse bundles together.
 *
 * 🔴 `slow4g` moves bandwidth AND CPU at once, so "LCP triples on slow-4G/4x"
 * cannot on its own say which one did it. `slow4g1x` (slow bytes, fast CPU) and
 * `fast4g4x` (fast bytes, slow CPU) are the pair that answers it: whichever one
 * keeps LCP high is the binding constraint.
 */
const NET = {
  slow4g: { latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8, cpu: 4 },
  fast4g: { latency: 40, down: (10 * 1024 * 1024) / 8, up: (10 * 1024 * 1024) / 8, cpu: 2 },
  slow4g1x: { latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8, cpu: 1 },
  fast4g4x: { latency: 40, down: (10 * 1024 * 1024) / 8, up: (10 * 1024 * 1024) / 8, cpu: 4 },
  none: null,
};

const COLLECT = [
  "window.__lcp = [];",
  "window.__tasks = [];",
  "new PerformanceObserver((l) => {",
  "  for (const e of l.getEntries()) {",
  "    const el = e.element;",
  "    window.__lcp.push({",
  "      t: Math.round(e.startTime), size: e.size,",
  "      loadTime: Math.round(e.loadTime || 0), renderTime: Math.round(e.renderTime || 0),",
  "      el: el ? el.tagName : null, id: (el && el.id) || null,",
  "      cls: ((el && el.className) || '').toString().slice(0, 90),",
  "      src: ((el && (el.currentSrc || el.src)) || '').slice(-80),",
  "      txt: ((el && el.textContent) || '').trim().slice(0, 60),",
  "    });",
  "  }",
  "}).observe({ type: 'largest-contentful-paint', buffered: true });",
  "new PerformanceObserver((l) => {",
  "  for (const e of l.getEntries()) window.__tasks.push({ t: Math.round(e.startTime), d: Math.round(e.duration) });",
  "}).observe({ type: 'longtask', buffered: true });",
].join("\n");

const READ = [
  "(() => {",
  "  const fcp = performance.getEntriesByName('first-contentful-paint')[0];",
  "  const nav = performance.getEntriesByType('navigation')[0];",
  "  const res = performance.getEntriesByType('resource').map((r) => ({",
  "    n: r.name.replace(/^https?:\\/\\/[^/]+/, '').split('?')[0],",
  "    host: new URL(r.name).host,",
  "    start: Math.round(r.startTime), end: Math.round(r.responseEnd),",
  "    size: r.transferSize, block: r.renderBlockingStatus || '', type: r.initiatorType,",
  "  }));",
  "  return {",
  "    lcp: window.__lcp, tasks: window.__tasks,",
  "    fcp: fcp ? Math.round(fcp.startTime) : null,",
  "    ttfb: nav ? Math.round(nav.responseStart) : null,",
  "    htmlEnd: nav ? Math.round(nav.responseEnd) : null,",
  "    dcl: nav ? Math.round(nav.domContentLoadedEventStart) : null,",
  "    load: nav ? Math.round(nav.loadEventStart) : null,",
  "    res,",
  "  };",
  "})()",
].join("\n");

const median = (xs) => {
  const s = xs.filter((n) => typeof n === "number").sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

/** Self time per sampled node, rolled up to `file -> ms` and `function -> ms`. */
function summarise(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const deltas = profile.timeDeltas ?? [];
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = (deltas[i] ?? 0) / 1000; // microseconds -> ms
    const id = profile.samples[i];
    self.set(id, (self.get(id) ?? 0) + dt);
  }
  const byUrl = new Map();
  const byFn = new Map();
  for (const [id, ms] of self) {
    const n = byId.get(id);
    if (!n) continue;
    const f = n.callFrame;
    const raw = f.url || "(" + (f.functionName || "anonymous") + ")";
    const short = raw.replace(/^https?:\/\/[^/]+/, "").split("?")[0] || raw;
    byUrl.set(short, (byUrl.get(short) ?? 0) + ms);
    const key = (f.functionName || "(anonymous)") + "  " + short + ":" + f.lineNumber;
    byFn.set(key, (byFn.get(key) ?? 0) + ms);
  }
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
  return {
    byUrl: top(byUrl, 12),
    byFn: top(byFn, 14),
    total: [...self.values()].reduce((a, b) => a + b, 0),
  };
}

async function once(browser, i) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const net = NET[PROFILE];
  if (net) {
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: net.latency,
      downloadThroughput: net.down,
      uploadThroughput: net.up,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: net.cpu });
  }
  await page.addInitScript(COLLECT);

  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");

  await page.goto(TARGET, { waitUntil: "load", timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const stopped = await cdp.send("Profiler.stop");
  const out = await page.evaluate(READ);
  await ctx.close();

  const last = out.lcp[out.lcp.length - 1] ?? {};
  const sum = summarise(stopped.profile);

  console.log("\n--- " + LABEL + " run" + (i + 1) + " [" + PROFILE + "] " + TARGET);
  console.log(
    "  TTFB " + out.ttfb + "  htmlEnd " + out.htmlEnd + "  FCP " + out.fcp +
      "  LCP " + last.t + "  DCL " + out.dcl + "  load " + out.load,
  );
  console.log(
    "  LCP element  <" + last.el + "> id=" + last.id + " size=" + last.size +
      "\n               cls=" + JSON.stringify(last.cls) +
      "\n               src=" + JSON.stringify(last.src) + " txt=" + JSON.stringify(last.txt) +
      "\n               loadTime=" + last.loadTime + " renderTime=" + last.renderTime,
  );
  console.log("  LCP candidates: " + out.lcp.map((c) => c.t + "<" + c.el + ">").join(" -> "));
  console.log(
    "  long tasks (>=100ms): " +
      out.tasks.filter((t) => t.d >= 100).map((t) => t.t + "+" + t.d).join(" "),
  );
  const beforeLcp = out.tasks.filter((t) => t.t < last.t).reduce((a, t) => a + t.d, 0);
  console.log(
    "  long-task ms before LCP: " + beforeLcp + "   (sampled JS total " + Math.round(sum.total) + "ms)",
  );
  const blocking = out.res.filter((r) => r.block === "blocking");
  console.log(
    "  render-blocking: " +
      (blocking.map((r) => r.n + " @" + r.start + "-" + r.end).join(" ") || "(none reported)"),
  );
  const third = out.res.filter((r) => !r.host.includes("frenzsave") && r.start < (out.load ?? 1e9));
  console.log(
    "  third-party BEFORE load: " +
      (third.map((r) => r.host + r.n + "@" + r.start).join(" ") || "(none)"),
  );
  console.log("  -- JS self-time by file --");
  for (const [u, ms] of sum.byUrl) console.log("     " + String(Math.round(ms)).padStart(6) + "ms  " + u);
  console.log("  -- JS self-time by function --");
  for (const [f, ms] of sum.byFn) console.log("     " + String(Math.round(ms)).padStart(6) + "ms  " + f);

  return { lcp: last.t, fcp: out.fcp, ttfb: out.ttfb, load: out.load, el: last.el, beforeLcp };
}

const browser = await chromium.launch();
const rows = [];
for (let i = 0; i < RUNS; i++) rows.push(await once(browser, i));
await browser.close();

console.log(
  "\n=== " + LABEL + " [" + PROFILE + "] n=" + RUNS +
    "\n    TTFB " + median(rows.map((r) => r.ttfb)) + "  FCP " + median(rows.map((r) => r.fcp)) +
    "  LCP " + median(rows.map((r) => r.lcp)) + "  load " + median(rows.map((r) => r.load)) +
    "\n    LCP elements: " + rows.map((r) => r.el).join(",") +
    "\n    raw LCP: " + rows.map((r) => r.lcp).join(", "),
);
