/**
 * WHOSE AD IS PINNED TO THE TOP OF THE PAGE?
 *
 * Owner has switched Monetag off entirely — /api/monetag returns
 * `{"tags":[],"placements":[]}` — and reports the "in page push" still shows,
 * surviving a full PWA relaunch. Nothing in this repo injects a Monetag tag in
 * that state, so the ad belongs to somebody else.
 *
 * This names the owner of every fixed/absolute ad-shaped box near the top of the
 * viewport, by the ORIGIN of the frame inside it. Google's Auto Ads anchor unit
 * is configured in the AdSense account, not in this codebase, so it cannot be
 * switched off from here and would behave exactly like this.
 *
 * 🔴 PRODUCTION ONLY.  node scripts/who-owns-the-top-ad-probe.mjs
 */
import { chromium, devices } from "playwright";

const BASE = process.env.PROBE_BASE ?? "https://frenzsave.com";
const PATHS = (process.env.PROBE_PATHS ?? "/,/downloads").split(",");
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 25_000);

const browser = await chromium.launch();

for (const path of PATHS) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();

  const hosts = new Map();
  page.on("request", (r) => {
    try {
      const h = new URL(r.url()).host;
      if (h.endsWith("frenzsave.com")) return;
      hosts.set(h, (hosts.get(h) ?? 0) + 1);
    } catch { /* not a parseable url */ }
  });

  console.log(`\n═══ ${BASE}${path} ═══`);
  await page.goto(BASE + path, { waitUntil: "load", timeout: 90_000 }).catch(() => console.log("  (load timed out)"));
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 700); await page.waitForTimeout(400); }
  await page.waitForTimeout(SETTLE_MS);

  const boxes = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("body *, html > *")) {
      let cs;
      try { cs = getComputedStyle(el); } catch { continue; }
      if (cs.position !== "fixed" && cs.position !== "absolute") continue;
      const r = el.getBoundingClientRect();
      // Ad-shaped and near the top edge, which is where the reported one sits.
      if (r.width < 120 || r.height < 30) continue;
      if (r.top > 220) continue;
      const frames = [...el.querySelectorAll("iframe")].map((f) => f.getAttribute("src") || f.getAttribute("name") || "(srcdoc)");
      out.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        cls: typeof el.className === "string" ? el.className.slice(0, 70) : null,
        z: cs.zIndex,
        box: `${Math.round(r.width)}x${Math.round(r.height)} @ top ${Math.round(r.top)}`,
        frames: frames.slice(0, 3),
      });
    }
    return out;
  });

  console.log(`  ad-shaped boxes pinned near the top: ${boxes.length}`);
  for (const b of boxes) {
    console.log(`   <${b.tag}> id=${b.id} cls=${b.cls} z=${b.z} ${b.box}`);
    for (const f of b.frames) console.log(`       frame: ${String(f).slice(0, 120)}`);
  }

  console.log(`  third-party hosts contacted:`);
  for (const [h, n] of [...hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`    ${String(n).padStart(3)}  ${h}`);
  }

  await ctx.close();
}

await browser.close();
