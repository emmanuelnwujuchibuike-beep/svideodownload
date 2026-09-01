/*
  Does the bottom nav actually step aside on scroll?

  🔴 THIS IS THE CHECK THAT CAN SEE THE FAILURE. Every other ad probe in this
  folder depends on ExoClick choosing to fill, which is not ours to control and
  is why "is it fixed?" kept being unanswerable. The nav choreography does NOT:
  it is our own CSS transform reacting to our own scroll signal, so it is fully
  measurable on production, deterministically, with no ad involved.

  That matters because this is the regression the owner actually sees — "the
  bottom nav and banner is destroyed", "was working perfectly before". The nav
  used to hide on the PATHNAME; I re-gated it on an ad FILL that is essentially
  never true, so it stopped moving at all.

  Measures the real thing — the nav's painted position before and after a
  downward scroll — rather than reading a class name, because a class that is
  applied while the transform resolves to nothing is exactly the bug shape here.
*/

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://frenzsave.com";
const PAGES = ["/", "/history", "/tiktok-video-downloader"];

/** The nav is the fixed bar at the bottom that contains the tab links. */
const READ = () => {
  const bars = [...document.querySelectorAll("nav, div")].filter((el) => {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed") return false;
    const r = el.getBoundingClientRect();
    // Full-width, short, and anchored near the bottom of the viewport.
    return r.width > window.innerWidth * 0.9 && r.height > 20 && r.height < 140;
  });
  const describe = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      h: Math.round(r.height),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      transform: cs.transform === "none" ? "none" : cs.transform,
      links: el.querySelectorAll("a").length,
      z: cs.zIndex,
    };
  };
  return {
    bars: bars.map(describe),
    vh: window.innerHeight,
    navH: getComputedStyle(document.documentElement).getPropertyValue("--frenz-bottomnav-h").trim(),
    adH: getComputedStyle(document.documentElement).getPropertyValue("--frenz-bottomad-h").trim(),
  };
};

const browser = await chromium.launch();
let anyFail = false;

for (const path of PAGES) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  console.log(`\n${"=".repeat(66)}\n${BASE}${path}\n${"=".repeat(66)}`);
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } catch (e) {
    console.log(`  NAV FAILED: ${e.message}`);
    await ctx.close();
    continue;
  }
  await page.waitForTimeout(3500);

  const before = await page.evaluate(READ);
  // A real downward scroll, in steps, the way a reader scrolls.
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(220);
  }
  await page.waitForTimeout(900);
  const after = await page.evaluate(READ);

  console.log(`  viewport ${before.vh}px | --frenz-bottomnav-h=${before.navH || "(unset)"} --frenz-bottomad-h=${before.adH || "(unset)"}`);
  console.log(`  BEFORE scroll:`);
  for (const b of before.bars) console.log(`    h=${b.h} top=${b.top} bottom=${b.bottom} links=${b.links} z=${b.z} transform=${b.transform}`);
  console.log(`  AFTER scrolling down:`);
  for (const b of after.bars) console.log(`    h=${b.h} top=${b.top} bottom=${b.bottom} links=${b.links} z=${b.z} transform=${b.transform}`);

  // The nav is the bar with links in it. Did it move DOWN, out of the way?
  const navBefore = before.bars.find((b) => b.links >= 3);
  const navAfter = after.bars.find((b) => b.links >= 3);
  if (!navBefore || !navAfter) {
    console.log(`  ⚠️  no bottom nav found on this page (nothing to choreograph)`);
  } else if (navAfter.top > navBefore.top + 10) {
    console.log(`  🟢 NAV STEPPED ASIDE: top ${navBefore.top} -> ${navAfter.top} (+${navAfter.top - navBefore.top}px)`);
  } else {
    anyFail = true;
    console.log(`  🔴 NAV DID NOT MOVE: top ${navBefore.top} -> ${navAfter.top}. The scroll-away is dead.`);
  }
  await ctx.close();
}

await browser.close();
console.log(`\n${anyFail ? "🔴 at least one page has a dead scroll-away nav" : "🟢 every page with a nav stepped aside"}`);
