/**
 * Does an impression pixel actually LEAVE THE BROWSER when the ad plays?
 *
 * Owner, 2026-09-02: "recomfirm if the hiltop vast video ad still reads because
 * for the past few hours i have had a stagnant impression in my hiltop
 * dashboard."
 *
 * Every other probe so far has checked that the ad RESOLVES, that it PLAYS, or
 * that the overlay REVEALS. None of them checked the only thing Hilltop's
 * dashboard actually counts: the `<Impression>` request hitting vapid-size.com.
 * This watches the wire for it.
 *
 *   node scripts/vast-impression-probe.mjs
 */
import { chromium, devices } from "playwright";

const BASE = process.env.PROBE_BASE ?? "https://frenzsave.com";
const WATCH_MS = Number(process.env.WATCH_MS ?? 45000);

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();

const beacons = [];
page.on("request", (r) => {
  const u = r.url();
  if (!/vapid-size\.com/.test(u)) return;
  // The tag URL itself is the ad REQUEST; everything else on that host is a
  // tracking beacon fired by the player.
  beacons.push({ t: Date.now(), type: r.resourceType(), url: u.slice(0, 90) });
});
page.on("response", async (r) => {
  if (/vapid-size\.com/.test(r.url())) {
    const b = beacons.find((x) => r.url().startsWith(x.url.slice(0, 60)));
    if (b) b.status = r.status();
  }
});

const t0 = Date.now();
await page.goto(BASE + "/", { waitUntil: "load", timeout: 90_000 });

const state = await page.evaluate(async (watchMs) => {
  const start = performance.now();
  let playingAt = null;
  await new Promise((done) => {
    const tick = setInterval(() => {
      const root = document.querySelector('[role="dialog"][aria-label="Advertisement"]');
      const v = root?.querySelector("video");
      if (v && !v.paused && v.currentTime > 0 && playingAt === null) {
        playingAt = Math.round(performance.now() - start);
        clearInterval(tick);
        // Give the pixels a moment to leave.
        setTimeout(done, 3000);
      }
    }, 100);
    setTimeout(() => { clearInterval(tick); done(); }, watchMs);
  });
  return { playingAt };
}, WATCH_MS);

console.log("video reached PLAYING at:", state.playingAt ?? "(never)");
console.log("\nvapid-size.com traffic (" + beacons.length + " requests):");
for (const b of beacons) {
  console.log(`  +${String(b.t - t0).padStart(6)}ms  ${String(b.status ?? "-").padStart(3)}  ${b.type.padEnd(6)}  ${b.url}`);
}
const imageBeacons = beacons.filter((b) => b.type === "image");
console.log("\nIMPRESSION/TRACKING pixels fired: " + imageBeacons.length);
console.log(imageBeacons.length > 0 ? "✅ beacons ARE leaving the browser" : "🔴 NO tracking pixel fired");
await browser.close();
