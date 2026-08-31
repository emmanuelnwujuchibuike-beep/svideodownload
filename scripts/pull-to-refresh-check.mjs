/**
 * Does the drag-down-to-refresh gesture actually fire, on every page it is
 * supposed to be on?
 *
 * `PageRefresh` is mounted in both route-group layouts, so by inspection every
 * page has it. This asks the only question that matters — whether a real finger
 * drag produces the indicator AND a refresh — because "it is mounted" and "it
 * works" have been different answers in this codebase before.
 *
 * Real CDP touch events, not synthetic React ones: the handler reads
 * `window.scrollY` and `e.touches[0].clientY`, so a fake event would prove
 * nothing about the gesture a thumb produces.
 *
 *   node scripts/pull-to-refresh-check.mjs http://localhost:3123
 */
import { chromium, devices } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3123";

/** Pages the owner named, plus the ones deliberately opted out. */
const ROUTES = [
  { path: "/", expect: "yes", note: "landing" },
  { path: "/downloads", expect: "yes", note: "download hub (auth — may redirect)" },
  { path: "/history", expect: "yes", note: "history" },
  { path: "/pricing", expect: "yes", note: "a plain marketing page" },
  { path: "/reels", expect: "opted-out", note: "owns its vertical gesture" },
  { path: "/home", expect: "opted-out", note: "SmartFeed has its own handler" },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"], hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await page.route("**/*", (r) => {
  const h = new URL(r.request().url()).hostname;
  if (h !== "localhost" && h !== "127.0.0.1") return r.abort();
  if (new URL(r.request().url()).pathname === "/sw.js") return r.fulfill({ status: 404, body: "" });
  return r.continue();
});

const cdp = await ctx.newCDPSession(page);

/** One slow downward drag from near the top of the screen. */
async function dragDown(fromY = 120, toY = 420, steps = 14) {
  const x = 200;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y: fromY }],
  });
  for (let i = 1; i <= steps; i++) {
    const y = fromY + ((toY - fromY) * i) / steps;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    await page.waitForTimeout(16);
  }
  return async () => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
}

console.log("route            expected     indicator  refreshed  verdict");
console.log("──────────────────────────────────────────────────────────────");

for (const route of ROUTES) {
  let rscRequests = 0;
  const onReq = (r) => {
    // router.refresh() re-fetches the route's RSC payload.
    if (r.url().includes("_rsc=") || r.headers()["rsc"] === "1") rscRequests++;
  };

  let status = "?";
  try {
    const resp = await page.goto(BASE + route.path, { waitUntil: "load", timeout: 45_000 });
    status = String(resp?.status() ?? "?");
  } catch {
    console.log(`${route.path.padEnd(16)} ${route.expect.padEnd(12)} — could not load`);
    continue;
  }
  await page.waitForTimeout(1800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);

  page.on("request", onReq);
  const release = await dragDown();
  // Peak of the pull, before touchEnd — the indicator only exists mid-gesture.
  const indicator = await page.evaluate(() => {
    for (const el of document.querySelectorAll("div[aria-hidden]")) {
      const cs = getComputedStyle(el);
      if (cs.position !== "absolute") continue;
      const h = el.getBoundingClientRect().height;
      // The indicator is a logo — an <img> in this app, not an inline <svg>.
      if (h > 4 && Number(cs.opacity) > 0.5 && el.querySelector("img, svg")) return Math.round(h);
    }
    return 0;
  });
  await release();
  await page.waitForTimeout(2500);
  page.off("request", onReq);

  const refreshed = rscRequests > 0;
  const got = indicator > 0 ? "yes" : "no";
  const ok =
    route.expect === "yes" ? indicator > 0 && refreshed : indicator === 0;
  console.log(
    `${route.path.padEnd(16)} ${route.expect.padEnd(12)} ${String(indicator > 0 ? indicator + "px" : "none").padEnd(10)} ${String(refreshed).padEnd(10)} ${ok ? "✅" : "❌"}  (${route.note}${status !== "200" ? `, http ${status}` : ""})`,
  );
  void got;
}

await browser.close();
