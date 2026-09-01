/*
  What TYPE is each zone being requested as, and what comes back?

  The class suffix is not decoration — their `K()` reads the zone type straight
  out of it (`parseInt(class.substring(11))`), and their loader then logs the
  exact request it sends:

      Request #0 Placement #0 was pushed with zone
        {"custom_targeting":{},"id":6016480,"extra_params":{…,"zone_type":2}}

  So if a zone was created as one product in the ExoClick dashboard but its
  snippet is pasted with another product's class, the request asks for a type
  that zone is not, and the API answers null forever — indistinguishable from
  "no demand" unless you read the request itself.

  This runs each zone ALONE, in its own browser context, and prints the type it
  asked for beside the answer it got. Same account, same minutes, so the
  comparison between zones is fair.
*/

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://frenzsave.com";
const cfg = await (await fetch(`${BASE}/api/ads/config`)).json();

const ZONES = [
  ["history / multi-format", cfg.exoclickHistory],
  ["landing", cfg.exoclickLanding],
  ["interstitial", cfg.exoclickInterstitial],
].filter(([, t]) => t?.zoneId);

const browser = await chromium.launch();

for (const [name, tag] of ZONES) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  });
  const page = await ctx.newPage();
  const pushed = [];
  const answers = [];
  page.on("console", (m) => {
    const t = m.text();
    const hit = t.match(/was pushed with zone (\{.*\})/);
    if (hit) pushed.push(hit[1]);
  });
  page.on("response", async (r) => {
    if (!/api\.php/.test(r.url())) return;
    try {
      answers.push((await r.body()).toString("utf8").slice(0, 150).replace(/\s+/g, " "));
    } catch {
      /* body gone */
    }
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.evaluate(
    async ({ cls, zoneId, src }) => {
      const host = document.createElement("div");
      host.id = "__zt";
      host.style.cssText = "width:100%;margin-top:200px";
      document.body.insertBefore(host, document.body.children[1] ?? null);
      const ins = document.createElement("ins");
      ins.className = cls;
      ins.setAttribute("data-zoneid", zoneId);
      host.appendChild(ins);
      await new Promise((res) => {
        if ([...document.scripts].some((s) => s.src === src)) return res(true);
        const el = document.createElement("script");
        el.async = true;
        el.src = src;
        el.onload = () => res(true);
        el.onerror = () => res(false);
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
  await page.waitForTimeout(9000);

  const painted = await page.evaluate(() => {
    const h = document.getElementById("__zt");
    return { h: Math.round(h.getBoundingClientRect().height), html: h.innerHTML.length };
  });

  const mine = pushed.filter((p) => p.includes(`"id":${tag.zoneId}`));
  console.log(`\n${name}  zone ${tag.zoneId}  class ${tag.cls}  (suffix ⇒ type ${tag.cls.slice(11)})`);
  console.log(`  requested as : ${mine[0] ?? "(no push logged for this zone)"}`);
  console.log(`  answered     : ${answers.find((a) => a.includes(String(tag.zoneId))) ?? answers[answers.length - 1] ?? "(none)"}`);
  console.log(`  rendered     : host=${painted.h}px html=${painted.html} ${painted.h > 0 ? "🟢" : "🔴"}`);
  await ctx.close();
}

await browser.close();
