/**
 * WHAT FRACTION OF AD ATTEMPTS ACTUALLY FIRE AN IMPRESSION?
 *
 * Owner, 2026-09-02: impressions are "stagnant" in the Hilltop dashboard. A
 * single successful probe proves the pipeline works; it does not prove it works
 * OFTEN. The impression fires from the video's `playing` event, and playback is
 * racing `startTimeoutMs` — so the number that matters is the success RATE and
 * how much headroom is left against that budget.
 *
 * Measures, per attempt: when the overlay mounted, when (or whether) the video
 * reached `playing`, and how many tracking beacons left the browser.
 *
 *   node scripts/vast-success-rate.mjs
 *   RUNS=6 node scripts/vast-success-rate.mjs
 */
import { chromium, devices } from "playwright";

const BASE = process.env.PROBE_BASE ?? "https://frenzsave.com";
const RUNS = Number(process.env.RUNS ?? 5);

const browser = await chromium.launch();
const rows = [];

for (let i = 0; i < RUNS; i++) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  let beacons = 0;
  page.on("request", (r) => {
    if (/vapid-size\.com/.test(r.url()) && r.resourceType() === "image") beacons++;
  });
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 90_000 }).catch(() => {});

  const r = await page.evaluate(async () => {
    const start = performance.now();
    let mountedAt = null;
    let playingAt = null;
    let goneAt = null;
    await new Promise((done) => {
      const tick = setInterval(() => {
        const t = Math.round(performance.now() - start);
        const root = document.querySelector('[role="dialog"][aria-label="Advertisement"]');
        if (root && mountedAt === null) mountedAt = t;
        if (root) {
          const v = root.querySelector("video");
          if (v && !v.paused && v.currentTime > 0 && playingAt === null) playingAt = t;
        } else if (mountedAt !== null && goneAt === null) {
          // Torn down. If it never played, the startup budget aborted it.
          goneAt = t;
          clearInterval(tick);
          done();
        }
        if (playingAt !== null) { clearInterval(tick); setTimeout(done, 3000); }
      }, 100);
      setTimeout(() => { clearInterval(tick); done(); }, 40000);
    });
    return { mountedAt, playingAt, goneAt };
  });

  const waited = r.playingAt !== null && r.mountedAt !== null ? r.playingAt - r.mountedAt : null;
  rows.push({ ...r, waited, beacons });
  console.log(
    `run${i + 1}  mounted ${String(r.mountedAt).padStart(6)}  playing ${String(r.playingAt).padStart(6)}` +
      `  wait-to-play ${String(waited).padStart(6)}  torn-down-unplayed ${r.goneAt ?? "-"}  beacons ${beacons}`,
  );
  await ctx.close();
}
await browser.close();

const played = rows.filter((r) => r.playingAt !== null);
const waits = played.map((r) => r.waited).filter((n) => typeof n === "number").sort((a, b) => a - b);
console.log(
  `\n=== ${played.length}/${RUNS} attempts reached PLAYING (fired an impression)` +
    `\n    wait-to-play ms: ${waits.join(", ") || "(none)"}` +
    (waits.length ? `\n    worst: ${waits[waits.length - 1]}ms against a 12000ms budget` : ""),
);
