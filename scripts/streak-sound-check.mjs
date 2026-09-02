/**
 * Does the milestone cue actually PLAY?
 *
 * `sound-fx.test.ts` proves the tone data is sane. It cannot prove the sound
 * reaches a speaker: that depends on the master preference, on the browser's
 * autoplay policy, and on the chip not having taken the claim first. Those are
 * exactly the ways a sound ships silent — and a silent celebration looks
 * identical to a working one in every test and every screenshot.
 *
 * So this drives a real browser and taps the real Web Audio graph: every
 * oscillator the page creates is recorded with its frequency and waveform, and
 * the run asserts the MILESTONE frequencies fired and the daily ones did not.
 *
 *   node scripts/streak-sound-check.mjs http://localhost:3123/
 */
import { chromium, devices } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3123/";

/** Record every oscillator the page builds, before any app code runs. */
const TAP = `
  window.__osc = [];
  for (const Ctor of [window.AudioContext, window.webkitAudioContext].filter(Boolean)) {
    const make = Ctor.prototype.createOscillator;
    Ctor.prototype.createOscillator = function () {
      const osc = make.call(this);
      const rec = { freq: null, wave: null };
      window.__osc.push(rec);
      const startFn = osc.start.bind(osc);
      osc.start = function (...a) {
        rec.freq = Math.round(osc.frequency.value);
        rec.wave = osc.type;
        return startFn(...a);
      };
      return osc;
    };
  }
`;

function state(currentStreak, shouldCelebrate) {
  const today = "2026-08-31";
  return {
    currentStreak,
    longestStreak: Math.max(currentStreak, 12),
    lastActivityDate: today,
    streakStartedAt: today,
    totalActiveDays: currentStreak,
    timezone: "Africa/Lagos",
    restoreDeadline: null,
    lastCelebrationDate: null,
    lastReminderDate: null,
    restoresUsed: 0,
    status: "ACTIVE",
    shouldCelebrate,
    canRestore: false,
    restorableStreak: 0,
    today,
    week: [],
  };
}

async function run(streak) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  await page.addInitScript(TAP);

  await page.route("**/*", (r) => {
    const h = new URL(r.request().url()).hostname;
    return h === "localhost" || h === "127.0.0.1" ? r.continue() : r.abort();
  });
  await page.route("**/api/streak/celebrated", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await page.route("**/api/streak", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(state(streak, true)),
    }),
  );

  await page.goto(BASE, { waitUntil: "commit", timeout: 90_000 });

  /*
    🔴 A REAL GESTURE FIRST.

    An AudioContext starts suspended and can only be resumed from a genuine
    user gesture. Without this the ceremony would be silent HERE and perfectly
    audible for a real visitor (who has tapped something to get to day 7), and
    the check would report a bug that does not exist.
  */
  await page.mouse.click(5, 5);

  // The daily celebration is deleted (2026-09-01); the unlock ceremony is the
  // only overlay that can make a noise, and it only mounts on a flame upgrade.
  await page.waitForSelector(".streak-ms", { timeout: 30_000 });
  await page.waitForTimeout(2500);

  const osc = await page.evaluate(() => window.__osc.filter((o) => o.freq !== null));
  await browser.close();
  return osc;
}

// C3/G3 foundation + the C6 rise: unique to the milestone cue.
const MILESTONE_MARKERS = [131, 196];
// The daily cue's opening note, which the milestone also uses — so the daily
// is identified by the ABSENCE of the foundation, not by this alone.
const SHARED_RISE = 1047;

const seven = await run(7);
console.log(`day 7  → ${seven.length} oscillators:`, seven.map((o) => `${o.freq}${o.wave === "triangle" ? "▲" : ""}`).join(" "));

const four = await run(4);
console.log(`day 4  → ${four.length} oscillators:`, four.map((o) => `${o.freq}${o.wave === "triangle" ? "▲" : ""}`).join(" "));

const has = (list, f) => list.some((o) => Math.abs(o.freq - f) <= 2);

const ok7 = MILESTONE_MARKERS.every((f) => has(seven, f)) && has(seven, SHARED_RISE);
const ok4 = !MILESTONE_MARKERS.some((f) => has(four, f)) && has(four, SHARED_RISE);

console.log(`\nmilestone cue played on day 7 : ${ok7 ? "YES" : "NO"}`);
console.log(`day 4 got the ORDINARY cue    : ${ok4 ? "YES" : "NO"}`);
console.log(`\n${ok7 && ok4 ? "PASS" : "FAIL"}`);
process.exit(ok7 && ok4 ? 0 : 1);
