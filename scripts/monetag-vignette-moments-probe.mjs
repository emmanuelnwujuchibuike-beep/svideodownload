/**
 * DO THE MONETAG MOMENT PLACEMENTS ACTUALLY FIRE?
 *
 * Owner, 2026-09-03: "download completed, idle and fetch result doesnt trigger
 * the monetag vignatte, it suppose to instantly."
 *
 * All the vignette moments are configured to the SAME tag (n6wxm.com/vignette.min.js,
 * zone 11474434). `MonetagPlacements` appends a fresh <script> per moment, so the
 * question this answers is not "is the code reached" — it is whether the SECOND and
 * later injections of an identical loader do anything at all, which is invisible
 * from the source.
 *
 * Reports, per moment: whether the network was asked, and whether anything was
 * drawn. 🔴 PRODUCTION ONLY.
 *
 *   node scripts/monetag-vignette-moments-probe.mjs
 */
import { chromium, devices } from "playwright";

const BASE = process.env.PROBE_BASE ?? "https://frenzsave.com";
const PATH = process.env.PROBE_PATH ?? "/";
const VIGNETTE = "n6wxm.com";
const REWARD_TAG = "highperformanceformat.com";

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();

const reqs = [];
page.on("request", (r) => {
  const u = r.url();
  if (u.includes(VIGNETTE) || u.includes(REWARD_TAG)) reqs.push({ at: Date.now(), url: u });
});

const scriptsInDom = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("script[data-monetag-moment]")].map((s) => ({
      moment: s.getAttribute("data-monetag-moment"),
      src: (s.getAttribute("src") ?? "").slice(0, 60),
    })),
  );

/** Anything covering most of the viewport — a vignette is full-screen by definition. */
const fullscreenOverlay = () =>
  page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const hits = [];
    for (const el of document.querySelectorAll("body *, html > *")) {
      let cs;
      try { cs = getComputedStyle(el); } catch { continue; }
      if (cs.position !== "fixed" && cs.position !== "absolute") continue;
      if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
      const r = el.getBoundingClientRect();
      if (r.width < vw * 0.7 || r.height < vh * 0.7) continue;
      const cls = typeof el.className === "string" ? el.className : "";
      hits.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        cls: cls.slice(0, 80),
        z: cs.zIndex,
        box: `${Math.round(r.width)}x${Math.round(r.height)}`,
      });
    }
    return hits;
  });

const mark = async (label) => {
  const before = reqs.length;
  return {
    label,
    since: before,
    async report(waitMs) {
      await page.waitForTimeout(waitMs);
      const fresh = reqs.slice(before);
      const overlays = await fullscreenOverlay();
      const tags = await scriptsInDom();
      console.log(`\n── ${label}`);
      console.log(`   network calls to the ad hosts: ${fresh.length}`);
      for (const r of fresh.slice(0, 6)) console.log(`     ${r.url.slice(0, 120)}`);
      console.log(`   <script data-monetag-moment> in the DOM: ${tags.map((t) => t.moment).join(", ") || "(none)"}`);
      console.log(`   full-screen overlays on screen: ${overlays.length}`);
      for (const o of overlays) console.log(`     <${o.tag}> id=${o.id} z=${o.z} ${o.box} cls=${o.cls}`);
    },
  };
};

console.log(`═══ ${BASE}${PATH} ═══`);
await page.goto(BASE + PATH, { waitUntil: "load", timeout: 90_000 }).catch(() => console.log("  (load timed out)"));

// IDLE — MonetagPlacements arms a 4s no-interaction timer on mount.
const idle = await mark("IDLE (no interaction for 4s)");
await idle.report(14_000);

// DOWNLOAD COMPLETE — the event the completion panel dispatches.
const dl = await mark("DOWNLOAD_COMPLETE (frenz:monetag:download-complete)");
await page.evaluate(() => window.dispatchEvent(new Event("frenz:monetag:download-complete")));
await dl.report(9_000);

// REWARDED — a DIFFERENT tag, so it is the control: if this one fires and the
// vignette moments do not, the difference is the shared loader, not the wiring.
const rw = await mark("REWARDED (frenz:monetag:rewarded) — different tag, control)");
await page.evaluate(() => window.dispatchEvent(new Event("frenz:monetag:rewarded")));
await rw.report(9_000);

// INTERSTITIAL — a client navigation.
const nav = await mark("INTERSTITIAL (client navigation)");
await page.evaluate(() => history.pushState({}, "", "/pricing"));
await page.goto(BASE + "/pricing", { waitUntil: "load", timeout: 60_000 }).catch(() => {});
await nav.report(9_000);

console.log(`\n══ total ad-host requests across the run: ${reqs.length}`);
for (const r of reqs) console.log(`   ${r.url.slice(0, 130)}`);

await ctx.close();
await browser.close();
