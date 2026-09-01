/*
  Is it MULTI-FORMAT specifically, or is the whole account quiet right now?

  Owner, 2026-09-01: "the exoclick multi format link are not showing anywhere i
  put them." Every type-38 zone in the live config answers `{"zones":[null]}` —
  6017110, 6017148 and 6017150 alike — and our request is provably correct
  (`zone_type: 38`, right id, sent and answered).

  So the question is no longer about our code. It is whether type 38 is dead for
  this account while the older products still serve. Those are very different
  problems and only one of them is actionable by the owner:

    • old zones fill, 38 does not  -> the multi-format zones are not live yet
      (created but not approved/activated, or no demand attached). One thing to
      ask ExoClick, with evidence.
    • nothing fills at all         -> this visitor is frequency-capped, and no
      conclusion about any zone can be drawn from this machine today.

  The OLD zone ids are hardcoded deliberately: they are no longer all in the live
  config (the bottom-nav snippet was removed by the owner), and the point is to
  compare against products that were OBSERVED serving earlier today —
  6016708 served a 300x250 sticky, 6015606 a 19s outstream, 6016704 a fullpage
  interstitial. This is a diagnostic, not app configuration.
*/

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://frenzsave.com";
const SRC = "https://a.magsrv.com/ad-provider.js";

const CASES = [
  ["sticky      (type 17, served earlier today)", "eas6a97888e17", "6016708", SRC],
  ["outstream   (type 37, served earlier today)", "eas6a97888e37", "6015606", SRC],
  ["multiformat (type 38, history)", "eas6a97888e38", "6017110", SRC],
  ["multiformat (type 38, landing)", "eas6a97888e38", "6017148", SRC],
];

const browser = await chromium.launch();
const results = [];

for (const [name, cls, zoneId, src] of CASES) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  });
  const page = await ctx.newPage();
  const answers = [];
  page.on("response", async (r) => {
    if (!/api\.php/.test(r.url())) return;
    try {
      answers.push((await r.body()).toString("utf8"));
    } catch {
      /* body gone */
    }
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.evaluate(
    async ({ cls, zoneId, src }) => {
      const host = document.createElement("div");
      host.id = "__tc";
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
    { cls, zoneId, src },
  );
  await page.waitForTimeout(9000);

  const box = await page.evaluate(() => {
    const h = document.getElementById("__tc");
    return { h: Math.round(h.getBoundingClientRect().height), html: h.innerHTML.length };
  });
  // Did the API name THIS zone with a payload, rather than a null?
  const served = answers.some((a) => a.includes(`"idzone":${zoneId}`) && !a.includes(`"idzone":${zoneId},"type":null`));
  results.push({ name, zoneId, served, box });
  console.log(`${served ? "🟢" : "🔴"} ${name}  zone ${zoneId}  host=${box.h}px html=${box.html}  ${served ? "payload returned" : "null"}`);
  await ctx.close();
}

const old = results.filter((r) => !r.name.includes("38"));
const multi = results.filter((r) => r.name.includes("38"));
console.log("\n================ verdict ================");
if (old.some((r) => r.served) && !multi.some((r) => r.served)) {
  console.log("🔴 TYPE 38 IS THE ODD ONE OUT — older products serve, every multi-format zone returns null.");
  console.log("   That is an ExoClick-side zone state, not our integration: same account, same minutes, same request shape.");
} else if (!old.some((r) => r.served) && !multi.some((r) => r.served)) {
  console.log("⚠️ NOTHING served, old or new — this visitor is capped. No conclusion about any zone from this run.");
} else {
  console.log("🟢 multi-format served here. The zones are live; a blank slot is demand, not configuration.");
}

await browser.close();
