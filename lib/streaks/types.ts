/**
 * Frenzsave streak system — shared types.
 *
 * One vocabulary for the engine, the API, the cron and every component, so the
 * "do not duplicate streak calculations across components" rule has something
 * concrete to point at.
 */

/**
 * The state machine (brief §11).
 *
 * `CELEBRATION_PENDING` is the only transient one: it exists for the window
 * between "today's activity incremented the streak" and "the client confirmed
 * it showed the animation". It is derived, never stored — see `deriveStatus`.
 */
export type StreakStatus =
  | "NEW"
  | "ACTIVE"
  | "COMPLETED_TODAY"
  | "CELEBRATION_PENDING"
  | "CELEBRATED_TODAY"
  | "AT_RISK"
  | "MISSED"
  | "RESTORABLE"
  | "RESET";

/** The stored row, in application terms. All dates are `YYYY-MM-DD` local-day strings. */
export interface StreakRecord {
  currentStreak: number;
  longestStreak: number;
  /** Local calendar day of the last credited activity. */
  lastActivityDate: string | null;
  streakStartedAt: string | null;
  totalActiveDays: number;
  timezone: string | null;
  /** Last day on which a restore is still allowed (inclusive). */
  restoreDeadline: string | null;
  lastCelebrationDate: string | null;
  lastReminderDate: string | null;
  /** How many times this identity has restored. Caps abuse (brief §15). */
  restoresUsed: number;
}

/** What the client is given. Deliberately small — this rides in a hero island. */
export interface StreakState extends StreakRecord {
  status: StreakStatus;
  /**
   * Should the large celebration play right now? Derived server-side from
   * `lastCelebrationDate` vs today, so a refresh can never replay it.
   */
  shouldCelebrate: boolean;
  /** True while a missed streak can still be restored. */
  canRestore: boolean;
  /** The streak that would come back on restore (0 when nothing to restore). */
  restorableStreak: number;
  /**
   * When the recovery window closes, as an ISO instant — or null when there is
   * nothing to recover.
   *
   * 🔴 AN INSTANT, AND COMPUTED BY THE SERVER. The countdown the owner asked
   * for ("TIME REMAINING 23h 47m") has to tick against a fixed point, and the
   * client cannot be trusted to derive one: its clock is user-controlled, and a
   * device set forward would show a window that has closed as still open. The
   * browser only subtracts this from its own clock to draw a number; every
   * decision that matters is still made server-side against `canRestore`.
   */
  restoreExpiresAt: string | null;
  /**
   * Restores this identity has left (§7: "RESTORE STREAK · 1 AVAILABLE").
   *
   * Sent rather than having the client compute `MAX_RESTORES - restoresUsed`,
   * so the cap is not a number the client has an opinion about.
   */
  restoresRemaining: number;
  /** Local day the server computed this against — the client never decides it. */
  today: string;
  /** Last 7 local days, oldest → newest, for the profile calendar. */
  week: { date: string; active: boolean }[];
}

/**
 * How many calendar days after a miss a streak can still be restored (§15).
 *
 * ⚠️ This is the COARSE bound, kept because it is the shape of the stored
 * `restore_deadline` date column and of the conditional UPDATE that makes a
 * restore idempotent. The rule the product actually states and enforces is
 * `RESTORE_WINDOW_HOURS`, which is strictly tighter — see `restoreExpiresAt`.
 */
export const RESTORE_WINDOW_DAYS = 3;

/**
 * The recovery window the product promises, in hours from the break (§7).
 *
 * Owner, 2026-09-01: "<48 HOURS: RESTORE STREAK AVAILABLE. ≥48 HOURS: RESTORE
 * STREAK UNAVAILABLE." It is also what makes a real "TIME REMAINING 23h 47m"
 * countdown possible at all — a calendar day cannot be counted down.
 */
export const RESTORE_WINDOW_HOURS = 48;

/** Local hour after which an unfinished streak is AT_RISK and reminders fire (§12). */
export const REMINDER_HOUR = 14;

/**
 * Hard cap on restores per identity. Not in the brief's schema, but "do not
 * allow unlimited restoration abuse" (§15) needs a number, and a per-identity
 * lifetime cap is the simplest one that cannot be gamed by waiting.
 */
export const MAX_RESTORES = 3;
