/**
 * Growth Insights™ and Profile Goals™ (Feature 18 · Part 15, backed by 0110).
 *
 * ── Why this could not be built until now ─────────────────────────────────
 * Parts 4-5 and Part 15 both refused to show growth, and both said why: there
 * was no time series. A trend drawn from a single reading is not a trend, it is
 * a decoration, and the honest move was to declare it unbuilt rather than draw
 * a line through one point. `profile_snapshots` (0110) is the missing half —
 * one row per member per day, written by cron.
 *
 * ── The rule that keeps it honest ─────────────────────────────────────────
 * A trend needs at least TWO readings spanning a real interval. Everything here
 * returns `null` rather than 0 when it cannot answer, and a member's first day
 * genuinely has no trend — the UI must say "not enough history yet", never draw
 * a flat line, which reads as "no growth" and is a different claim entirely.
 *
 * Pure: no React, no Supabase, no clock beyond what is passed in.
 */

import type { ProfileSnapshot } from "@/lib/social/profile-backends";

export type GrowthMetric = "posts" | "followers" | "following" | "friends" | "collections" | "reputation";

export interface Trend {
  metric: GrowthMetric;
  label: string;
  /** The most recent reading. */
  current: number;
  /** The oldest reading in the window. */
  previous: number;
  /** current − previous. */
  change: number;
  /**
   * Percentage change, or null when it cannot be expressed — growing from
   * ZERO is an infinite percentage, and "+∞%" is not a useful thing to show
   * someone. The absolute change is always available and always true.
   */
  changePercent: number | null;
  /** Days actually spanned by the readings used. */
  spanDays: number;
}

const METRIC_LABEL: Record<GrowthMetric, string> = {
  posts: "Posts",
  followers: "Followers",
  following: "Following",
  friends: "Friends",
  collections: "Collections",
  reputation: "Reputation",
};

export const GROWTH_METRICS = Object.keys(METRIC_LABEL) as GrowthMetric[];

/** Whole days between two ISO dates, never negative. */
function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

/**
 * Trends across the given snapshots (oldest → newest).
 *
 * Returns an EMPTY array when there are fewer than two readings. That is the
 * whole contract: no data, no claim.
 */
export function computeTrends(snapshots: ProfileSnapshot[]): Trend[] {
  if (snapshots.length < 2) return [];
  const first = snapshots[0]!;
  const last = snapshots[snapshots.length - 1]!;
  const spanDays = daysBetween(first.capturedOn, last.capturedOn);
  // Two readings from the same day describe a moment, not a period.
  if (spanDays < 1) return [];

  return GROWTH_METRICS.map((metric) => {
    const previous = first[metric];
    const current = last[metric];
    const change = current - previous;
    return {
      metric,
      label: METRIC_LABEL[metric],
      current,
      previous,
      change,
      changePercent: previous > 0 ? Math.round((change / previous) * 1000) / 10 : null,
      spanDays,
    };
  });
}

/** Trends worth showing: something actually moved. */
export function movedTrends(trends: Trend[]): Trend[] {
  return trends.filter((t) => t.change !== 0).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

/* ─────────────────────────────── Goals ─────────────────────────────── */

export type GoalMetric = GrowthMetric | "achievements" | "health";

export const GOAL_METRICS: { key: GoalMetric; label: string; noun: string }[] = [
  { key: "posts", label: "Posts", noun: "posts" },
  { key: "followers", label: "Followers", noun: "followers" },
  { key: "friends", label: "Friends", noun: "friends" },
  { key: "collections", label: "Collections", noun: "collections" },
  { key: "reputation", label: "Reputation score", noun: "points" },
  { key: "achievements", label: "Achievements", noun: "achievements" },
  { key: "health", label: "Profile health", noun: "points" },
];

export const GOAL_METRIC_KEYS = GOAL_METRICS.map((g) => g.key) as [GoalMetric, ...GoalMetric[]];

export function isGoalMetric(value: string): value is GoalMetric {
  return GOAL_METRICS.some((g) => g.key === value);
}

export interface GoalProgress {
  id: string;
  metric: GoalMetric;
  label: string;
  target: number;
  /** Live value, read at request time — never stored. */
  current: number;
  /** 0–100, capped. */
  percent: number;
  reached: boolean;
  dueOn: string | null;
  /** Days until due, negative when overdue, null when there's no date. */
  daysLeft: number | null;
}

export interface GoalSignals {
  posts: number;
  followers: number;
  following: number;
  friends: number;
  collections: number;
  reputation: number;
  achievements: number;
  health: number;
}

/**
 * Resolves stored goals against live signals.
 *
 * Progress is DERIVED, never stored: a stored percentage is wrong the moment
 * anything else changes, and a goal that silently drifts out of date is worse
 * than no goal. The cost is one arithmetic pass over a handful of rows.
 */
export function resolveGoals(
  goals: { id: string; metric: string; target: number; label: string | null; dueOn: string | null }[],
  signals: GoalSignals,
  now = new Date(),
): GoalProgress[] {
  return goals
    .filter((g) => isGoalMetric(g.metric) && g.target > 0)
    .map((g) => {
      const metric = g.metric as GoalMetric;
      const current = signals[metric] ?? 0;
      const percent = Math.max(0, Math.min(100, Math.round((current / g.target) * 100)));
      return {
        id: g.id,
        metric,
        label: g.label ?? `${g.target.toLocaleString()} ${GOAL_METRICS.find((m) => m.key === metric)!.noun}`,
        target: g.target,
        current,
        percent,
        reached: current >= g.target,
        dueOn: g.dueOn,
        daysLeft: g.dueOn ? Math.round((new Date(g.dueOn).getTime() - now.getTime()) / 86_400_000) : null,
      };
    });
}
