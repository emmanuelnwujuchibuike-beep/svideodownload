/**
 * SEE the streak work, rather than assert it compiles.
 *
 * This project has a standing note that the streak chip, celebration and
 * profile card have shipped repeatedly WITHOUT ever being looked at on a
 * device. Everything here is driven in a real browser against a production
 * build, and every shot is of the real component — nothing is mocked except the
 * streak STATE, which is stubbed at the network boundary so a 7-day milestone
 * can be photographed without waiting seven days.
 *
 *   node scripts/streak-shots.mjs http://localhost:3123/
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3123/";
const OUT = process.argv[3] ?? "C:/Users/u/AppData/Local/Temp/navshots";
mkdirSync(OUT, { recursive: true });

/** The rungs. Kept in step with STREAK_TIERS by hand — the shots are a tool,
 *  not shipped code, so a duplicated list here costs nothing to correct. */
const MILESTONES = [2, 7, 14, 30, 100, 365];

/**
 * A COMPLETE `StreakState`. Every field of StreakRecord as well — an earlier
 * version stubbed only the handful the chip reads, and the chip then rendered
 * nothing at all, so the shots silently fell back to the real day-1 streak.
 */
function state(currentStreak, shouldCelebrate, { longest, broken } = {}) {
  const today = "2026-08-31";
  /* A broken streak has a live recovery window: `restoreDeadline` set, a
     `restorableStreak` to offer back, and an expiry to count down to. This is
     the state §6/§7 describe and the only way to photograph it. */
  const lost = broken ? (longest ?? 12) : 0;
  return {
    currentStreak,
    longestStreak: Math.max(currentStreak, longest ?? 12),
    lastActivityDate: today,
    streakStartedAt: today,
    totalActiveDays: currentStreak,
    timezone: "Africa/Lagos",
    restoreDeadline: broken ? "2026-09-02" : null,
    lastCelebrationDate: null,
    lastReminderDate: null,
    restoresUsed: broken ? 2 : 0,
    status: broken ? "RESTORABLE" : "ACTIVE",
    shouldCelebrate,
    canRestore: !!broken,
    restorableStreak: lost,
    /* ~23h47m out, so the countdown in the shot reads like the owner's copy. */
    restoreExpiresAt: broken ? new Date(Date.now() + 85_620_000).toISOString() : null,
    restoresRemaining: broken ? 1 : 3,
    today,
    week: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-08-${25 + i}`,
      active: i >= 7 - Math.min(currentStreak, 7),
    })),
  };
}

async function shoot({ theme, streak, celebrate, tapChip, name, longest, broken }) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    ...devices["Pixel 7"],
    colorScheme: theme,
    reducedMotion: "no-preference",
  });
  const page = await ctx.newPage();

  /*
    🔴 ORDER MATTERS, AND IT IS BACKWARDS FROM THE OBVIOUS.

    Playwright matches the MOST RECENTLY registered route first. The catch-all
    was registered last in the first version of this script, so it won every
    request and the stubs below never ran — the gallery shot was captured
    against the REAL day-1 anonymous streak while claiming to be day 3, and a
    milestone shot would have photographed nothing at all.

    So: catch-all first, specific stubs after.
  */
  await page.route("**/*", (route) => {
    // Third-party ad creatives are non-deterministic and have navigated this
    // page away mid-run before.
    const h = new URL(route.request().url()).hostname;
    return h === "localhost" || h === "127.0.0.1" ? route.continue() : route.abort();
  });

  // Stub ONLY the streak state. Everything else — the chip, the gallery, the
  // ceremony, the tier table, the CSS — is the real shipped code.
  await page.route("**/api/streak/celebrated", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await page.route("**/api/streak", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(state(streak, celebrate, { longest, broken })),
    }),
  );

  await page.goto(BASE, { waitUntil: "load", timeout: 90_000 });

  if (tapChip) {
    /* `.streak-chip` and not `[aria-haspopup=dialog]`: the Install button carries
       that attribute too, and it is hidden, so the generic selector waited on the
       wrong element for 20s. */
    const chip = page.locator("button.streak-chip").first();
    /* attached + scrollIntoView, not "visible": the chip lives in the hero and
       is briefly zero-box while the hero settles, and a strict visibility wait
       timed out against a chip that was in the DOM the whole time. */
    await chip.waitFor({ state: "attached", timeout: 25_000 });
    await chip.scrollIntoViewIfNeeded().catch(() => {});
    await chip.click({ force: true });
    await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });
    // Let the tier marks start their loops so the shot shows real motion state.
    await page.waitForTimeout(1400);
  } else if (celebrate) {
    /* Wait for the LAST beat to arrive rather than guessing a delay. The
       ceremony starts when recordStreakActivity() resolves — some hundreds of
       ms after load — so a fixed 2200ms landed between the title and the
       caption and photographed a ceremony with its sentence missing.

       🔴 THERE IS ONLY ONE CELEBRATION NOW (owner, 2026-09-01: "there shoudnlt
       be a celebration everyday, only on flame upgrade"). The daily overlay is
       DELETED, so an ordinary day correctly renders nothing at all — asking for
       it would hang for the full timeout and then report a bug that is the
       intended behaviour. Only a rung has a ceremony. */
    if (!MILESTONES.includes(streak)) {
      console.log(`skip: day ${streak} is not a flame upgrade — no ceremony by design`);
      await browser.close();
      return;
    }
    await page.waitForSelector(".streak-ms-line", { timeout: 20_000 });
    /* The line ELEMENT exists from the first frame (its animation has
       fill-mode both), so waiting for the selector only proves it mounted, not
       that it has painted. The words land at 1560ms + 560ms and the CTAs at
       1820ms, and the ceremony no longer dismisses itself — so anything past
       ~2500ms photographs it at rest. */
    await page.waitForTimeout(2600);
  } else {
    await page.waitForTimeout(1500);
  }

  const file = `${OUT}/streak-${name}-${theme}.png`;
  await page.screenshot({ path: file });
  console.log("shot:", file);
  await browser.close();
}

for (const theme of ["light", "dark"]) {
  // The gallery: all six flames, their descriptions, the premium ground.
  await shoot({ theme, streak: 3, celebrate: false, tapChip: true, name: "gallery" });
  /* The gallery AFTER A BREAK — the state §6 is about. A 100-day member on a
     1-day streak must still see gold, purple, green and blue as UNLOCKED. */
  await shoot({ theme, streak: 1, celebrate: false, tapChip: true, name: "gallery-broken", longest: 100, broken: true });
  // Day 2: the smallest rung — a card, never a takeover, and never day 1.
  await shoot({ theme, streak: 2, celebrate: true, tapChip: false, name: "unlock2" });
  // The 7-day unlock, at rest.
  await shoot({ theme, streak: 7, celebrate: true, tapChip: false, name: "unlock7" });
  // The rarest, to check the intensity ladder actually escalates.
  await shoot({ theme, streak: 365, celebrate: true, tapChip: false, name: "unlock365" });
}
