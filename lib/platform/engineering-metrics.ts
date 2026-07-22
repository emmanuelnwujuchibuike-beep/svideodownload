/**
 * Engineering metrics — DORA-style delivery metrics, computed HONESTLY from the
 * signal this repo actually has (git history), with each metric labelled by how
 * trustworthy that signal is. The brief's "Engineering Analytics", made real
 * instead of a fabricated dashboard.
 *
 * ── The honesty of the numbers ────────────────────────────────────────────────
 *
 * This is trunk-based (commits land on `main`, Vercel auto-deploys `main`), so:
 *   - Deployment frequency ≈ commits to main. A good proxy — nearly 1:1.
 *   - Change-failure rate ≈ share of reverts + explicit hotfix/rollback commits.
 *     Conservative: it UNDER-counts when a fix isn't labelled, and deliberately
 *     does NOT treat every `fix(...)` commit as a production failure (most aren't).
 *   - MTTR ≈ time from a fault commit to the revert/hotfix that recovered it.
 *   - Lead time for changes CANNOT be derived from git alone (it needs deploy
 *     timestamps / PR merge times) — so it is marked `needs-signal`, not guessed.
 *
 * The computation is pure and unit-tested; `scripts/engineering-metrics.mjs` feeds
 * it real `git log` data and prints the report (`npm run metrics:engineering`).
 */

export interface ChangeEvent {
  sha: string;
  /** Commit time (unix ms). */
  timestampMs: number;
  /** Commit subject line. */
  subject: string;
}

export type MetricConfidence =
  /** Directly measured from a reliable signal. */
  | "measured"
  /** A defensible approximation from a related signal. */
  | "proxy"
  /** Not derivable from the available data; needs an external signal. */
  | "needs-signal";

export interface EngineeringMetric {
  id: "deployment-frequency" | "change-fail-rate" | "mttr" | "lead-time";
  name: string;
  confidence: MetricConfidence;
  /** What the number is derived from — its provenance, stated. */
  source: string;
}

export const ENGINEERING_METRICS: EngineeringMetric[] = [
  { id: "deployment-frequency", name: "Deployment frequency", confidence: "proxy", source: "commits to main (Vercel auto-deploys main; ~1:1)" },
  { id: "change-fail-rate", name: "Change failure rate", confidence: "proxy", source: "share of reverts + explicit hotfix/rollback commits (conservative)" },
  { id: "mttr", name: "Mean time to recovery", confidence: "proxy", source: "time from a fault commit to its revert/hotfix" },
  { id: "lead-time", name: "Lead time for changes", confidence: "needs-signal", source: "requires deploy timestamps / PR merge times — not in git alone" },
];

const MS_PER_DAY = 86_400_000;

/** A commit that recovered a production fault (a revert, hotfix or rollback). */
export function isFailureSignal(subject: string): boolean {
  const s = subject.trim();
  return /^revert[\s:"]/i.test(s) || /\b(hotfix|rollback)\b/i.test(s);
}

function sortedAsc(events: ChangeEvent[]): ChangeEvent[] {
  return [...events].sort((a, b) => a.timestampMs - b.timestampMs);
}

/** Deploys per day, over the span the events actually cover. */
export function deploymentsPerDay(events: ChangeEvent[]): number {
  if (events.length < 2) return events.length; // 0 or 1 — nothing to average over
  const sorted = sortedAsc(events);
  const spanMs = sorted[sorted.length - 1]!.timestampMs - sorted[0]!.timestampMs;
  const spanDays = spanMs / MS_PER_DAY;
  if (spanDays <= 0) return events.length; // all within a day
  return events.length / spanDays;
}

/** Fraction (0–1) of changes that were failure-recoveries. */
export function changeFailureRate(events: ChangeEvent[]): number {
  if (events.length === 0) return 0;
  const failures = events.filter((e) => isFailureSignal(e.subject)).length;
  return failures / events.length;
}

/**
 * Mean time (ms) from a fault to its recovery: for each failure-signal commit, the
 * gap to the commit immediately before it (the approximate fault). `null` when
 * there is nothing to recover from.
 */
export function meanTimeToRecoveryMs(events: ChangeEvent[]): number | null {
  const sorted = sortedAsc(events);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    if (isFailureSignal(sorted[i]!.subject)) {
      gaps.push(sorted[i]!.timestampMs - sorted[i - 1]!.timestampMs);
    }
  }
  if (gaps.length === 0) return null;
  return gaps.reduce((a, b) => a + b, 0) / gaps.length;
}

export interface EngineeringReport {
  windowDays: number;
  changes: number;
  deploymentsPerDay: number;
  changeFailureRatePct: number;
  mttrHours: number | null;
  leadTime: "needs-signal";
}

/** Compute the report for a set of change events. */
export function computeReport(events: ChangeEvent[]): EngineeringReport {
  const sorted = sortedAsc(events);
  const spanDays =
    sorted.length >= 2
      ? (sorted[sorted.length - 1]!.timestampMs - sorted[0]!.timestampMs) / MS_PER_DAY
      : 0;
  const mttr = meanTimeToRecoveryMs(events);
  return {
    windowDays: Math.round(spanDays * 10) / 10,
    changes: events.length,
    deploymentsPerDay: Math.round(deploymentsPerDay(events) * 100) / 100,
    changeFailureRatePct: Math.round(changeFailureRate(events) * 1000) / 10,
    mttrHours: mttr === null ? null : Math.round((mttr / 3_600_000) * 10) / 10,
    leadTime: "needs-signal",
  };
}
