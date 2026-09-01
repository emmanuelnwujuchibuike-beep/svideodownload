/*
  Try ANY ExoClick tag on production before wiring it into the app.

    node scripts/exoclick-try-tag.mjs eas6a97888e38 6017110

  Worth having as its own script: the difference between a zone that renders and
  one that does not has, every single time in this integration, been a property
  of the ZONE and not of our code — a type-2 banner paints on arrival, a type-37
  outstream is held shut behind ExoClick's own viewability rule. So a new tag
  should be measured on the real origin BEFORE any slot is built for it, rather
  than shipped and then debugged through the owner's eyes.

  Reports what actually lands: the response, the injected markup, the largest
  painted element, and whether it needs a scroll — the last one being what
  separates "works" from "works only if the reader happens to scroll".
*/

import { chromium } from "playwright";

const CLS = process.argv[2];
const ZONE = process.argv[3];
const SRC = process.argv[4] ?? "https://a.magsrv.com/ad-provider.js";
const BASE = process.argv[5] ?? "https://frenzsave.com";
if (!CLS || !ZONE) {
  console.log("usage: node scripts/exoclick-try-tag.mjs <class> <zoneId> [providerSrc] [baseUrl]");
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  userAgent:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();

const api = [];
page.on("response", async (r) => {
  if (!/magsrv|pemsrv|exdynsrv/.test(r.url()) || !/api\.php/.test(r.url())) return;
  try {
    api.push((await r.body()).toString("utf8").slice(0, 300).replace(/\s+/g, " "));
  } catch {
    /* body gone — not worth failing a diagnostic over */
  }
});

console.log(`${BASE} — class ${CLS}, zone ${ZONE}\n`);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(2500);

await page.evaluate(
  async ({ cls, zoneId, src }) => {
    // Mid-document and in view, NOT at top:0 — ExoClick's viewability rule is
    // `top > 0`, so a host pinned to the very top can never satisfy it.
    const host = document.createElement("div");
    host.id = "__try";
    host.style.width = "100%";
    host.style.marginTop = "200px";
    document.body.insertBefore(host, document.body.children[1] ?? null);
    const ins = document.createElement("ins");
    ins.className = cls;
    ins.setAttribute("data-zoneid", zoneId);
    host.appendChild(ins);
    await new Promise((resolve) => {
      if ([...document.scripts].some((s) => s.src === src)) return resolve(true);
      const el = document.createElement("script");
      el.async = true;
      el.type = "application/javascript";
      el.src = src;
      el.onload = () => resolve(true);
      el.onerror = () => resolve(false);
      document.head.appendChild(el);
    });
    try {
      (window.AdProvider = window.AdProvider ?? []).push({ serve: {} });
    } catch {
      /* the push is the ask */
    }
  },
  { cls: CLS, zoneId: ZONE, src: SRC },
);

const READ = () =>
  page.evaluate(() => {
    const host = document.getElementById("__try");
    const ins = host.querySelector("ins");
    let best = null;
    for (const el of host.querySelectorAll("*")) {
      if (["STYLE", "SCRIPT", "INS"].includes(el.tagName)) continue;
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (b.width < 20 || b.height < 20) continue;
      if (!best || b.width * b.height > best.w * best.h) {
        best = { tag: el.tagName, w: Math.round(b.width), h: Math.round(b.height), pos: cs.position };
      }
    }
    return {
      processed: ins?.getAttribute("data-processed") ?? null,
      hostH: Math.round(host.getBoundingClientRect().height),
      html: host.innerHTML.length,
      best,
    };
  });

for (const t of [3000, 3000, 3000]) {
  await page.waitForTimeout(t);
  const s = await READ();
  console.log(`  html=${String(s.html).padStart(6)} host=${String(s.hostH).padStart(4)}px processed=${s.processed} biggest=${s.best ? `${s.best.tag} ${s.best.w}x${s.best.h} ${s.best.pos}` : "none"}`);
}

const beforeScroll = await READ();
await page.mouse.wheel(0, 250);
await page.waitForTimeout(2500);
const afterScroll = await READ();
console.log(`  after a 250px scroll: host=${afterScroll.hostH}px biggest=${afterScroll.best ? `${afterScroll.best.tag} ${afterScroll.best.w}x${afterScroll.best.h}` : "none"}`);

console.log(`\n  --- network ---`);
for (const a of [...new Set(api)].slice(0, 4)) console.log(`  ${a}`);

console.log("");
if (beforeScroll.best) console.log(`🟢 RENDERS ON ITS OWN — ${beforeScroll.best.tag} ${beforeScroll.best.w}x${beforeScroll.best.h}, no scroll needed`);
else if (afterScroll.best) console.log(`🟠 RENDERS ONLY AFTER A SCROLL — ${afterScroll.best.tag} ${afterScroll.best.w}x${afterScroll.best.h}`);
else console.log(`🔴 nothing painted (html=${afterScroll.html}, processed=${afterScroll.processed})`);

await page.screenshot({ path: "scripts/.try-tag.png" });
await browser.close();
