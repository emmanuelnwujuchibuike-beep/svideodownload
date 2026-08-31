/**
 * Does a tap that lands BEFORE hydration actually do anything?
 *
 * This is the measurement the dead-tap fix is accountable to. It is deliberately
 * NOT "how fast does the button hydrate" — that number was chased for two
 * sessions and is the wrong one: −243 kB of first-load JS moved it by 2ms.
 * What the owner reports is that a press does nothing and has to be repeated,
 * so what gets measured here is whether ONE press is honoured.
 *
 * Method, per run:
 *   1. load the page throttled (slow-4G + 4× CPU, Pixel 7),
 *   2. wait for the Download button to be PAINTED but NOT yet hydrated —
 *      i.e. land inside the dead window on purpose,
 *   3. tap it exactly once, the way a finger would,
 *   4. watch for the app to respond at all — the paste field reporting a
 *      validation error, a preview/preparing state, any aria-live message, or
 *      the form's own busy state.
 *
 * A run counts as ANSWERED only if that response appears. Without the fix the
 * tap is swallowed and nothing ever happens, which is the bug.
 *
 *   node scripts/dead-tap-check.mjs http://localhost:3123/ 5
 */
import { chromium, devices } from "playwright";

const URL_ = process.argv[2] ?? "http://localhost:3123/";
const RUNS = Number(process.argv[3] ?? 5);
/** STRIP=1 removes the fix from the served HTML — the "before" arm. */
const STRIP = process.env.STRIP === "1";
const ARM = STRIP ? "WITHOUT fix" : "WITH fix";

const PROBE = `
  window.__hydrated = (el) => !!el && Object.keys(el).some((k) => k.startsWith('__react'));
  /* Any sign the app reacted to the press. Recorded from the page so a response
     that appears and disappears between driver polls is still caught. */
  window.__answered = false;
  window.__answerNote = null;
  (function () {
    const check = () => {
      if (window.__answered) return;
      const f = document.querySelector('form');
      if (!f) return;
      const txt = f.innerText || "";
      if (/paste a link|enter a link|invalid|not supported|unsupported|required|couldn't|could not|try again/i.test(txt)) {
        window.__answered = true; window.__answerNote = "validation message";
        return;
      }
      if (document.querySelector('[role="alert"], [aria-live="polite"]:not(:empty), [aria-live="assertive"]:not(:empty)')) {
        window.__answered = true; window.__answerNote = "aria-live region";
        return;
      }
      const b = document.querySelector('button[type="submit"]');
      if (b && (b.disabled || b.getAttribute('aria-busy') === 'true')) {
        window.__answered = true; window.__answerNote = "submit entered busy state";
        return;
      }
      if (/fetching|preparing|analy/i.test(txt)) {
        window.__answered = true; window.__answerNote = "fetching/preparing state";
      }
    };
    new MutationObserver(check).observe(document.documentElement, {
      subtree: true, childList: true, characterData: true, attributes: true,
    });
    setInterval(check, 50);
  })();
`;

async function once(browser, i) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  // Third-party ad creatives are non-deterministic and have navigated this page
  // away mid-run before; the dead window is an origin-only question.
  await page.route("**/*", async (route) => {
    const req = route.request();
    const h = new URL(req.url()).hostname;
    if (h !== "localhost" && h !== "127.0.0.1") return route.abort();

    /*
      A/B WITHOUT A SECOND BUILD.

      The fix is one inline <head> script, so the "before" arm is the same
      build with that script stripped out of the served document. Both arms
      therefore run identical bytes, identical chunk hashes and identical
      server state — the only difference is the thing under test, which is
      exactly what an interleaved A/B is trying to achieve and what two
      separately-compiled builds cannot quite promise.
    */
    if (!STRIP || req.resourceType() !== "document") return route.continue();
    const res = await route.fetch();
    let body = await res.text();
    body = body.replace(
      /<script[^>]*>(?:(?!<\/script>)[\s\S])*?data-no-tap-replay(?:(?!<\/script>)[\s\S])*?<\/script>/g,
      "",
    );
    return route.fulfill({ response: res, body });
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

  /* The decisive signal: a pre-hydration tap on an action-less React form is
     handled by the BROWSER as a native GET submit, which RELOADS the page and
     throws the pasted link away. Any navigation after the tap is that bug. */
  const navs = [];
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) navs.push({ url: f.url(), t: Date.now() });
  });
  await page.goto(URL_, { waitUntil: "commit", timeout: 60_000 });

  const SEL = 'button[type="submit"]';
  // Land inside the dead window: painted, not hydrated.
  const deadline = Date.now() + 30_000;
  let state = "never-painted";
  while (Date.now() < deadline) {
    const s = await page
      .evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return "absent";
        return window.__hydrated(el) ? "hydrated" : "painted";
      }, SEL)
      .catch(() => "absent");
    /* 🔴 MUST yield. A tight evaluate() loop competes with the very hydration
       it is watching for: on a 4x-throttled CPU it starved the main thread and
       produced runs where the button never hydrated inside 30s. This project
       has already been burned once by driver-side polling distorting exactly
       this measurement. */
    if (s !== "painted" && s !== "hydrated") { await page.waitForTimeout(50); continue; }
    if (s === "painted") {
      state = "painted";
      break;
    }
    if (s === "hydrated") {
      state = "missed-window";
      break;
    }
  }

  let tappedAt = null;
  let tapAtWall = null;
  let clickErr = null;
  if (state === "painted") {
    /* A REAL link. An invalid one makes the browser block the native submit
       with its own validation bubble, which hides the reload this is measuring.

       Set through the NATIVE value setter rather than page.fill(): fill() runs
       actionability checks that cannot pass on a page mid-hydration. */
    await page
      .evaluate(() => {
        const el = document.querySelector('input[type="url"], input[type="text"]');
        if (!el) return;
        const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
        d.set.call(el, "https://www.tiktok.com/@user/video/1234567890");
        el.dispatchEvent(new Event("input", { bubbles: true }));
      })
      .catch(() => {});

    /*
      🔴 A RAW MOUSE CLICK, not page.click().

      page.click() waits for the element to be visible, ENABLED, STABLE (same
      box two frames running) and hitting the hit-test. On a 4x-throttled page
      that is still hydrating, "stable" never arrives: every run timed out at
      5s and NOTHING WAS EVER TAPPED, so the first version of this script was
      reporting 0/5 answered for a tap that never happened.

      page.mouse.click dispatches a real trusted press at coordinates with no
      actionability wait — which is exactly what a finger does.
    */
    /*
      🔴 THE TAP IS DISPATCHED IN-PAGE, and that is deliberate.

      Two Playwright paths were tried and both measured the harness rather than
      the product: page.click() waits for the element to be "stable" (same box
      two frames running), which never happens on a 4x-throttled page mid-
      hydration — every run timed out at 5s and nothing was ever tapped — and
      locator().boundingBox() failed the same way.

      el.click() is the same code path a finger takes for everything that
      matters here: it fires a bubbling click event that the capture listener
      sees, and on a submit button it triggers the browser native form
      submission. Only isTrusted differs, and nothing under test reads it.
    */
    const res = await page
      .evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return { ok: false, err: "button missing" };
        const t = Math.round(performance.now());
        el.click();
        return { ok: true, t };
      }, SEL)
      .catch((e) => ({ ok: false, err: String(e.message).split(String.fromCharCode(10))[0] }));
    if (res.ok) {
      tappedAt = res.t;
      tapAtWall = Date.now();
    } else {
      clickErr = res.err;
    }
  }

  // Give the page well past hydration to answer.
  await page.waitForTimeout(12_000);
  const out = await page.evaluate(() => ({
    answered: window.__answered,
    note: window.__answerNote,
  })).catch(() => ({ answered: false, note: "page navigated away" }));
  const post = tapAtWall === null ? [] : navs.filter((n) => n.t > tapAtWall);
  const reloaded = post.length > 0;
  const postUrls = post.map((n) => n.url.replace(/^https?:..[^/]+/, "")).join(" ");
  await ctx.close();
  return { state, tappedAt, reloaded, postUrls, clickErr, ...out };
}

const browser = await chromium.launch();
const rows = [];
for (let i = 0; i < RUNS; i++) {
  const r = await once(browser, i);
  rows.push(r);
  console.log(
    `[${ARM}] run${i + 1}  window=${r.state}  tapped@${r.tappedAt ?? "-"}ms  RELOADED=${r.reloaded}  ANSWERED=${r.answered}` +
      (r.clickErr ? `  CLICK-ERR=${r.clickErr}` : "") + (r.note ? `  (${r.note})` : ""),
  );
}
await browser.close();

const inWindow = rows.filter((r) => r.state === "painted");
const answered = inWindow.filter((r) => r.answered);
console.log(
  `\n[${ARM}] taps landed inside the dead window: ${inWindow.length}/${rows.length}` +
    `\n[${ARM}] of those, RELOADED the page (tap lost): ${inWindow.filter((r) => r.reloaded).length}/${inWindow.length}` +
    `\n[${ARM}] of those, ANSWERED: ${answered.length}/${inWindow.length}`,
);
