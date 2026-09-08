/**
 * SEE the Frenz AI hub, rather than assert it compiles.
 *
 * The AI Clean card is entirely inline SVG and CSS — gradients, a beam, drifting
 * chips, a circuit trace. Every one of those can compile, typecheck, pass tests
 * and render NOTHING: this codebase already lost time to an SVG gradient that
 * painted nothing because its element had a zero-area bounding box, which is
 * invisible in review and obvious in a screenshot.
 *
 *   node scripts/frenz-ai-shots.mjs http://localhost:3123
 *
 * Shots land in %TEMP%/navshots. The Studio route needs a session, so this
 * photographs the hub through a scratch page that mounts the same component —
 * see PROBE_ROUTE. Nothing here ships.
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = (process.argv[2] ?? "http://localhost:3123").replace(/\/$/, "");
const OUT = process.argv[3] ?? "C:/Users/u/AppData/Local/Temp/navshots";
mkdirSync(OUT, { recursive: true });

const PROBE_ROUTE = "/zz-frenz-ai-probe";

const SHOTS = [
  { name: "hub-mobile-light", device: "Pixel 7", theme: "light" },
  { name: "hub-mobile-dark", device: "Pixel 7", theme: "dark" },
  { name: "hub-desktop-light", device: null, theme: "light" },
  { name: "welcome-mobile-light", device: "Pixel 7", theme: "light", query: "?view=welcome", ready: "text=Try AI Clean" },
  { name: "input-mobile-light", device: "Pixel 7", theme: "light", query: "?view=input", ready: "text=AI Powered" },
  { name: "processing-mobile-light", device: "Pixel 7", theme: "light", query: "?view=processing" },
  { name: "processing-mobile-dark", device: "Pixel 7", theme: "dark", query: "?view=processing" },
];

const browser = await chromium.launch();

for (const shot of SHOTS) {
  const ctx = await browser.newContext({
    ...(shot.device ? devices[shot.device] : { viewport: { width: 1280, height: 1000 } }),
    colorScheme: shot.theme,
  });
  const page = await ctx.newPage();

  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url().slice(0, 120)}`));

  await page.goto(`${BASE}${PROBE_ROUTE}${shot.query ?? ""}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  /*
    🔴 Wait for something only THIS view renders. The first run of the
    processing shots silently photographed the HUB instead — the harness had
    dropped the query string, and a generic selector was happy either way. A
    screenshot of the wrong page is worse than no screenshot, because it looks
    like evidence.
  */
  await page.waitForSelector(shot.ready ?? (shot.query ? "text=Pro Tip" : "section.group"), { timeout: 30_000 });
  // Let one beat of the ambient animation land, so a paused/never-started
  // animation is visible as a difference between runs rather than invisible.
  await page.waitForTimeout(1200);

  /*
    🔴 The assertions a screenshot alone cannot make. A gradient that renders
    nothing still occupies layout, so "the element exists" proves very little —
    these read what the browser actually PAINTED.
  */
  const audit = await page.evaluate(() => {
    const out = {};
    const card = document.querySelector("section.group") ?? document.querySelector("ol");
    out.cardFound = !!card;
    if (card) {
      const r = card.getBoundingClientRect();
      out.cardSize = `${Math.round(r.width)}x${Math.round(r.height)}`;
      out.cardOverflowsViewport = r.width > window.innerWidth + 1;
    }
    // Every SVG stroke that references a gradient: does its element have area?
    out.zeroAreaGradientStrokes = [...document.querySelectorAll("svg [stroke^='url(']")]
      .map((el) => {
        try {
          const b = el.getBBox();
          return b.width === 0 || b.height === 0 ? el.tagName : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    out.animatedNow = document.getAnimations().filter((a) => a.playState === "running").length;
    // The horizontal-scroll law: the page body must never scroll sideways.
    out.bodyScrollsX = document.documentElement.scrollWidth > window.innerWidth + 1;
    return out;
  });

  await page.screenshot({ path: `${OUT}/frenz-ai-${shot.name}.png`, fullPage: true });

  console.log(`\n── ${shot.name} ──`);
  console.log("  card             ", audit.cardFound ? audit.cardSize : "🔴 NOT FOUND");
  console.log("  zero-area grads  ", audit.zeroAreaGradientStrokes.length ? `🔴 ${audit.zeroAreaGradientStrokes}` : "none");
  console.log("  running anims    ", audit.animatedNow);
  console.log("  body scrolls x   ", audit.bodyScrollsX ? "🔴 YES" : "no");
  console.log("  card overflows   ", audit.cardOverflowsViewport ? "🔴 YES" : "no");
  if (problems.length) console.log("  page problems    ", problems.slice(0, 5));

  await ctx.close();
}

/* Reduced motion must stop everything — the battery rule, verified not assumed. */
{
  const ctx = await browser.newContext({ ...devices["Pixel 7"], reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${PROBE_ROUTE}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(800);
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
  await page.screenshot({ path: `${OUT}/frenz-ai-hub-reduced-motion.png`, fullPage: true });
  console.log("\n── prefers-reduced-motion ──");
  console.log("  running anims    ", running === 0 ? "0 ✅" : `🔴 ${running} still running`);
  await ctx.close();
}

await browser.close();
console.log(`\nshots → ${OUT}`);
