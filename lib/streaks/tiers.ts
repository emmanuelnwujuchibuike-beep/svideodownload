/**
 * Streak TIERS — the flame gets rarer as the streak gets longer.
 *
 * Owner, 2026-08-30: "make the streak fire color and icon change to more
 * premium when users reach 7days, 14days, 1month, and 100days. The streak fire
 * should keep becoming more premium with a different colour, like blue, green,
 * Purple, dark gold and black."
 *
 * ── Why a pure module and not classes inline in the chip ──────────────────────
 *
 * Three surfaces draw the flame — the hero chip, the full-screen celebration
 * and the profile card — and a tier that disagreed between them would be worse
 * than no tier at all: the whole point is that the colour IS the rank, so
 * seeing gold in one place and orange in another reads as a bug in the streak
 * itself. One table, imported by all three.
 *
 * It is also the only way to test the boundaries. Off-by-one on a threshold is
 * invisible in review and very visible to the person who hit 100 days and got
 * purple.
 *
 * ── Tailwind needs the class strings WHOLE ────────────────────────────────────
 *
 * 🔴 Every class below is written out in full, never composed (`text-${c}-500`).
 * Tailwind scans source text for complete class names; an interpolated one is
 * not in the CSS at all, and the symptom is an unstyled chip in production while
 * dev looks fine. This project has a standing note about exactly that trap.
 */

export interface StreakTier {
  /** Stable id, for tests and analytics. */
  id: "spark" | "blue" | "green" | "purple" | "gold" | "black";
  /** Minimum streak, inclusive. */
  minDays: number;
  /** Shown in the reveal popover when a tier is reached. */
  label: string;
  /**
   * One line explaining what this flame IS, for the tier gallery.
   *
   * Owner, 2026-08-31: anonymous and signed-in visitors should be able to tap
   * the streak chip and "see an example of all the flames and description so
   * they can be encouraged to get it". A gallery of six unexplained colours is
   * decoration; the sentence is what turns it into something to aim at.
   *
   * Written in the second person and about the ACHIEVEMENT, never about the
   * artwork — "a full week without missing a day" is a reason to come back,
   * "a blue flame" is not.
   */
  blurb: string;
  /**
   * How this flame behaves, beyond its colour.
   *
   * Owner, 2026-08-31: "the streaks flames … are the same, only different is
   * the color, they suppose to look more prestigious and glorious as it
   * increases". So rank is no longer carried by hue alone — each tier from blue
   * up adds a distinct motion, and the motions escalate:
   *
   *   • `steady` — the base breathing loop (spark, green).
   *   • `ascend` — a real flame licking upward, blue's "real life blue flame".
   *   • `smoke`  — violet smoke drifting up off the flame (purple).
   *   • `storm`  — dimensional lighting with a thunder crack every 10s, on the
   *                flame AND on the chip around it (gold, black).
   *
   * Every one is CSS on transform/opacity only, gated on `prefers-reduced-
   * motion` and on the device's own capability — see globals.css.
   */
  motion: "steady" | "ascend" | "smoke" | "storm";
  /** The two SVG gradient stops for the flame, dark end first. */
  flame: [string, string];
  /** Chip text colour, light and dark. */
  text: string;
  /** Chip ring colour. */
  ring: string;
  /** Chip fill. */
  fill: string;
  /** The colour the sparkle burst and the pop ring use. */
  spark: string;
  /**
   * The halo around the pill, as a ready-to-use rgb()/alpha string.
   *
   * Owner, 2026-08-30: the badge should have "an orange or the color of the
   * streak grade glow around it". This is the ONE place a tier colour is
   * allowed to bleed outside the chip - everywhere else a coloured glow is
   * being removed, but here the glow IS the rank being shown off.
   */
  glow: string;
}

/**
 * Ordered LONGEST FIRST, because `tierFor` returns the first match — so adding
 * a tier means putting it in the right place, not remembering to re-sort.
 */
export const STREAK_TIERS: readonly StreakTier[] = [
  {
    id: "black",
    minDays: 365,
    label: "One year",
    blurb: "365 days without a single miss. Almost nobody gets here.",
    motion: "storm",
    // Not pure black: a flat #000 flame reads as a rendering failure, and it
    // disappears entirely in dark mode. Near-black with a graphite highlight
    // keeps the silhouette legible on both grounds.
    flame: ["#0B1020", "#4B5563"],
    text: "text-slate-900 dark:text-slate-100",
    ring: "ring-slate-900/30 dark:ring-slate-300/30",
    fill: "bg-gradient-to-r from-slate-900/10 to-slate-600/10 dark:from-slate-100/10 dark:to-slate-400/10",
    spark: "bg-slate-900 dark:bg-slate-200",
    glow: "rgb(15 23 42 / 0.42)",
  },
  {
    id: "gold",
    minDays: 100,
    label: "Legendary",
    blurb: "100 days running. Gold, lit by its own storm.",
    motion: "storm",
    flame: ["#8A6100", "#E3B341"],
    text: "text-amber-700 dark:text-amber-300",
    ring: "ring-amber-600/35 dark:ring-amber-400/30",
    fill: "bg-gradient-to-r from-amber-700/12 to-yellow-600/12",
    spark: "bg-amber-500",
    glow: "rgb(227 179 65 / 0.55)",
  },
  {
    id: "purple",
    minDays: 30,
    label: "Elite",
    blurb: "A full month. The flame burns violet and starts to smoke.",
    motion: "smoke",
    flame: ["#6D28D9", "#C084FC"],
    text: "text-violet-600 dark:text-violet-300",
    ring: "ring-violet-500/30 dark:ring-violet-400/30",
    fill: "bg-gradient-to-r from-violet-500/12 to-fuchsia-500/12",
    spark: "bg-violet-500",
    glow: "rgb(139 92 246 / 0.5)",
  },
  {
    id: "green",
    minDays: 14,
    label: "Committed",
    blurb: "Two weeks straight. The habit has taken hold.",
    motion: "steady",
    flame: ["#047857", "#4ADE80"],
    text: "text-emerald-600 dark:text-emerald-300",
    ring: "ring-emerald-500/30 dark:ring-emerald-400/30",
    fill: "bg-gradient-to-r from-emerald-500/12 to-teal-500/12",
    spark: "bg-emerald-500",
    glow: "rgb(16 185 129 / 0.5)",
  },
  {
    id: "blue",
    minDays: 7,
    label: "On a roll",
    blurb: "Seven days in a row. The fire burns hotter, and turns blue.",
    motion: "ascend",
    flame: ["#1D4ED8", "#60A5FA"],
    text: "text-blue-600 dark:text-blue-300",
    ring: "ring-blue-500/30 dark:ring-blue-400/30",
    fill: "bg-gradient-to-r from-blue-500/12 to-sky-500/12",
    spark: "bg-blue-500",
    glow: "rgb(59 130 246 / 0.5)",
  },
  {
    /*
      🔴 THE BADGE SHOWS FROM DAY ONE. DO NOT RAISE THIS.

      It was briefly raised to 2, on a misreading of "make the streak badge when
      users reach 2 days streaks to be like this image" — that sentence is about
      how the badge LOOKS, not about when it first appears. Raising it removed
      the badge from every day-1 visitor, which on the landing page is almost
      every ANONYMOUS visitor there is (owner: "that streak is not showing in
      the landing page for anonymous like the previous used to").

      Anonymous visitors have real streaks (lib/streaks/identity.ts mints them a
      server-side id), and day 1 is when the badge does its most useful work:
      it is the thing that tells a first-time visitor a streak exists at all.
    */
    id: "spark",
    minDays: MIN_STREAK_DAYS(),
    label: "Streak started",
    blurb: "Day one. Come back tomorrow and it grows.",
    motion: "steady",
    flame: ["#F97316", "#FBBF24"],
    text: "text-orange-600 dark:text-orange-300",
    ring: "ring-orange-500/30 dark:ring-orange-400/30",
    fill: "bg-gradient-to-r from-amber-500/12 to-orange-500/12",
    spark: "bg-orange-500",
    glow: "rgb(249 115 22 / 0.55)",
  },
];

/**
 * The streak at which the badge first appears.
 *
 * A function rather than a bare const purely so it can be referenced above its
 * own declaration in the table without a temporal-dead-zone error, while still
 * being the single place the number lives.
 */
function MIN_STREAK_DAYS(): number {
  return 1;
}

/** The streak at which the badge first appears. Below this, render nothing. */
export const STREAK_BADGE_MIN_DAYS = MIN_STREAK_DAYS();

/** The tier for a streak, or null when the streak is too short to show at all. */
export function tierFor(days: number): StreakTier | null {
  if (!Number.isFinite(days)) return null;
  return STREAK_TIERS.find((t) => days >= t.minDays) ?? null;
}

/**
 * Did this increment CROSS into a new tier?
 *
 * Used to decide whether the increment deserves the bigger celebration. Reaching
 * day 7 is a different event from reaching day 6, and treating them the same is
 * what makes a milestone feel like nothing.
 */
export function crossedTier(before: number, after: number): StreakTier | null {
  /*
    🔴 A DECREASE IS NOT A MILESTONE. Without this line a broken streak —
    100 days lost and restarted at 2 — reports "crossed into spark" and fires
    the celebration, congratulating someone for losing their gold flame. The
    tier ids differ in both directions, so comparing them alone cannot tell a
    promotion from a demotion.
  */
  if (!(after > before)) return null;
  const a = tierFor(before);
  const b = tierFor(after);
  if (!b) return null;
  if (a?.id === b.id) return null;
  return b;
}

/**
 * Is TODAY the day this streak became a milestone?
 *
 * ── Why exact equality, and why that is enough ───────────────────────────────
 *
 * Owner, 2026-08-31: the 7-day celebration "must happen exactly when the streak
 * transitions 6 → 7. It must NOT trigger simply because the user currently has
 * a 7-day streak."
 *
 * Landing exactly ON a threshold can only happen by incrementing onto it — a
 * streak moves one day at a time, and a reset goes to 1, never to 7. Combined
 * with the caller's `shouldCelebrate`, which the SERVER sets false for the rest
 * of the day the moment the celebration is claimed (`lastCelebrationDate`), the
 * pair is exactly "the increment that crossed this threshold, once".
 *
 * That is why this takes only the current streak and needs no `previous`: the
 * client never has a trustworthy previous value anyway (a second tab, a fresh
 * PWA launch and a cleared cache all start with none), and anything decided
 * from client state replays. Refreshes, extra tabs, route changes, remounts and
 * re-authentication all come back with `shouldCelebrate: false` and get nothing.
 *
 * ── Adding 60/90/180-day milestones later ────────────────────────────────────
 *
 * Add the tier to `STREAK_TIERS` and it is a milestone automatically — there is
 * no second list to keep in sync, which is the whole reason this reads off the
 * tier table rather than a `MILESTONES = [7, 14, 30]` array sitting beside it.
 * Day 1 is excluded because arriving is not an achievement (§28: day 1 never
 * celebrates), and it is the one threshold every visitor trips on their first
 * page view.
 */
export function milestoneFor(days: number): StreakTier | null {
  if (!Number.isFinite(days) || days <= STREAK_BADGE_MIN_DAYS) return null;
  return STREAK_TIERS.find((t) => t.minDays === days) ?? null;
}

/** Days remaining until the next tier, and which one. Null at the top tier. */
export function nextTier(days: number): { tier: StreakTier; inDays: number } | null {
  // The table is longest-first, so the next tier up is the LAST entry whose
  // threshold is still ahead of us.
  const ahead = STREAK_TIERS.filter((t) => t.minDays > days);
  const next = ahead[ahead.length - 1];
  return next ? { tier: next, inDays: next.minDays - days } : null;
}
