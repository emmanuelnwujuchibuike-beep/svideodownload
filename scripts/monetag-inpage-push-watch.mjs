/**
 * WATCH the Monetag In-Page Push widget appear, then SKIP it and time what
 * happens next.
 *
 * Companion to `monetag-inpage-push-probe.mjs`, which established that the tag
 * (nap5k.com/tag.min.js, zone 11441036) does load on production. This one answers
 * the two questions a "60s cooldown on skip" actually depends on:
 *
 *   1. What node IS the widget, and is its close control reachable from our side
 *      (same-origin DOM) or sealed inside a cross-origin iframe? Guessing a
 *      selector is how you silently blank half a creative — see
 *      scripts/hilltop-close-button-probe.mjs, same lesson, same week.
 *   2. After a skip, how long does Monetag itself wait before the next one? If it
 *      already waits, a cooldown of ours is a no-op and should not be written.
 *
 * ── Attribution is by TIME, not by selector ───────────────────────────────────
 *
 * A MutationObserver armed at document-start records every element the page
 * adds. Only nodes added AFTER the nap5k script response are considered — that
 * is what separates the ad network's DOM from our own React tree without
 * needing to recognise either one by its class names.
 *
 * 🔴 PRODUCTION ONLY. localhost is not an authorised referer for the tag.
 *
 *   node scripts/monetag-inpage-push-watch.mjs
 *   PROBE_PATH=/downloads WATCH_MS=180000 node scripts/monetag-inpage-push-watch.mjs
 */
import { chromium, devices } from "playwright";

const BASE = process.env.PROBE_BASE ?? "https://frenzsave.com";
const PATH = process.env.PROBE_PATH ?? "/";
/** How long to keep looking for the widget once the tag has loaded. */
const WATCH_MS = Number(process.env.WATCH_MS ?? 120_000);
const TAG_HOST = process.env.TAG_HOST ?? "nap5k.com";

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"] });

await ctx.addInitScript(() => {
  const log = [];
  window.__added = log;
  const obs = new MutationObserver((records) => {
    for (const rec of records) {
      for (const n of rec.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (/^(SCRIPT|LINK|STYLE|META|TITLE)$/.test(n.tagName)) continue;
        log.push({ at: Date.now(), node: n });
      }
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
});

const page = await ctx.newPage();

let tagLoadedAt = 0;
page.on("response", (r) => {
  if (r.url().includes(TAG_HOST)) {
    if (!tagLoadedAt) tagLoadedAt = Date.now();
    console.log(`  ← ${r.status()} ${r.url().slice(0, 130)}`);
  }
});

console.log(`═══ ${BASE}${PATH} ═══`);
await page.goto(BASE + PATH, { waitUntil: "load", timeout: 90_000 }).catch(() => console.log("  (load timed out)"));

// A real gesture — self-placing formats usually hold until the visitor interacts.
for (let i = 0; i < 4; i++) {
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(600);
}

// Give the hook its load + idle tick, then mark the cutoff.
for (let i = 0; i < 30 && !tagLoadedAt; i++) await page.waitForTimeout(500);
if (!tagLoadedAt) {
  console.log(`\n  the ${TAG_HOST} tag never loaded on this view — nothing to watch.`);
  await ctx.close();
  await browser.close();
  process.exit(0);
}
const cutoff = tagLoadedAt;
console.log(`  tag loaded; only DOM added after this point counts as the network's.\n`);

/** Everything added after the tag loaded that is currently visible and big enough to be a push card. */
const findWidget = async (since) =>
  page.evaluate((sinceTs) => {
    const out = [];
    for (const rec of window.__added ?? []) {
      if (rec.at < sinceTs) continue;
      const el = rec.node;
      if (!el.isConnected) continue;
      let cs;
      try { cs = getComputedStyle(el); } catch { continue; }
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 30) continue;
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      const closes = [...el.querySelectorAll("*")]
        .filter((c) => {
          const t = (c.textContent ?? "").trim();
          const meta = `${c.id} ${typeof c.className === "string" ? c.className : ""} ${c.getAttribute?.("aria-label") ?? ""}`;
          return (t.length <= 3 && /[x×✕✖]/i.test(t)) || /close|dismiss|skip/i.test(meta);
        })
        .slice(0, 6)
        .map((c) => ({
          tag: c.tagName.toLowerCase(),
          id: c.id || null,
          cls: typeof c.className === "string" ? c.className.slice(0, 70) : null,
          text: (c.textContent ?? "").trim().slice(0, 12),
          html: c.outerHTML.slice(0, 200),
        }));
      out.push({
        addedAfterTagMs: rec.at - sinceTs,
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        cls: typeof el.className === "string" ? el.className.slice(0, 110) : null,
        attrs: [...(el.attributes ?? [])].map((a) => `${a.name}=${a.value.slice(0, 60)}`).join(" ").slice(0, 200),
        pos: cs.position,
        z: cs.zIndex,
        box: `${Math.round(r.width)}x${Math.round(r.height)} @ ${Math.round(r.left)},${Math.round(r.top)}`,
        isFrame: el.tagName === "IFRAME",
        frameSrc: el.tagName === "IFRAME" ? (el.getAttribute("src") ?? "").slice(0, 130) : null,
        shadow: !!el.shadowRoot,
        parent: el.parentElement ? `${el.parentElement.tagName.toLowerCase()}${el.parentElement.id ? "#" + el.parentElement.id : ""}` : null,
        closes,
        html: el.outerHTML.slice(0, 600),
      });
    }
    return out;
  }, since);

const deadline = Date.now() + WATCH_MS;
let hits = [];
while (Date.now() < deadline) {
  hits = await findWidget(cutoff);
  if (hits.length > 0) break;
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(2000);
}

if (hits.length === 0) {
  console.log(`  NO network-owned visible node appeared in ${WATCH_MS / 1000}s after the tag loaded.`);
  console.log(`  (the tag loaded but served nothing on this view — no fill, or it needs a real device/geo)`);
} else {
  console.log(`  ── ${hits.length} node(s) added by the network after the tag loaded:\n`);
  for (const h of hits) {
    console.log(`  +${h.addedAfterTagMs}ms  <${h.tag}> in ${h.parent}  id=${h.id} cls=${h.cls}`);
    console.log(`      ${h.pos} z=${h.z} ${h.box} iframe=${h.isFrame} src=${h.frameSrc} shadow=${h.shadow}`);
    if (h.attrs) console.log(`      attrs: ${h.attrs}`);
    if (h.closes.length) {
      console.log(`      CLOSE-LIKE CONTROLS:`);
      for (const c of h.closes) console.log(`        <${c.tag}> id=${c.id} cls=${c.cls} text="${c.text}" ${c.html.replace(/\s+/g, " ")}`);
    } else {
      console.log(`      no close-like control in OUR document (it may be inside a cross-origin frame)`);
    }
    console.log(`      html: ${h.html.replace(/\s+/g, " ")}\n`);
  }
}

console.log(`  ── frames on the page`);
for (const f of page.frames()) console.log(`      ${f.name() || "(unnamed)"}  ${f.url().slice(0, 130)}`);

await ctx.close();
await browser.close();
