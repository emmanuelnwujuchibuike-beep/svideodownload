/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DAILY AND WEEKLY PERIODS — decided on the server, in the operator's zone
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-21: "Track the actual usage period · prevent timezone
 * manipulation · avoid relying on client-side dates · use server-side
 * timestamps · make the reset timezone configurable."
 *
 * A period is a KEY written on the ledger row when credits are reserved —
 * `day_key` "2026-09-21", `week_key` the date the week began — computed here
 * from the server's clock in the configured IANA zone. Nothing a browser
 * sends takes part. Changing the zone in the admin changes how FUTURE rows
 * are keyed; past rows keep the keys they were written with.
 *
 * Pure (Intl only), so the boundaries are tested without a database.
 */

export interface PeriodKeys {
  dayKey: string;
  weekKey: string;
  /** When today's allowance resets — the next local midnight, as an instant. */
  dayResetsAt: Date;
  /** When this week's allowance resets — the next week start's local midnight. */
  weekResetsAt: Date;
  timezone: string;
  weekStartsOn: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The local civil date parts of an instant in a zone. */
function partsIn(date: Date, timeZone: string): { y: number; m: number; d: number; weekday: number; h: number; min: number; s: number } {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) map[p.type] = p.value;
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { y: Number(map.year), m: Number(map.month), d: Number(map.day), weekday: weekdays.indexOf(map.weekday ?? "Sun"), h: Number(map.hour), min: Number(map.minute), s: Number(map.second) };
}

/** The instant of local midnight for a civil date in a zone (two-pass, exact across DST). */
function localMidnight(y: number, m: number, d: number, timeZone: string): Date {
  let guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  for (let i = 0; i < 3; i++) {
    const p = partsIn(guess, timeZone);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
    const want = Date.UTC(y, m - 1, d, 0, 0, 0);
    const diff = want - asUtc;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function periodKeys(now: Date, timezone: string, weekStartsOn: number): PeriodKeys {
  const tz = safeZone(timezone);
  const start = Math.min(6, Math.max(0, Math.floor(weekStartsOn)));
  const p = partsIn(now, tz);
  const dayKey = keyOf(p.y, p.m, p.d);
  const todayMidnight = localMidnight(p.y, p.m, p.d, tz);
  const daysSinceWeekStart = (p.weekday - start + 7) % 7;
  // Step back whole civil days: subtract days from the local midnight and re-read the civil date (safe across DST).
  const weekStartCivil = partsIn(new Date(todayMidnight.getTime() - daysSinceWeekStart * DAY_MS + 12 * 60 * 60 * 1000), tz);
  const weekKey = keyOf(weekStartCivil.y, weekStartCivil.m, weekStartCivil.d);
  const tomorrow = partsIn(new Date(todayMidnight.getTime() + DAY_MS + 12 * 60 * 60 * 1000), tz);
  const dayResetsAt = localMidnight(tomorrow.y, tomorrow.m, tomorrow.d, tz);
  const nextWeekCivil = partsIn(new Date(todayMidnight.getTime() + (7 - daysSinceWeekStart) * DAY_MS + 12 * 60 * 60 * 1000), tz);
  const weekResetsAt = localMidnight(nextWeekCivil.y, nextWeekCivil.m, nextWeekCivil.d, tz);
  return { dayKey, weekKey, dayResetsAt, weekResetsAt, timezone: tz, weekStartsOn: start };
}

function safeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}
