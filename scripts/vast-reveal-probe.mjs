/**
 * Does the VAST overlay stay INVISIBLE until the ad actually plays?
 *
 * Owner, 2026-09-02: "when vast triggers it shows blank for 5 secs before
 * playing the video." The overlay is now mounted at opacity 0 and revealed on
 * the video's `playing` event, so nobody should ever see a black frame.
 *
 * Driven by the REAL trigger rather than a synthetic call: the ambient
 * interstitial fires after the configured idle threshold, so the probe simply
 * loads the page and does nothing — which is exactly the visitor behaviour that
 * fires it.
 *
 * "blankMs" is the gap between the overlay becoming VISIBLE and the video
 * PLAYING. Before the fix that was the whole load time; it must now be ~0.
 *
 *   node scripts/vast-reveal-probe.mjs
 */
import { chromium, devices } from "playwright";

const BASE = process.env.PROBE_BASE ?? "https://frenzsave.com";
const WATCH_MS = Number(process.env.WATCH_MS ?? 40000);

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();
await page.goto(BASE + "/", { waitUntil: "load", timeout: 90000 });

const result = await page.evaluate(async (watchMs) => {
  const t0 = performance.now();
  let appeared = null, firstVisible = null, firstPlaying = null;
  const trail = [];

  await new Promise((done) => {
    const tick = setInterval(() => {
      const t = Math.round(performance.now() - t0);
      const root = document.querySelector('[role="dialog"][aria-label="Advertisement"]');
      if (!root) return;
      if (appeared === null) appeared = t;
      const op = Number(getComputedStyle(root).opacity);
      const v = root.querySelector("video");
      const playing = !!v && !v.paused && v.currentTime > 0;
      if (op > 0.5 && firstVisible === null) firstVisible = t;
      if (playing && firstPlaying === null) firstPlaying = t;
      if (trail.length < 60) trail.push(t + ":op=" + op.toFixed(2) + (playing ? ",PLAY" : ""));
      if (firstVisible !== null && firstPlaying !== null) { clearInterval(tick); done(); }
    }, 100);
    setTimeout(() => { clearInterval(tick); done(); }, watchMs);
  });

  return {
    overlayMountedAt: appeared,
    becameVisibleAt: firstVisible,
    videoPlayingAt: firstPlaying,
    blankMs: firstVisible !== null && firstPlaying !== null ? firstPlaying - firstVisible : null,
    hiddenWhileLoadingMs: firstVisible !== null && appeared !== null ? firstVisible - appeared : null,
    trail: trail.slice(0, 30),
  };
}, WATCH_MS);

console.log(JSON.stringify(result, null, 1));
await browser.close();
