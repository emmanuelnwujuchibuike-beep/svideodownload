/**
 * When the "Earn credits" modal may show (owner 2026-10-12: "show once a day … it should
 * show on the first download of the day"): ONCE a day, on the first completed download of
 * that day. The count starts again each day (the visitor's own calendar day).
 *
 * Stored per browser (localStorage, guests included) as one small record. "Shown" is
 * written only when the modal actually opens — if an ad was in the way, the next download
 * that day tries again. Pure: the trigger reads and writes, this decides.
 */
export const DAILY_AT = 1;
export const DAILY_KEY = "frenz:referral-daily";

export interface DailyState {
  day: string;
  count: number;
  shown: boolean;
}

/** The visitor's local calendar day, YYYY-MM-DD. */
export function dayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** One completed download → the new record, and whether the modal should open now. */
export function countDownload(prev: DailyState | null, now: Date): { state: DailyState; due: boolean } {
  const day = dayOf(now);
  const same = prev && prev.day === day;
  const state: DailyState = { day, count: (same ? prev.count : 0) + 1, shown: same ? prev.shown : false };
  return { state, due: !state.shown && state.count >= DAILY_AT };
}

/** Parse whatever is stored; anything malformed counts as a fresh day. */
export function readDaily(raw: string | null): DailyState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<DailyState>;
    return typeof v.day === "string" && typeof v.count === "number" && typeof v.shown === "boolean" ? { day: v.day, count: v.count, shown: v.shown } : null;
  } catch {
    return null;
  }
}
