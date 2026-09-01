/*
  Is the no-fill THIS ZONE, or the WHOLE ACCOUNT?

  The banner zone (6016480) is now provably asked for correctly from production —
  `data-processed=true`, a 412px-wide host, the request sent and completed — and
  ExoClick still answers `{"zones":[null]}`. That is as far as reading our own
  code can go. The next question is not answerable from the repo at all:

    • if EVERY zone returns null, the problem is account/site-level — approval,
      or the missing ExoClick ads.txt records;
    • if only SOME do, those individual zones are paused, misconfigured, or have
      no demand for this geo, and the rest should already be working.

  So this injects each configured zone's tag into the LIVE production page — the
  authorised referer, the real origin, one zone at a time in its own tab so they
  cannot batch together or mask each other — and reports what comes back for each.

  🔴 It reads the zone list from production's own /api/ads/config. Hardcoding tag
  ids here would make this a test of a stale copy of the config rather than of
  what the site is actually serving.
*/

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://frenzsave.com";

const cfgRes = await fetch(`${BASE}/api/ads/config`);
const cfg = await cfgRes.json();

const ZONES = [
  ["bottomnav   (banner)", cfg.exoclickBottomNav],
  ["history     (outstream)", cfg.exoclickHistory],
  ["sticky      ", cfg.exoclickSticky],
  ["interstitial (fullpage)", cfg.exoclickInterstitial],
].filter(([, t]) => t && t.zoneId);

console.log(`Zones configured on ${BASE}: ${ZONES.length}`);
for (const [name, t] of ZONES) console.log(`  ${name} zone=${t.zoneId} cls=${t.cls} src=${t.src}`);

const browser = await chromium.launch();

for (const [name, tag] of ZONES) {
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
    if (!/magsrv|pemsrv|exdynsrv|realsrv/.test(r.url())) return;
    if (!/api\.php|ads\?|serve/.test(r.url())) return;
    try {
      api.push((await r.body()).toString("utf8").slice(0, 260).replace(/\s+/g, " "));
    } catch {
      /* body already gone — not worth failing a diagnostic over */
    }
  });
  const logs = [];
  page.on("console", (m) => {
    const t = m.text();
    if (/zone|placement|request|no ads|served/i.test(t) && !/Content Security/.test(t)) {
      logs.push(t.slice(0, 200));
    }
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2000);

  // Inject THIS zone's tag into a clean, full-width host of its own.
  const result = await page.evaluate(
    async ({ cls, zoneId, src }) => {
      const host = document.createElement("div");
      host.style.width = "100%";
      host.id = "__sweep";
      document.body.appendChild(host);
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
        /* the push itself is the ask; a throw here is the answer */
      }

      await new Promise((r) => setTimeout(r, 9000));
      const sibs = [...host.children].filter((c) => c.tagName !== "INS");
      return {
        processed: ins.getAttribute("data-processed"),
        hostH: Math.round(host.getBoundingClientRect().height),
        hostW: Math.round(host.getBoundingClientRect().width),
        sibs: sibs.map((c) => `${c.tagName}:${Math.round(c.getBoundingClientRect().height)}px`),
        html: host.innerHTML.length,
      };
    },
    { cls: tag.cls, zoneId: tag.zoneId, src: tag.src },
  );

  const filled = result.hostH > 0 || result.sibs.some((s) => !s.endsWith(":0px"));
  console.log(`\n${"-".repeat(66)}\n${name} zone ${tag.zoneId}`);
  console.log(`  ${filled ? "🟢 FILLED" : "🔴 EMPTY"}  host ${result.hostW}x${result.hostH} processed=${result.processed} siblings=[${result.sibs.join(", ")}] htmlLen=${result.html}`);
  for (const l of [...new Set(logs)].slice(-6)) console.log(`    log: ${l}`);
  for (const a of [...new Set(api)].slice(0, 4)) console.log(`    api: ${a}`);

  await ctx.close();
}

await browser.close();
