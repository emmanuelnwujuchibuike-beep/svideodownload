/*
  Does the outstream player need a container with HEIGHT to expand?

  The survival probe shows the history zone (6015606) delivering a real creative
  — 15926 bytes, `data-processed=true`, nine elements at 20x20 or larger — into a
  host that measures `400x0`. The creative dump showed why that is not a
  contradiction:

      DIV.zcDj1EH3_main_outstream  412x0
        DIV.zcDj1EH3_effect        412x0   pos=relative
          DIV.zcDj1EH3 exo_wrapper 412x0   pos=relative   <- the video area
          DIV.zcDj1EH3_cta_wrapper 412x48                 <- overflowing it

  The video area is 0 tall, so nothing is watchable and the CTA spills out of a
  zero-height parent. That is the owner's "the history above the grid is showing
  blank" — markup present, nothing to see.

  This is the exact thing the code comments claim in both directions: a previous
  fix added `minHeight: 180` and was reverted for reserving an empty box, and the
  reverted comment claims the collapse then "gave the player nothing to
  initialise in". Both are assertions. Neither was ever measured.

  So measure it: the SAME zone, on the SAME page, in two containers that differ
  only in whether they offer height. Separate browser contexts so the two asks
  cannot batch together or cap each other.
*/

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://frenzsave.com";
const cfg = await (await fetch(`${BASE}/api/ads/config`)).json();
const tag = cfg.exoclickHistory;
if (!tag) {
  console.log("No history zone configured.");
  process.exit(0);
}
console.log(`outstream zone ${tag.zoneId} cls ${tag.cls}\n`);

const browser = await chromium.launch();

/** @param {string} label @param {string|null} minHeight */
async function arm(label, minHeight) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2000);

  await page.evaluate(
    async ({ cls, zoneId, src, minHeight }) => {
      // Put it at the TOP of the page and in view: an outstream unit is
      // viewability-gated, and a host below the fold would confound the test.
      const host = document.createElement("div");
      host.id = "__ab";
      host.style.width = "100%";
      if (minHeight) host.style.minHeight = minHeight;
      document.body.insertBefore(host, document.body.firstChild);
      window.scrollTo(0, 0);

      const ins = document.createElement("ins");
      ins.className = cls;
      ins.setAttribute("data-zoneid", zoneId);
      host.appendChild(ins);

      await new Promise((resolve) => {
        if ([...document.scripts].some((s) => s.src === src)) return resolve(true);
        const el = document.createElement("script");
        el.async = true;
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
    { cls: tag.cls, zoneId: tag.zoneId, src: tag.src, minHeight },
  );

  const read = () =>
    page.evaluate(() => {
      const host = document.getElementById("__ab");
      const r = host.getBoundingClientRect();
      const video = host.querySelector("video, iframe");
      const vr = video?.getBoundingClientRect();
      const wrapper = host.querySelector("[class*='exo_wrapper']");
      const wr = wrapper?.getBoundingClientRect();
      return {
        hostH: Math.round(r.height),
        htmlLen: host.innerHTML.length,
        video: video ? `${video.tagName} ${Math.round(vr.width)}x${Math.round(vr.height)}` : "none",
        wrapper: wrapper ? `${Math.round(wr.width)}x${Math.round(wr.height)}` : "none",
      };
    });

  console.log(`--- ${label} ---`);
  for (const t of [4000, 8000, 14000]) {
    await page.waitForTimeout(t === 4000 ? 4000 : 4000 + (t === 14000 ? 2000 : 0));
    const s = await read();
    console.log(`  t~${t}ms  host=${s.hostH}px html=${s.htmlLen} videoEl=${s.video} exo_wrapper=${s.wrapper}`);
  }
  await ctx.close();
}

await arm("A: bare host (no height offered)", null);
await arm("B: host with min-height 200px", "200px");

await browser.close();
