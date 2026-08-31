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
    // Not pure black: a flat #000 flame reads as a rendering failure, and it
    // disappears entirely in dark mode. Near-black with a graphite highlight
    // keeps the silhouette legible on both grounds.
    flame: ["#0B1020", "#4B5563"],
    text: "text-slate-900 dark:text-slate-100",
    ring: "ring-slate-900/30 dark:ring-slate-300/30",
    fill: "bg-gradient-to-r from-slate-900/10 to-slate-600/10 dark:from-slate-100/10 dark:to-slate-400/10",
    spark: "bg-slate-900 dark:bg-slate-200",
  },
  {
    id: "gold",
    minDays: 100,
    label: "Legendary",
    flame: ["#8A6100", "#E3B341"],
    text: "text-amber-700 dark:text-amber-300",
    ring: "ring-amber-600/35 dark:ring-amber-400/30",
    fill: "bg-gradient-to-r from-amber-700/12 to-yellow-600/12",
    spark: "bg-amber-500",
  },
  {
    id: "purple",
    minDays: 30,
    label: "Elite",
    flame: ["#6D28D9", "#C084FC"],
    text: "text-violet-600 dark:text-violet-300",
    ring: "ring-violet-500/30 dark:ring-violet-400/30",
    fill: "bg-gradient-to-r from-violet-500/12 to-fuchsia-500/12",
    spark: "bg-violet-500",
  },
  {
    id: "green",
    minDays: 14,
    label: "Committed",
    flame: ["#047857", "#4ADE80"],
    text: "text-emerald-600 dark:text-emerald-300",
    ring: "ring-emerald-500/30 dark:ring-emerald-400/30",
    fill: "bg-gradient-to-r from-emerald-500/12 to-teal-500/12",
    spark: "bg-emerald-500",
  },
  {
    id: "blue",
    minDays: 7,
    label: "On a roll",
    flame: ["#1D4ED8", "#60A5FA"],
    text: "text-blue-600 dark:text-blue-300",
    ring: "ring-blue-500/30 dark:ring-blue-400/30",
    fill: "bg-gradient-to-r from-blue-500/12 to-sky-500/12",
    spark: "bg-blue-500",
  },
  {
    /*
      The base tier, and the reason the chip starts at TWO (owner: "make the
      streak badge when users reach 2 days streaks"). One day is not a streak —
      it is a visit — and a "1 day streak" badge on a first-time visitor's
      screen devalues the thing entirely.
    */
    id: "spark",
    minDays: MIN_STREAK_DAYS(),
    label: "Streak started",
    flame: ["#F97316", "#FBBF24"],
    text: "text-orange-600 dark:text-orange-300",
    ring: "ring-orange-500/30 dark:ring-orange-400/30",
    fill: "bg-gradient-to-r from-amber-500/12 to-orange-500/12",
    spark: "bg-orange-500",
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
  return 2;
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

/** Days remaining until the next tier, and which one. Null at the top tier. */
export function nextTier(days: number): { tier: StreakTier; inDays: number } | null {
  // The table is longest-first, so the next tier up is the LAST entry whose
  // threshold is still ahead of us.
  const ahead = STREAK_TIERS.filter((t) => t.minDays > days);
  const next = ahead[ahead.length - 1];
  return next ? { tier: next, inDays: next.minDays - days } : null;
}
