/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DAYS THE SERVICE WAS DOWN — and therefore days nobody can lose a streak on
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-07: "Server was down for 2 days since Saturday. Restore all
 * lost streaks from Friday last week."
 *
 * ── Why this is a rule and not a data repair ────────────────────────────────
 *
 * A streak is computed LAZILY. `applyActivity` runs only when someone is
 * active, and it is the only thing that ever writes `current_streak`. While the
 * service was down nobody could download, so nobody's `applyActivity` ran —
 * which means on the day the site came back, almost nobody's streak had
 * actually been reset yet. The damage was still in the future: it would happen
 * one user at a time, as each returned and their gap was measured against a
 * calendar that did not know we were the ones who were absent.
 *
 * So the honest fix is not to go and rewrite thousands of rows. It is to stop
 * counting the days we were unreachable. That repairs everyone who has not come
 * back yet, needs no write to production data, is idempotent, and can be read
 * and checked by a person — three properties a mass UPDATE does not have.
 *
 * ── What it does NOT do ─────────────────────────────────────────────────────
 *
 * 🔴 It does not award days. A visitor who did not download gets no credit for
 * the outage; their streak simply is not BROKEN by it. Granting free active days
 * would be inventing activity that never happened, which is the one thing this
 * project does not do with numbers.
 *
 * It also cannot help someone whose streak was already reset by returning
 * DURING or right after the window — their row has been written. Those are
 * covered by the existing restore flow while their window is open
 * (`restoreDeadline`), which is the mechanism built for exactly this.
 *
 * ── Adding an outage ────────────────────────────────────────────────────────
 *
 * Dates are inclusive, `YYYY-MM-DD`, in the same day-space as the rest of the
 * streak engine. Ranges must not overlap — a test pins that, because an overlap
 * would silently double-count and forgive more than actually happened.
 */
export interface ServiceOutage {
  /** First day the service was unavailable, inclusive. */
  from: string;
  /** Last day the service was unavailable, inclusive. */
  to: string;
  /** Why, in the owner's own terms — this is an audit trail, not a comment. */
  note: string;
}

export const SERVICE_OUTAGES: ServiceOutage[] = [
  {
    from: "2026-09-04",
    to: "2026-09-06",
    note:
      "Owner, 2026-09-07: \"Server was down for 2 days sice saturday\" (Sat 09-05, " +
      "Sun 09-06) and \"All jobs failed since Friday\" (Fri 09-04). Friday is " +
      "included because the owner asked to restore streaks from it — the failing " +
      "jobs make it the first day the service could not be relied on.",
  },
];

/**
 * How many of the days a visitor MISSED fall inside an outage.
 *
 * The missed days are the open interval `(last, today)` — the days on which
 * they could have been active and were not. `last` itself is a day they WERE
 * active, and `today` is the day they have just come back, so neither can be a
 * missed day.
 *
 * Counted arithmetically per range rather than by walking the calendar: a gap
 * can be years wide, and a loop over it would be unbounded work on a hot path.
 */
export function outageDaysMissed(
  last: string,
  today: string,
  outages: ServiceOutage[] = SERVICE_OUTAGES,
): number {
  let missed = 0;
  for (const o of outages) {
    // Clamp each outage to the interval the visitor actually missed.
    const lo = maxDay(o.from, addDay(last, 1));
    const hi = minDay(o.to, addDay(today, -1));
    const span = daysBetween(lo, hi);
    if (span >= 0) missed += span + 1;
  }
  return missed;
}

/*
  Local day helpers, deliberately not exported and deliberately NOT imported
  from `calc.ts`.

  `calc.ts` calls `outageDaysMissed`, so importing back from it would make a
  module cycle. The cycle would resolve today — both sides are used at call time,
  not at module-init — but a cycle that happens to work is a trap for whoever
  next moves a constant to the top level. Four lines of arithmetic is a cheaper
  price than that. They are the same day-space: UTC midnight, `YYYY-MM-DD`.
*/
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}
function addDay(day: string, delta: number): string {
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms)) return day;
  return new Date(ms + delta * 86_400_000).toISOString().slice(0, 10);
}
function maxDay(a: string, b: string): string {
  return a > b ? a : b;
}
function minDay(a: string, b: string): string {
  return a < b ? a : b;
}
