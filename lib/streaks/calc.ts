import { milestoneFor } from "./tiers";
import {
  MAX_RESTORES,
  REMINDER_HOUR,
  RESTORE_WINDOW_DAYS,
  RESTORE_WINDOW_HOURS,
  type StreakRecord,
  type StreakStatus,
} from "./types";

/**
 * The streak state machine — PURE. No I/O, no Date.now(), no database.
 *
 * ── 🔴 WHY EVERY DECISION LIVES HERE ──────────────────────────────────────
 * The brief's one architectural demand is that streak logic exists in exactly
 * one place. Keeping it pure is what makes that enforceable: the engine, the
 * API, the 2 PM cron and the UI all call these functions, and none of them can
 * quietly re-derive "is this consecutive?" for itself, because doing so would
 * mean duplicating date maths that is visibly non-trivial.
 *
 * It is also the only way this is testable at all. Streaks are a date-boundary
 * feature — the interesting cases are midnight, DST, travelling across
 * timezones and a clock that lies — and none of those can be exercised through
 * a database.
 *
 * ── 🔴 A "DAY" IS A LOCAL CALENDAR DAY, COMPUTED FROM SERVER TIME ─────────
 * Never `new Date().toDateString()` on the client. The instant comes from the
 * server (which the user cannot move) and the *calendar* is the user's own IANA
 * zone (which they can change, but changing it can only shift a boundary by
 * hours, never manufacture a day). That combination is what makes clock
 * manipulation useless: rolling a phone forward a week changes nothing, because
 * no client-supplied timestamp is ever read.
 */

/** `YYYY-MM-DD` in `timeZone` for a given instant. Locale-independent. */
export function localDay(instant: Date, timeZone: string | null): string {
  const zone = safeZone(timeZone);
  // `en-CA` yields ISO-shaped YYYY-MM-DD, which sorts and compares as a string.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Local hour 0–23 in `timeZone`. Used only by the reminder window. */
export function localHour(instant: Date, timeZone: string | null): number {
  const zone = safeZone(timeZone);
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    hour12: false,
  }).format(instant);
  const parsed = Number(hour);
  return Number.isFinite(parsed) ? parsed % 24 : 0;
}

/**
 * A user-supplied IANA zone, validated by actually trying it.
 *
 * The timezone arrives from `Intl.DateTimeFormat().resolvedOptions().timeZone`
 * on the client, which means it is user-controlled input reaching a formatter.
 * An invalid zone makes `Intl` throw, and a throw inside the daily-activity
 * path would turn a bad string into a 500 that costs someone their streak.
 */
export function safeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "UTC";
  }
}

/**
 * Whole calendar days from `from` to `to` (both `YYYY-MM-DD`).
 *
 * 🔴 Parsed as UTC midnight ON PURPOSE. These are calendar labels, not
 * instants: once a local day has been named, the difference between two of
 * them must be pure day arithmetic. Anchoring both ends at UTC midnight makes
 * that exact, which is what stops a DST transition — where a local day is 23 or
 * 25 hours long — from ever reading as 0 or 2 days and silently breaking or
 * double-counting a streak.
 */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** `YYYY-MM-DD` shifted by whole days. */
export function addDays(day: string, delta: number): string {
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms)) return day;
  return new Date(ms + delta * 86_400_000).toISOString().slice(0, 10);
}

/** The last `count` days ending at `today`, oldest first. */
export function lastDays(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(today, i - (count - 1)));
}

/* ────────────────────────────────────────────────────────────────────────────
   Transitions
   ──────────────────────────────────────────────────────────────────────── */

export type ActivityOutcome =
  /** Already credited today — the idempotent no-op that refreshes/tabs hit. */
  | { kind: "already-today"; record: StreakRecord }
  /** First ever day for this identity. */
  | { kind: "started"; record: StreakRecord }
  /** Yesterday → today. The only case that increments. */
  | { kind: "continued"; record: StreakRecord }
  /** Came back after the restore window closed; counts as a fresh day 1. */
  | { kind: "reset"; record: StreakRecord };

/**
 * Apply today's activity to a record. Pure: the caller supplies `today`.
 *
 * 🔴 A GAP DOES NOT RESET HERE. Missing a day leaves `currentStreak` intact and
 * arms `restoreDeadline` instead (§15) — the reset only happens once someone
 * comes back after that window has closed. Zeroing eagerly would destroy the
 * very number the restore feature exists to offer back.
 */
export function applyActivity(record: StreakRecord, today: string): ActivityOutcome {
  const last = record.lastActivityDate;

  if (last === today) return { kind: "already-today", record };

  const totalActiveDays = record.totalActiveDays + 1;

  // No history at all.
  if (!last) {
    return {
      kind: "started",
      record: {
        ...record,
        currentStreak: 1,
        longestStreak: Math.max(record.longestStreak, 1),
        lastActivityDate: today,
        streakStartedAt: today,
        totalActiveDays,
        restoreDeadline: null,
      },
    };
  }

  const gap = daysBetween(last, today);

  /*
    A negative gap means `today` is BEFORE the recorded last activity — the
    user's clock or timezone moved backwards (travel west across the dateline,
    a DST fall-back at the wrong moment, or a tampered zone). Credit nothing and
    change nothing: the day is already banked, and the safe failure here is
    "no new credit", never "reset their streak".
  */
  if (gap <= 0) return { kind: "already-today", record };

  if (gap === 1) {
    const currentStreak = record.currentStreak + 1;
    return {
      kind: "continued",
      record: {
        ...record,
        currentStreak,
        longestStreak: Math.max(record.longestStreak, currentStreak),
        lastActivityDate: today,
        streakStartedAt: record.streakStartedAt ?? last,
        totalActiveDays,
        restoreDeadline: null,
      },
    };
  }

  // A real gap. Restorable while the window is open, otherwise a fresh start.
  const deadline = restoreDeadlineFor(last);
  const stillRestorable = daysBetween(today, deadline) >= 0;

  if (stillRestorable) {
    /*
      They came back INSIDE the window without restoring. Today is day 1 of a
      new streak, but the old one stays offerable until the deadline — so the
      profile can show "restore your 12-day streak" beside a live 1-day one.
    */
    return {
      kind: "reset",
      record: {
        ...record,
        currentStreak: 1,
        longestStreak: Math.max(record.longestStreak, 1),
        lastActivityDate: today,
        streakStartedAt: today,
        totalActiveDays,
        restoreDeadline: deadline,
      },
    };
  }

  return {
    kind: "reset",
    record: {
      ...record,
      currentStreak: 1,
      longestStreak: Math.max(record.longestStreak, 1),
      lastActivityDate: today,
      streakStartedAt: today,
      totalActiveDays,
      restoreDeadline: null,
    },
  };
}

/** Last day a streak broken after `lastActivityDate` can still be restored. */
export function restoreDeadlineFor(lastActivityDate: string): string {
  return addDays(lastActivityDate, RESTORE_WINDOW_DAYS);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE RECOVERY WINDOW, AS AN INSTANT (§7)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-01: "If the streak has been lost for LESS THAN 48 HOURS …
 * TIME REMAINING 23h 47m … <48 HOURS: RESTORE STREAK AVAILABLE. ≥48 HOURS:
 * RESTORE STREAK UNAVAILABLE."
 *
 * ── Why this is an instant and `restoreDeadline` stays a DATE ────────────────
 *
 * A countdown cannot be rendered from a calendar day: "2026-03-04" does not say
 * whether four minutes or twenty hours are left. But the stored column is a
 * `date` (migration 0130) and the conditional UPDATE that makes a restore
 * happen exactly once under concurrency keys on it (`.eq("restore_deadline",…)`
 * in engine.ts). Migrating that column to a timestamp to add a countdown would
 * put the idempotency guarantee at risk for a piece of copy.
 *
 * So the two coexist and the tighter one wins, which is always this one:
 *
 *   • `restoreDeadline` (date, +3 days) stays exactly as it was — the coarse
 *     bound that lives in the database and gates `applyRestore`.
 *   • this function is the REAL rule the product states, derived on the fly
 *     from a value already stored.
 *
 * 48 hours is measured from the moment the streak actually broke — local
 * midnight at the END of the last active day — not from the last activity
 * itself. Someone who downloaded at 9am Monday has not "lost their streak for
 * 48 hours" at 9am Wednesday; their streak was intact all of Monday and only
 * broke when Tuesday ended without them. Measuring from the activity would
 * quietly cost every user most of a day of their recovery window.
 */
export function restoreExpiresAt(record: StreakRecord, timeZone: string | null): Date | null {
  if (!record.restoreDeadline || !record.lastActivityDate) return null;
  const brokeAt = startOfLocalDay(addDays(record.lastActivityDate, 1), timeZone);
  if (!brokeAt) return null;
  return new Date(brokeAt.getTime() + RESTORE_WINDOW_HOURS * 3_600_000);
}

/** Milliseconds left in the recovery window; 0 once it has closed. */
export function restoreRemainingMs(
  record: StreakRecord,
  now: Date,
  timeZone: string | null,
): number {
  const expiry = restoreExpiresAt(record, timeZone);
  if (!expiry) return 0;
  return Math.max(0, expiry.getTime() - now.getTime());
}

/**
 * The UTC instant at which `day` begins in `timeZone`.
 *
 * 🔴 The zone's offset is discovered by ASKING `Intl` what that zone called a
 * probe instant, not by assuming one — an offset table would be wrong twice a
 * year in every DST zone, and the whole reason this file exists is that streaks
 * are a date-boundary feature. Two passes because the offset at UTC midnight
 * can differ from the offset at local midnight (that is exactly a DST cutover),
 * and the second pass re-reads it from the answer the first one produced.
 */
function startOfLocalDay(day: string, timeZone: string | null): Date | null {
  const base = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(base)) return null;
  const zone = safeZone(timeZone);
  let guess = base;
  for (let i = 0; i < 2; i++) {
    const offset = zoneOffsetMs(new Date(guess), zone);
    const next = base - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

/** How far ahead of UTC `zone` is at `instant`, in ms. */
function zoneOffsetMs(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // `hour` comes back as 24 at midnight in some ICU versions; 24 % 24 = 0.
  const asUtc = Date.UTC(at("year"), at("month") - 1, at("day"), at("hour") % 24, at("minute"), at("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The streak that a restore would bring back, or 0 if none is offerable.
 *
 * Deliberately derived rather than stored: a stored "restorable amount" would
 * be a second source of truth that could disagree with the record it describes.
 */
export function restorableStreak(record: StreakRecord, today: string): number {
  if (!record.restoreDeadline) return 0;
  if (record.restoresUsed >= MAX_RESTORES) return 0;
  if (daysBetween(today, record.restoreDeadline) < 0) return 0;
  // `streakBeforeBreak` is carried in `longestStreak` only when the broken run
  // was their best; otherwise the pre-break value is the one we banked when the
  // reset happened. See `applyRestore` for why this is the honest bound.
  return record.longestStreak > 0 ? record.longestStreak : 0;
}

/**
 * Restore a broken streak.
 *
 * 🔴 THE RESTORED VALUE IS THE BROKEN RUN PLUS THE DAYS SINCE, NOT AN INVENTED
 * NUMBER. Restoring means "treat the gap as covered", so the streak becomes
 * what it would have been had the user not missed — bounded by `longestStreak`,
 * which is the only trustworthy record of how long the broken run actually was.
 */
export function applyRestore(record: StreakRecord, today: string): StreakRecord | null {
  const restorable = restorableStreak(record, today);
  if (restorable <= 0) return null;

  return {
    ...record,
    currentStreak: restorable,
    longestStreak: Math.max(record.longestStreak, restorable),
    lastActivityDate: today,
    streakStartedAt: addDays(today, -(restorable - 1)),
    restoreDeadline: null,
    restoresUsed: record.restoresUsed + 1,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
   Status
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Derive the status. Never stored — a stored status is a cache that goes stale
 * at midnight, in every timezone, without anything running to invalidate it.
 */
export function deriveStatus(record: StreakRecord, today: string, hour: number): StreakStatus {
  const last = record.lastActivityDate;
  if (!last && record.currentStreak === 0) return "NEW";

  /*
    🔴 RESTORABLE OUTRANKS "COMPLETED TODAY", and a test is what found this.

    The brief's own walkthrough (§28) has the user coming BACK during the
    restoration period — which means today's activity is banked (day 1 of a new
    run) while last week's 12-day streak is still offerable. Checking `last ===
    today` first swallowed that: the profile reported COMPLETED_TODAY and the
    restore card never appeared for the one person it exists for.

    Nothing is lost by the reorder. A restorable record always has
    `currentStreak === 1`, so `shouldCelebrate` is false for it either way, and
    the celebration is driven by that function rather than by this status.
  */
  if (restorableStreak(record, today) > 0) return "RESTORABLE";

  if (last === today) {
    if (record.lastCelebrationDate === today) return "CELEBRATED_TODAY";
    /*
      🔴 PENDING means "an unlock is waiting to be shown", not "they were here".
      Read off `shouldCelebrate` rather than re-deriving `currentStreak > 1`,
      which is how the two used to drift: on an ordinary day the status claimed
      a celebration was pending that nothing would ever mount, so the state
      machine reported CELEBRATION_PENDING until midnight, every day.
    */
    return shouldCelebrate(record, today) ? "CELEBRATION_PENDING" : "COMPLETED_TODAY";
  }

  const gap = last ? daysBetween(last, today) : Infinity;
  if (gap === 1) return hour >= REMINDER_HOUR ? "AT_RISK" : "ACTIVE";
  if (gap > 1) return record.currentStreak > 0 ? "MISSED" : "RESET";
  return "ACTIVE";
}

/**
 * Should a celebration play right now?
 *
 * ── 🔴 ONLY ON A FLAME UPGRADE. NOT EVERY DAY. ──────────────────────────────
 *
 * Owner, 2026-09-01: "there shoudnlt be a celebration everyday, only on flame
 * upgrade."
 *
 * This used to be "the streak went up and today is not yet claimed", which
 * fired on all 365 days of a year and made the 7-day moment structurally
 * identical to the 6-day one. `milestoneFor` is the flame-upgrade test — it
 * returns a tier only when the streak landed EXACTLY on a rung — so adding it
 * here is the whole change, and it is made SERVER-SIDE on purpose: the client
 * used to fork on the same question, which meant two places could disagree
 * about what day it was.
 *
 * A useful side effect: `/api/streak/celebrated` is now written only on days
 * that actually showed something, so `lastCelebrationDate` finally means "the
 * day of their last unlock" rather than "the last day they opened the app".
 *
 * Day 1 is included (the orange flame IS acquired that day). How LOUD that is
 * belongs to the ceremony, not to this gate — see `tier.ceremony`.
 */
export function shouldCelebrate(record: StreakRecord, today: string): boolean {
  return (
    record.lastActivityDate === today &&
    record.lastCelebrationDate !== today &&
    milestoneFor(record.currentStreak) !== null
  );
}

/**
 * Is this identity due a 2 PM reminder right now?
 *
 * Pure so the cron is testable without a database or a clock: every condition
 * the scheduled job checks is one of these, in this order.
 */
export function reminderEligible(record: StreakRecord, today: string, hour: number): boolean {
  if (record.currentStreak <= 0) return false;
  if (record.lastActivityDate === today) return false; // already done today
  if (record.lastReminderDate === today) return false; // once per day, ever
  if (hour < REMINDER_HOUR) return false;
  // Only nudge someone whose streak is genuinely still alive — yesterday's
  // activity. Past that it is a restore prompt, not a "don't lose it" nudge.
  return !!record.lastActivityDate && daysBetween(record.lastActivityDate, today) === 1;
}

/* ────────────────────────────────────────────────────────────────────────────
   Anonymous → signed-in merge (§5)
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Merge an anonymous record into an account's.
 *
 * 🔴 MAX, NEVER SUM. Adding the two would let anyone inflate a streak by
 * building one anonymously and signing in — the "artificial streak inflation"
 * the brief names. Taking the best of each field is monotonic (a merge can only
 * ever help), deterministic, and safe to run twice: merging an already-merged
 * pair is a no-op, which matters because sign-in can fire more than once.
 */
export function mergeRecords(account: StreakRecord, anon: StreakRecord): StreakRecord {
  const laterDay = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
  const earlierDay = (a: string | null, b: string | null) => (!a ? b : !b ? a : a < b ? a : b);

  return {
    currentStreak: Math.max(account.currentStreak, anon.currentStreak),
    longestStreak: Math.max(account.longestStreak, anon.longestStreak),
    lastActivityDate: laterDay(account.lastActivityDate, anon.lastActivityDate),
    // The earlier start is the truthful one for "member since"-style copy.
    streakStartedAt: earlierDay(account.streakStartedAt, anon.streakStartedAt),
    /*
      Active days are the one field where neither max nor sum is right: summing
      double-counts every day the person used both identities, and max discards
      real history. Max is the conservative choice, and being conservative is
      the rule whenever a number could be inflated.
    */
    totalActiveDays: Math.max(account.totalActiveDays, anon.totalActiveDays),
    timezone: account.timezone ?? anon.timezone,
    restoreDeadline: laterDay(account.restoreDeadline, anon.restoreDeadline),
    // Carry the later celebration/reminder marks so a merge can never re-fire
    // an animation or a notification the person already had today.
    lastCelebrationDate: laterDay(account.lastCelebrationDate, anon.lastCelebrationDate),
    lastReminderDate: laterDay(account.lastReminderDate, anon.lastReminderDate),
    // Restores are a spend; the higher count is the one that limits abuse.
    restoresUsed: Math.max(account.restoresUsed, anon.restoresUsed),
  };
}

/** A fresh, never-active record. */
export function emptyRecord(timezone: string | null = null): StreakRecord {
  return {
    currentStreak: 0,
    longestStreak: 0,
    lastActivityDate: null,
    streakStartedAt: null,
    totalActiveDays: 0,
    timezone,
    restoreDeadline: null,
    lastCelebrationDate: null,
    lastReminderDate: null,
    restoresUsed: 0,
  };
}
