/**
 * Does the REPLAYED submit actually START the download?
 *
 * The dead-tap fix had been measured twice, and neither measurement answered
 * this:
 *
 *   • dead-tap-check.mjs   — "did the app respond at all" (a validation
 *                            message, a busy button, an aria-live region).
 *                            A response is not a download.
 *   • tap-replay-probe.mjs — "was an event re-dispatched". A dispatch is not a
 *                            download either.
 *
 * What shipped on 2026-08-31 proved the NATIVE FORM SUBMIT (the page reload
 * that ate the pasted link) is gone. It never proved the replacement does the
 * job the reload was destroying. So this asks the product question end to end:
 *
 *   paste a real link BEFORE hydration → tap Download exactly once →
 *   does POST /api/metadata go out with the pasted URL, and does the result
 *   render?
 *
 * `/api/metadata` is stubbed, so the run does not depend on TikTok being up and
 * the assertion is about OUR pipeline rather than a third party's. The tap, the
 * hydration race and the replay are all real.
 *
 *   node scripts/dead-tap-starts-download.mjs http://localhost:3123/ 5
 *   STRIP=1 node scripts/dead-tap-starts-download.mjs http://localhost:3123/ 5
 *
 * STRIP=1 removes the fix from the served HTML — the control arm.
 *
 * ⚠️ TREAT THE STRIP ARM AS INDICATIVE ONLY. Without the boot script the very
 * first pre-hydration tap reloads the page, so the driver's own `fill`/`click`
 * then races a navigating document and the run ends in `setup-failed` rather
 * than in a clean number. It demonstrates the page is unusable; it does not
 * produce a comparable metric. The trustworthy comparison is this same script
 * against the same build before and after a source change.
 *
 * (The header bug fixed below — `route.fetch()` returns a DECODED body with the
 * ORIGINAL `content-encoding` header — is present in `dead-tap-check.mjs` and
 * `tap-replay-probe.mjs` too, so any STRIP figure either of those has ever
 * reported was measuring a document the browser could not decode.)
 *
 * ── 🔴 TWO MEASUREMENT TRAPS, both of which produced false failures ───────────
 *
 *  1. `framenavigated` ALSO fires for same-document App Router navigations, so
 *     it reported "RELOADED" on runs where the page provably never reloaded.
 *     A second GET for the DOCUMENT is the unambiguous signal.
 *
 *  2. Even that over-reports, because the SERVICE WORKER reloads the page once
 *     when it first takes control — about 10 seconds into a cold profile, long
 *     after the tap, and every Playwright run is a cold profile. That reload is
 *     `register-sw.tsx` working as designed and has nothing to do with the tap.
 *     So /sw.js is blocked for the run, AND a reload only counts if it lands
 *     BEFORE the download starts.
 */
import { chromium, devices } from "playwright";

const URL_ = process.argv[2] ?? "http://localhost:3123/";
const RUNS = Number(process.argv[3] ?? 5);
const STRIP = process.env.STRIP === "1";
const ARM = STRIP ? "WITHOUT fix (control)" : "WITH fix";

const PASTED = "https://www.tiktok.com/@frenz/video/7300000000000000001";
const RESULT_TITLE = "Dead-tap probe clip";

const META = {
  ok: true,
  data: {
    id: "probe-1",
    platform: "tiktok",
    platformName: "TikTok",
    sourceUrl: PASTED,
    title: RESULT_TITLE,
    description: null,
    thumbnail: null,
    durationSeconds: 12,
    creator: "frenz",
    uploadDate: null,
    viewCount: null,
    likeCount: null,
    webpageUrl: PASTED,
    extractor: "probe",
    formats: [
      {
        formatId: "probe-mp4",
        quality: "720p",
        ext: "mp4",
        url: "https://example.invalid/probe.mp4",
        filesize: 1024,
        hasAudio: true,
        hasVideo: true,
      },
    ],
  },
};

const PROBE = `window.__hydrated = (el) => !!el && Object.keys(el).some((k) => k.startsWith('__react'));`;

const results = [];

for (let run = 1; run <= RUNS; run++) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();

  let tapAt = 0;
  let firstMetaAt = 0;
  const metadataCalls = [];
  const docRequestsAt = [];

  await page.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return r.abort();
    // Trap 2: keep the service worker's one-time claim-reload out of the run.
    if (u.pathname === "/sw.js") return r.fulfill({ status: 404, body: "" });

    if (u.pathname === "/api/metadata") {
      let body = null;
      try { body = JSON.parse(r.request().postData() ?? "null"); } catch {}
      metadataCalls.push(body?.url ?? null);
      if (!firstMetaAt) firstMetaAt = Date.now();
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(META) });
    }
    if (STRIP && r.request().resourceType() === "document") {
      const res = await r.fetch();
      // Same expression tap-replay-probe.mjs uses to excise the fix.
      const re = new RegExp(
        "<script[^>]*>(?:(?!<\\/script>)[\\s\\S])*?data-no-tap-replay(?:(?!<\\/script>)[\\s\\S])*?<\\/script>",
        "g",
      );
      /*
        🔴 DROP content-encoding AND content-length.

        `route.fetch()` hands back the DECODED body but the ORIGINAL headers.
        Passing `response: res` straight to fulfill re-sends
        `content-encoding: gzip` over plain text, so the browser fails to decode
        the document and the page never becomes usable — which shows up as the
        tap timing out rather than as anything to do with the fix. The stale
        content-length is the same class of problem.
      */
      const headers = { ...res.headers() };
      delete headers["content-encoding"];
      delete headers["content-length"];
      return r.fulfill({
        status: res.status(),
        headers,
        body: (await res.text()).replace(re, ""),
      });
    }
    return r.continue();
  });

  page.on("request", (r) => {
    if (r.resourceType() === "document" && r.isNavigationRequest())
      docRequestsAt.push({ t: Date.now(), url: r.url(), method: r.method() });
  });

  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.addInitScript(PROBE);

  await page.goto(URL_, { waitUntil: "commit", timeout: 60_000 });

  let state = "never-painted";
  let resultRendered = false;
  let keptInput = false;
  try {
    await page.waitForFunction(
      () => document.querySelector('form:not([action]) button[type="submit"]'),
      null,
      { timeout: 30_000 },
    );
    const hydratedAtTap = await page.evaluate(() =>
      window.__hydrated(document.querySelector('form:not([action]) button[type="submit"]')),
    );

    // Type the link the way a finger would, then tap ONCE.
    await page.locator('form:not([action]) input').first().fill(PASTED, { timeout: 10_000 });
    tapAt = Date.now();
    await page.locator('form:not([action]) button[type="submit"]').first().click({ timeout: 10_000, force: true });
    state = hydratedAtTap ? "tapped-AFTER-hydration" : "tapped-INSIDE-dead-window";

    // Watch until the result lands, or give up. Stops early so the run does not
    // sit around long enough for unrelated late-page behaviour to muddy it.
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250);
      const s = await page
        .evaluate(
          (t) => ({
            input: (document.querySelector('form:not([action]) input') || {}).value ?? null,
            rendered: new RegExp(t, "i").test(document.body.innerText || ""),
          }),
          RESULT_TITLE,
        )
        .catch(() => null);
      if (!s) continue;
      keptInput = s.input === PASTED;
      if (s.rendered) { resultRendered = true; break; }
    }
  } catch (e) {
    state = "setup-failed: " + e.message.split("\n")[0].slice(0, 80);
  }

  /*
    A reload only counts if it landed before the download had started. Its URL
    is kept because that is what tells the two failure modes apart: a native GET
    submit carries the form's fields as a query string (`/?url=…`), anything
    else is the page reloading for its own reasons.
  */
  const offending = docRequestsAt.find((d) => d.t > tapAt && (!firstMetaAt || d.t < firstMetaAt));
  const reloadBeforeStart = !!offending;

  results.push({
    run,
    state,
    reloadBeforeStart,
    metadataCalls: metadataCalls.length,
    calledWithPastedUrl: metadataCalls.some((c) => c === PASTED),
    keptInput,
    resultRendered,
    startedAfterMs: firstMetaAt && tapAt ? firstMetaAt - tapAt : null,
    reloadedTo: offending ? offending.method + " " + offending.url.slice(0, 120) : null,
  });
  console.log("  run", run, JSON.stringify(results.at(-1)));

  await browser.close();
}

console.log(`\n================ ${ARM} — ${RUNS} runs ================`);
for (const r of results) console.log(" ", JSON.stringify(r));

const inWindow = results.filter((r) => r.state === "tapped-INSIDE-dead-window");
const started = inWindow.filter((r) => r.calledWithPastedUrl);
const rendered = inWindow.filter((r) => r.resultRendered);
console.log(
  `\nOf ${inWindow.length} taps that landed INSIDE the dead window:` +
    `\n  ${started.length} issued POST /api/metadata with the pasted URL` +
    `\n  ${rendered.length} went on to RENDER THE RESULT` +
    `\n  ${results.filter((r) => r.reloadBeforeStart).length} reloaded before the download started`,
);
