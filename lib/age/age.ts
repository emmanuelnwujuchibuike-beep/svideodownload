/**
 * The age check's arithmetic (0261, owner 2026-10-18: "Date of birth + 18+ confirm").
 *
 * Pure and shared: the form uses it to answer at once, the server uses it to decide (the
 * browser's answer is never trusted — app/api/age/route.ts recomputes from the date it was sent).
 * Dates are calendar dates, "YYYY-MM-DD", compared in UTC. The server keeps only the outcome:
 * 'adult', or 'minor' with the day they turn 18 — never the date of birth itself.
 */

export const ADULT_AGE = 18;
/** Anyone claiming to be older than this has typed the year wrong. */
const MAX_AGE = 120;

export type AgeStatus = "adult" | "minor" | "none";
export type AgeOutcome = { result: "adult" } | { result: "minor"; eligibleOn: string };

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date as UTC midnight; null if it isn't a real date (2026-02-30 is not). */
export function parseIsoDate(s: unknown): Date | null {
  if (typeof s !== "string") return null;
  const m = ISO.exec(s.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Today's calendar date in UTC. */
export function todayUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * The day someone born on `dob` turns `years`. A 29 February birthday reaches it on 1 March in a
 * year that has no 29 February (never early).
 */
export function birthdayAt(dob: Date, years: number): Date {
  const y = dob.getUTCFullYear() + years;
  const d = new Date(Date.UTC(y, dob.getUTCMonth(), dob.getUTCDate()));
  // Date.UTC rolls 29 Feb into 1 Mar by itself in a common year — exactly the rule above
  return d;
}

/** Whole years between `dob` and `today`. */
export function ageOn(dob: Date, today: Date): number {
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  if (birthdayAt(dob, age) > today) age--;
  return age;
}

export type BirthDateProblem = "invalid" | "future" | "too_old";

/** Checks a date of birth as typed. */
export function checkBirthDate(raw: unknown, today: Date = todayUtc()): { ok: true; dob: Date } | { ok: false; problem: BirthDateProblem } {
  const dob = parseIsoDate(raw);
  if (!dob) return { ok: false, problem: "invalid" };
  if (dob > today) return { ok: false, problem: "future" };
  if (ageOn(dob, today) > MAX_AGE) return { ok: false, problem: "too_old" };
  return { ok: true, dob };
}

/** The outcome kept for a date of birth: adult, or minor until the day they turn 18. */
export function evaluateBirthDate(dob: Date, today: Date = todayUtc()): AgeOutcome {
  if (ageOn(dob, today) >= ADULT_AGE) return { result: "adult" };
  return { result: "minor", eligibleOn: isoDate(birthdayAt(dob, ADULT_AGE)) };
}

export const BIRTH_DATE_PROBLEM_TEXT: Record<BirthDateProblem, string> = {
  invalid: "Enter your date of birth.",
  future: "That date is in the future.",
  too_old: "Check the year you were born.",
};
