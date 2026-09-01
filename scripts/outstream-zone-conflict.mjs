/*
  Owner's hypothesis: "could it be a conflict in one spot?"

  Worth taking seriously, because every outstream probe so far has been run on a
  page that ALREADY carries the bottom-nav zone's <ins>, and their loader batches
  zones into one request — its own log says "Zones Batch Size: 10, Multi-zones
  Batch Size: 3". So the outstream has never once been observed ALONE.

  What is established: zone 6015606 serves a real 19s 1280x720 creative, loads it
  fully (readyState 4, no error), and is then held shut by their own CSS —
  `._effect { max-height: 0 }`, released only by the class `.exo_wrapper_show`
  that their script adds on viewability. Neither `min-height` on our container
  nor real scrolling changed it.

  This isolates the variable. `/login` is on AppBottomAd's exclusion list, so it
  mounts NO bottom-nav bar and no other ExoClick zone — the outstream is the only
  unit on the page. Compared against `/`, where the bottom-nav zone is present.

  Reports the one thing that decides it: does `.exo_wrapper_show` ever appear.
*/

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://frenzsave.com";
const cfg = await (await fetch(`${BASE}/api/ads/config`)).json();
const tag = cfg.exoclickHistory;

const browser = await chromium.launch();

async function run(label, path) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3000);

  const preexisting = await page.evaluate(() => document.querySelectorAll("ins[data-zoneid]").length);

  await page.evaluate(
    async ({ cls, zoneId, src }) => {
      const host = document.createElement("div");
      host.id = "__oc";
      host.style.width = "100%";
      // Top of the document and in view — an outstream unit is viewability-gated.
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
    { cls: tag.cls, zoneId: tag.zoneId, src: tag.src },
  );

  const read = () =>
    page.evaluate(() => {
      const host = document.getElementById("__oc");
      const eff = host?.querySelector("[class*='_effect']");
      const v = host?.querySelector("video");
      return {
        hostH: Math.round(host?.getBoundingClientRect().height ?? -1),
        effClass: eff?.className ?? "(no _effect yet)",
        show: eff ? /exo_wrapper_show/.test(eff.className) : false,
        maxH: eff ? getComputedStyle(eff).maxHeight : "n/a",
        videoH: v ? Math.round(v.getBoundingClientRect().height) : -1,
        paused: v?.paused ?? null,
        html: host?.innerHTML.length ?? 0,
      };
    });

  console.log(`\n--- ${label}  (${path}, pre-existing <ins>: ${preexisting}) ---`);
  for (const wait of [5000, 5000, 6000]) {
    await page.waitForTimeout(wait);
    const s = await read();
    console.log(
      `  host=${s.hostH}px video=${s.videoH}px paused=${s.paused} maxH=${s.maxH} show=${s.show} html=${s.html}`,
    );
  }
  // Scroll it through the viewport, in case viewability needs movement.
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(1500);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(3000);
  const s = await read();
  console.log(`  after scroll-through: host=${s.hostH}px video=${s.videoH}px show=${s.show} maxH=${s.maxH}`);
  await ctx.close();
  return s;
}

const alone = await run("A: outstream ALONE (no other ExoClick zone)", "/login");
const withOthers = await run("B: outstream alongside the bottom-nav zone", "/");

console.log("\n================ verdict ================");
if (alone.show && !withOthers.show) {
  console.log("🟢 CONFLICT CONFIRMED: the outstream opens alone and stays shut beside another zone.");
} else if (alone.show && withOthers.show) {
  console.log("🟢 the outstream opened in BOTH — the earlier probes were missing something else.");
} else {
  console.log("🔴 it stayed shut in BOTH — not a zone conflict; their viewability gate never releases.");
}

await browser.close();
