/**
 * WHAT DOES MONETAG'S IN-PAGE PUSH ACTUALLY PUT IN OUR DOM?
 *
 * Owner, 2026-09-03: "make the monetag in page push have a cooldown of 60 secs
 * when is skipped." A cooldown that starts on a SKIP needs a way to observe the
 * skip, and Monetag's In-Page Push is a self-placing widget — nothing in this
 * repo renders it, so nothing in this repo knows its markup.
 *
 * Guessing a selector is how you silently blank half a creative (see
 * scripts/hilltop-close-button-probe.mjs, same lesson). This records EVERY node
 * the page adds to <body> after load, so the widget's real container, its close
 * control and any shadow root are facts before a line of detection is written.
 *
 * 🔴 PRODUCTION ONLY — localhost is not an authorised referer for the tag.
 *
 *   node scripts/monetag-inpage-push-probe.mjs
 *   PROBE_PATHS=/,/downloads SETTLE_MS=45000 node scripts/monetag-inpage-push-probe.mjs
 */
import { chromium, devices } from "playwright";

const BASE = process.env.PROBE_BASE ?? "https://frenzsave.com";
const PATHS = (process.env.PROBE_PATHS ?? "/").split(",");
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 40_000);

/** Everything the in-page push tag is served from, so we can prove it loaded. */
const TAG_HOST = process.env.TAG_HOST ?? "nap5k.com";

const browser = await chromium.launch();

for (const path of PATHS) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });

  // Installed before ANY page script: records every node added under <body>,
  // with the paint-relevant facts (position/size/z-index) that separate an ad
  // overlay from an ordinary React portal.
  await ctx.addInitScript(() => {
    const log = [];
    window.__added = log;
    const describe = (el) => {
      let cs = null;
      try { cs = getComputedStyle(el); } catch { /* detached */ }
      const r = el.getBoundingClientRect?.() ?? { width: 0, height: 0 };
      return {
        tag: el.tagName?.toLowerCase() ?? String(el.nodeName),
        id: el.id || null,
        cls: typeof el.className === "string" ? el.className.slice(0, 90) : null,
        attrs: [...(el.attributes ?? [])].map((a) => `${a.name}=${a.value.slice(0, 70)}`).join(" ").slice(0, 220),
        pos: cs?.position ?? null,
        z: cs?.zIndex ?? null,
        w: Math.round(r.width),
        h: Math.round(r.height),
        shadow: !!el.shadowRoot,
        html: (el.outerHTML ?? "").slice(0, 400),
      };
    };
    const obs = new MutationObserver((records) => {
      for (const rec of records) {
        for (const n of rec.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (/^(SCRIPT|LINK|STYLE|META|TITLE)$/.test(n.tagName)) continue;
          log.push({ at: Date.now(), event: "added", parent: rec.target?.nodeName ?? "?", ...describe(n) });
        }
        for (const n of rec.removedNodes) {
          if (n.nodeType !== 1) continue;
          if (/^(SCRIPT|LINK|STYLE|META|TITLE)$/.test(n.tagName)) continue;
          log.push({ at: Date.now(), event: "removed", parent: rec.target?.nodeName ?? "?", ...describe(n) });
        }
      }
    });
    const start = () => obs.observe(document.documentElement, { childList: true, subtree: true });
    if (document.documentElement) start();
    else document.addEventListener("readystatechange", start, { once: true });
  });

  const page = await ctx.newPage();
  const tagRequests = [];
  page.on("request", (r) => {
    if (r.url().includes(TAG_HOST)) tagRequests.push(r.url());
  });

  console.log(`\n═══ ${BASE}${path} ═══`);
  try {
    await page.goto(BASE + path, { waitUntil: "load", timeout: 90_000 });
  } catch {
    console.log("  (page did not finish loading — continuing)");
  }

  // The widget usually needs a real interaction + some dwell before it shows.
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(SETTLE_MS);

  console.log(`  tag requests to ${TAG_HOST}: ${tagRequests.length}`);
  for (const u of tagRequests.slice(0, 5)) console.log(`    ${u}`);

  const report = await page.evaluate(() => {
    const added = window.__added ?? [];
    /* Only nodes that could be the widget: attached to body/html directly, or
       fixed-position, or carrying a shadow root, or an iframe. */
    const interesting = added.filter(
      (a) =>
        a.parent === "BODY" ||
        a.parent === "HTML" ||
        a.pos === "fixed" ||
        a.shadow ||
        a.tag === "iframe",
    );
    /* Whatever is on screen right now, top-level under body. */
    const live = [...document.body.children].filter((el) => !/^(SCRIPT|LINK|STYLE)$/.test(el.tagName)).map((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        cls: typeof el.className === "string" ? el.className.slice(0, 90) : null,
        pos: cs.position,
        z: cs.zIndex,
        display: cs.display,
        w: Math.round(r.width),
        h: Math.round(r.height),
        shadow: !!el.shadowRoot,
        shadowHtml: el.shadowRoot ? el.shadowRoot.innerHTML.slice(0, 600) : null,
      };
    });
    return { total: added.length, interesting: interesting.slice(-60), live };
  });

  console.log(`\n  ── mutations recorded: ${report.total} (showing the last ${report.interesting.length} candidates)`);
  for (const n of report.interesting) {
    console.log(`  [${n.event}] <${n.tag}> in ${n.parent} id=${n.id} cls=${n.cls} pos=${n.pos} z=${n.z} ${n.w}x${n.h} shadow=${n.shadow}`);
    if (n.attrs) console.log(`      attrs: ${n.attrs}`);
    if (n.html) console.log(`      html:  ${n.html.replace(/\s+/g, " ")}`);
  }

  console.log(`\n  ── live top-level <body> children (${report.live.length})`);
  for (const n of report.live) {
    console.log(`  <${n.tag}> id=${n.id} cls=${n.cls} pos=${n.pos} z=${n.z} display=${n.display} ${n.w}x${n.h} shadow=${n.shadow}`);
    if (n.shadowHtml) console.log(`      shadow: ${n.shadowHtml.replace(/\s+/g, " ")}`);
  }

  await ctx.close();
}

await browser.close();
