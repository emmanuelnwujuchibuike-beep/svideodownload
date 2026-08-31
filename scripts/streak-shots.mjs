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

/**
 * A COMPLETE `StreakState`. Every field of StreakRecord as well — an earlier
 * version stubbed only the handful the chip reads, and the chip then rendered
 * nothing at all, so the shots silently fell back to the real day-1 streak.
 */
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
    week: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-08-${25 + i}`,
      active: i >= 7 - Math.min(currentStreak, 7),
    })),
  };
}

async function shoot({ theme, streak, celebrate, tapChip, name }) {
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
      body: JSON.stringify(state(streak, celebrate)),
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
       caption and photographed a ceremony with its sentence missing. */
    /* The MILESTONE ceremony and the DAILY celebration are different
       components with different markup — waiting for the ceremony-s caption on
       an ordinary day waits for something that correctly never renders, which
       is what the day-4 shot did until this was split. */
    const milestone = [7, 14, 30, 100, 365].includes(streak);
    await page.waitForSelector(milestone ? ".streak-ms-caption" : ".streak-celebration-scrim", {
      timeout: 20_000,
    });
    /* The caption ELEMENT exists from the first frame (its animation has
       fill-mode both), so waiting for the selector only proves it mounted, not
       that it has painted. Its beat is 1500ms + 560ms, so land in the HOLD
       phase (1750-3100ms) to photograph the ceremony at rest. */
    await page.waitForTimeout(milestone ? 2400 : 400);
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
  // The 7-day ceremony, mid-sequence.
  await shoot({ theme, streak: 7, celebrate: true, tapChip: false, name: "milestone7" });
  // An ordinary day, for the contrast the whole brief is about.
  await shoot({ theme, streak: 4, celebrate: true, tapChip: false, name: "daily4" });
}
