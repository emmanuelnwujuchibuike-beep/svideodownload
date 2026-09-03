/**
 * WHAT IS THE CLOSE BUTTON HilltopAds RENDERS INSIDE OUR SLOT?
 *
 * Owner, 2026-09-02: "remove the close(x button embeded on the video slider in
 * history and landing" — and, importantly, "before some wasnt showing x exit",
 * so it is inconsistent between slots.
 *
 * We cannot hide it without knowing its markup, and guessing a selector is how
 * you silently blank half a creative. `HilltopSlot` renders the tag inside an
 * `srcdoc` iframe with `allow-same-origin`, so the frame's document IS readable
 * from here — this reads it and prints what is actually there.
 *
 * 🔴 PRODUCTION ONLY. localhost is not an authorised ad referer, so the slot
 * does not fill there at all.
 *
 *   node scripts/hilltop-close-button-probe.mjs
 *   PROBE_PATHS=/,/history node scripts/hilltop-close-button-probe.mjs
 */
import { chromium, devices } from "playwright";

const BASE = process.env.PROBE_BASE ?? "https://frenzsave.com";
const PATHS = (process.env.PROBE_PATHS ?? "/,/history,/downloads").split(",");
/** How long to let the network's script run before reading the frame. */
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 9000);

const browser = await chromium.launch();

for (const path of PATHS) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  console.log(`\n═══ ${BASE}${path} ═══`);

  try {
    await page.goto(BASE + path, { waitUntil: "load", timeout: 90_000 });
  } catch {
    console.log("  (page did not finish loading — continuing anyway)");
  }

  // The slots are lazy: they hold their script until near the viewport.
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(SETTLE_MS);

  const found = await page.evaluate(() => {
    const out = [];
    const frames = [...document.querySelectorAll('iframe[title="Advertisement"]')];
    for (const [i, f] of frames.entries()) {
      const entry = { index: i, width: f.clientWidth, height: f.clientHeight, readable: false, nodes: [] };
      let doc = null;
      try {
        doc = f.contentDocument;
      } catch {
        /* cross-origin after the tag navigated the frame */
      }
      if (!doc || !doc.body) {
        out.push(entry);
        continue;
      }
      entry.readable = true;

      /*
        Everything small and clickable, plus anything whose text or attributes
        look like a dismiss control. Reported as raw facts — tag, id, class,
        text, size — rather than as a guess at which one is "the" button.
      */
      const all = [...doc.body.querySelectorAll("*")];
      for (const el of all) {
        const r = el.getBoundingClientRect();
        const text = (el.textContent ?? "").trim().slice(0, 24);
        const attrs = [...el.attributes].map((a) => `${a.name}="${a.value.slice(0, 60)}"`).join(" ");
        const looksClosey =
          /close|dismiss|skip|exit|×|✕|✖|x/i.test(`${el.id} ${el.className} ${text}`) &&
          text.length <= 4;
        const smallAndClickable =
          r.width > 0 && r.width <= 48 && r.height > 0 && r.height <= 48 &&
          (el.tagName === "BUTTON" || el.tagName === "A" || el.tagName === "SPAN" || el.tagName === "DIV");
        if (looksClosey || smallAndClickable) {
          entry.nodes.push({
            tag: el.tagName.toLowerCase(),
            id: el.id || null,
            cls: typeof el.className === "string" ? el.className.slice(0, 80) : null,
            text,
            w: Math.round(r.width),
            h: Math.round(r.height),
            attrs: attrs.slice(0, 160),
          });
        }
      }
      entry.bodyHtml = doc.body.innerHTML.slice(0, 900);
      out.push(entry);
    }
    return out;
  });

  if (found.length === 0) {
    console.log("  no Advertisement iframes on this page (slot unfilled or not reached)");
  }
  for (const f of found) {
    console.log(`\n  frame #${f.index}  ${f.width}x${f.height}  readable=${f.readable}`);
    if (!f.readable) {
      console.log("    frame document is not readable from here — the tag navigated it cross-origin.");
      continue;
    }
    if (f.nodes.length === 0) console.log("    no close-like or small clickable nodes found");
    for (const n of f.nodes) {
      console.log(`    <${n.tag}> id=${n.id} class=${n.cls} text="${n.text}" ${n.w}x${n.h}`);
      console.log(`        ${n.attrs}`);
    }
    console.log(`    --- body (first 900 chars) ---\n    ${f.bodyHtml?.replace(/\n/g, " ").slice(0, 900)}`);
  }

  await ctx.close();
}

await browser.close();
