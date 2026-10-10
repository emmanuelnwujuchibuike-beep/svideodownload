/**
 * Weekly top AI creators (owner, 2026-10-10: "the first receives a free 50
 * points when he spends more than 500 points that week, the second 30 and the
 * third 20"). Pure: the server module and the admin panel share it, and the
 * tests are the specification.
 *
 *   · a week is Monday 00:00 → next Monday 00:00, UTC
 *   · "spent" = credits charged for AI creations that week, minus refunds
 *   · ranks 1–3 by spend; a rank is paid only if THAT person spent more than
 *     WEEKLY_MIN_SPEND — a quiet week pays nobody rather than rewarding 20 credits
 */
export const WEEKLY_MIN_SPEND = 500;
export const WEEKLY_PRIZES = [50, 30, 20] as const;

const DAY = 86_400_000;

/** The Monday (UTC) starting the week that contains `t`, as YYYY-MM-DD. */
export function weekStartOf(t: number): string {
  const d = new Date(t);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dow * DAY;
  return new Date(monday).toISOString().slice(0, 10);
}

export function weekBounds(weekStart: string): { start: string; end: string } {
  const s = Date.parse(`${weekStart}T00:00:00Z`);
  return { start: new Date(s).toISOString(), end: new Date(s + 7 * DAY).toISOString() };
}

/** Spend per user from ledger rows: a charge is negative, a refund positive — spend is what was kept. */
export function spendByUser(rows: readonly { user_id: string; delta_cents: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.user_id, (out.get(r.user_id) ?? 0) - r.delta_cents);
  for (const [k, v] of out) if (v <= 0) out.delete(k);
  return out;
}

export function rankSpenders(spend: ReadonlyMap<string, number>, limit = 10): { userId: string; spent: number }[] {
  return [...spend.entries()]
    .map(([userId, spent]) => ({ userId, spent }))
    .sort((a, b) => b.spent - a.spent || a.userId.localeCompare(b.userId))
    .slice(0, limit);
}

export function weeklyAwards(ranked: readonly { userId: string; spent: number }[]): { rank: 1 | 2 | 3; userId: string; spent: number; credits: number }[] {
  return ranked
    .slice(0, WEEKLY_PRIZES.length)
    .map((r, i) => ({ rank: (i + 1) as 1 | 2 | 3, userId: r.userId, spent: r.spent, credits: WEEKLY_PRIZES[i]! }))
    .filter((a) => a.spent > WEEKLY_MIN_SPEND);
}
