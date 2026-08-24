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
  /** Local day the server computed this against — the client never decides it. */
  today: string;
  /** Last 7 local days, oldest → newest, for the profile calendar. */
  week: { date: string; active: boolean }[];
}

/** How many calendar days after a miss a streak can still be restored (§15). */
export const RESTORE_WINDOW_DAYS = 3;

/** Local hour after which an unfinished streak is AT_RISK and reminders fire (§12). */
export const REMINDER_HOUR = 14;

/**
 * Hard cap on restores per identity. Not in the brief's schema, but "do not
 * allow unlimited restoration abuse" (§15) needs a number, and a per-identity
 * lifetime cap is the simplest one that cannot be gamed by waiting.
 */
export const MAX_RESTORES = 3;
