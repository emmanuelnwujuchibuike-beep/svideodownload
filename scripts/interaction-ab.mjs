/**
 * INTERLEAVED A/B for the landing's dead-first-tap window.
 *
 * `scripts/interaction-audit.mjs` measures ONE build. This drives two builds
 * served on two ports and alternates between them run by run — A, B, A, B —
 * inside a single browser process.
 *
 * ── Why interleaving is not optional here ────────────────────────────────────
 * This harness swings ~1s run to run, and this project has twice reached a
 * confident, wrong conclusion from sequential runs: the 2026-08-30 font-preload
 * ablation looked decisive at n=4 (FCP 2612 → 2160ms) and evaporated when the
 * conditions were interleaved. Alternating makes network and thermal drift hit
 * both variants equally instead of loading onto whichever ran second.
 *
 *   A_URL=http://localhost:3124/ B_URL=http://localhost:3123/ \
 *   AB_RUNS=6 node scripts/interaction-ab.mjs
 *
 * A is conventionally the baseline, B the change.
 */
import { chromium, devices } from "playwright";

const A_URL = process.env.A_URL ?? "http://localhost:3124/";
const B_URL = process.env.B_URL ?? "http://localhost:3123/";
const A_LABEL = process.env.A_LABEL ?? "BEFORE";
const B_LABEL = process.env.B_LABEL ?? "AFTER";
const RUNS = Number(process.env.AB_RUNS ?? 6);

const COLLECT = `
  window.__lcp = [];
  window.__tasks = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      window.__lcp.push({ t: Math.round(e.startTime), el: e.element?.tagName ?? null });
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__tasks.push({ t: Math.round(e.startTime), d: Math.round(e.duration) });
  }).observe({ type: 'longtask', buffered: true });
  window.__hydrated = (el) => !!el && Object.keys(el).some((k) => k.startsWith('__react'));

  /*
   * TIMESTAMPS ARE TAKEN IN-PAGE, not by polling from the driver.
   *
   * Driver-side polling (page.evaluate in a loop) measures main-thread
   * AVAILABILITY as much as DOM state: each call needs a free main thread, so
   * while React is inside a long hydration task the driver simply cannot look.
   * That biases the two arms in opposite directions — the lighter build starts
   * hydrating EARLIER, so its poll is starved earlier, and its button appears
   * to enter the DOM LATER. It produced an apparent ~890ms improvement in the
   * dead-tap window that was mostly an artifact of when the driver could run.
   *
   * This interval lives on the page's own main thread and stamps
   * performance.now() the instant it next runs after a task ends, so both arms
   * are biased identically and the numbers are comparable with FCP/LCP.
   */
  window.__t = { btnDom: null, btnLive: null, subDom: null, subLive: null };
  (function () {
    const stamp = () => {
      const t = window.__t;
      const now = Math.round(performance.now());
      const first = document.querySelector('button[type="submit"], form button');
      const submit = document.querySelector('button[type="submit"]');
      if (first && t.btnDom === null) t.btnDom = now;
      if (submit && t.subDom === null) t.subDom = now;
      if (first && t.btnLive === null && window.__hydrated(first)) t.btnLive = now;
      if (submit && t.subLive === null && window.__hydrated(submit)) t.subLive = now;
      if (t.btnLive !== null && t.subLive !== null) clearInterval(id);
    };
    const id = setInterval(stamp, 10);
    stamp();
  })();
`;

const median = (xs) => {
  const s = xs.filter((n) => typeof n === "number" && Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

/*
 * THIRD-PARTY IS BLOCKED, and the measurement is meaningless without it.
 *
 * The first interleaved attempt produced `btnLIVE=null` on all six baseline
 * runs — the button was simply not in the DOM at 30s, on a page whose React
 * root had hydrated. A live ad had navigated the page away mid-run (this
 * project has a recorded Monetag push-hijack incident). Ad creatives are also
 * non-deterministic by nature: a different creative, of a different weight,
 * loads on every run, which is exactly the noise that makes an A/B unreadable.
 *
 * Blocking every non-localhost request removes that variable from BOTH arms
 * equally, so what is left is the difference this change actually makes. The
 * 2026-08-30 LCP work used the same technique to attribute ~340ms of LCP to ad
 * MP4s. Nothing needed for first paint is third-party: `next/font` self-hosts,
 * and the LCP image is proxied through `/_next/image` on the origin.
 */
async function once(browser, url) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  if (process.env.AB_ALLOW_THIRD_PARTY !== "1") {
    await page.route("**/*", (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host === "localhost" || host === "127.0.0.1") return route.continue();
      return route.abort();
    });
  }
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.addInitScript(COLLECT);

  // Bytes of JS actually pulled before the button answers — the quantity the
  // whole change is about, recorded per run rather than inferred from the build.
  let jsBytes = 0;
  let jsCount = 0;
  page.on("response", async (r) => {
    if (!r.url().includes("/_next/static/chunks/")) return;
    jsCount += 1;
    try {
      const b = await r.body();
      jsBytes += b.length;
    } catch {
      /* response body already gone — count still stands */
    }
  });

  const t0 = Date.now();
  await page.goto(url, { waitUntil: "commit", timeout: 60_000 });

  /*
   * TWO buttons, because they are not the same thing.
   *
   * `first` keeps scripts/interaction-audit.mjs's selector verbatim so the
   * numbers stay comparable with the 2026-08-31 baseline. It resolves to the
   * "Paste" control, which is simply the first form button in document order.
   *
   * `submit` is the DOWNLOAD button — the one the owner's report is actually
   * about ("some buttons occasionally feel delayed or require two presses").
   * They live in the same form and hydrate in the same unit, so the two track
   * each other closely; measuring both makes that visible instead of assumed.
   */
  // The driver only waits for completion here; every number comes from the
  // in-page stamper above.
  const deadline = Date.now() + 25_000;
  let t = { btnDom: null, btnLive: null, subDom: null, subLive: null };
  while (Date.now() < deadline) {
    t = await page.evaluate(() => window.__t).catch(() => t);
    if (t && t.btnLive !== null && t.subLive !== null) break;
    await page.waitForTimeout(100);
  }
  const domAt = t?.btnDom ?? null;
  const hydratedAt = t?.btnLive ?? null;
  const submitDomAt = t?.subDom ?? null;
  const submitLiveAt = t?.subLive ?? null;
  const jsAtHydration = jsBytes;

  await page.waitForLoadState("load").catch(() => {});
  await page.waitForTimeout(1500);

  const out = await page.evaluate(() => {
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return { lcp: window.__lcp, tasks: window.__tasks, fcp: fcp ? Math.round(fcp.startTime) : null };
  });
  await ctx.close();

  const last = out.lcp[out.lcp.length - 1];
  const longest = out.tasks.reduce((a, t) => Math.max(a, t.d), 0);
  return {
    lcp: last?.t ?? null,
    el: last?.el,
    fcp: out.fcp,
    domAt,
    hydratedAt,
    dead: domAt !== null && hydratedAt !== null ? hydratedAt - domAt : null,
    submitDomAt,
    submitLiveAt,
    submitDead: submitDomAt !== null && submitLiveAt !== null ? submitLiveAt - submitDomAt : null,
    longest,
    jsAtHydration,
    jsCount,
  };
}

const browser = await chromium.launch();
const rows = { [A_LABEL]: [], [B_LABEL]: [] };

for (let i = 0; i < RUNS; i++) {
  for (const [label, url] of [
    [A_LABEL, A_URL],
    [B_LABEL, B_URL],
  ]) {
    const r = await once(browser, url);
    rows[label].push(r);
    console.log(
      `${label.padEnd(6)} run${i + 1}  fcp=${String(r.fcp).padStart(5)}  LCP=${String(r.lcp).padStart(5)} <${r.el}>  ` +
        `btnDOM=${String(r.domAt).padStart(5)}  btnLIVE=${String(r.hydratedAt).padStart(5)}  ` +
        `DEAD=${String(r.dead).padStart(5)}/${String(r.submitDead).padStart(5)}ms  longestTask=${String(r.longest).padStart(4)}ms  ` +
        `js@live=${(r.jsAtHydration / 1024).toFixed(0)}kB/${r.jsCount}`,
    );
  }
}
await browser.close();

const sum = (label) => {
  const rs = rows[label];
  return {
    label,
    n: rs.length,
    fcp: median(rs.map((r) => r.fcp)),
    lcp: median(rs.map((r) => r.lcp)),
    dom: median(rs.map((r) => r.domAt)),
    live: median(rs.map((r) => r.hydratedAt)),
    dead: median(rs.map((r) => r.dead)),
    sDom: median(rs.map((r) => r.submitDomAt)),
    sLive: median(rs.map((r) => r.submitLiveAt)),
    sDead: median(rs.map((r) => r.submitDead)),
    longest: median(rs.map((r) => r.longest)),
    js: median(rs.map((r) => r.jsAtHydration)),
  };
};

const a = sum(A_LABEL);
const b = sum(B_LABEL);
console.log("\n" + "=".repeat(78));
console.log(`INTERLEAVED MEDIANS (n=${a.n} each, alternated A/B/A/B)`);
console.log("=".repeat(78));
const row = (k, x, y, unit = "ms") =>
  `${k.padEnd(22)} ${String(x).padStart(8)}${unit}  ${String(y).padStart(8)}${unit}   ${
    x != null && y != null ? (y - x >= 0 ? "+" : "") + (y - x) + unit : "—"
  }`;
console.log(`${"".padEnd(22)} ${A_LABEL.padStart(10)}  ${B_LABEL.padStart(10)}   delta`);
console.log(row("FCP", a.fcp, b.fcp));
console.log(row("LCP", a.lcp, b.lcp));
console.log(row("button in DOM", a.dom, b.dom));
console.log(row("button INTERACTIVE", a.live, b.live));
console.log(row("DEAD-TAP WINDOW", a.dead, b.dead));
console.log("  -- Download submit button --");
console.log(row("  submit in DOM", a.sDom, b.sDom));
console.log(row("  submit INTERACTIVE", a.sLive, b.sLive));
console.log(row("  submit DEAD WINDOW", a.sDead, b.sDead));
console.log(row("longest task", a.longest, b.longest));
console.log(
  row("JS before interactive", Math.round(a.js / 1024), Math.round(b.js / 1024), "kB"),
);
