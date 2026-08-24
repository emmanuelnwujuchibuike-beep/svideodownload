import { isEnabled } from "@/lib/platform/flags-store";
import { sendPushToAnon, sendPushToUser } from "@/lib/push/web-push";
import { createAdminClient } from "@/lib/supabase/admin";

import { addDays, localDay, localHour, reminderEligible, safeZone } from "./calc";
import type { StreakRecord } from "./types";

/**
 * The 2 PM "don't lose your streak" reminder (brief §12/§14).
 *
 * ── 🔴 SERVER-SCHEDULED, BECAUSE 2 PM IS PER-PERSON ──────────────────────
 * "At 2 PM" is 24 different instants, and the brief is explicit that this must
 * not depend on a browser being open. The job therefore runs OFTEN (hourly) and
 * asks, for each candidate, "is it past 14:00 where THEY are?" — using the
 * timezone stored on their streak row. One run at a fixed UTC hour would reach
 * one band of the world and silently never fire for the rest.
 *
 * ── 🔴 CLAIM BEFORE SEND ─────────────────────────────────────────────────
 * `last_reminder_date` is written FIRST, with a conditional update that only
 * matches if today has not already been claimed. Whichever run wins the update
 * is the only one that sends. Sending first and marking afterwards would
 * double-notify whenever two runs overlap or one crashes mid-flight — and the
 * brief's hard line is "do not spam users".
 *
 * The cost of that ordering is a reminder lost if the push itself fails after
 * the claim. That is the right way round: a missed nudge is invisible, a
 * duplicate one is the reason people turn notifications off.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Bounded per run so one job can never fan out unboundedly. */
const MAX_CANDIDATES = 2000;

export const STREAK_REMINDER_TITLE = "🔥 Don't lose your streak!";
export const STREAK_REMINDER_BODY = "Come back to Frenzsave today to keep your streak alive.";

export interface ReminderRunResult {
  ok: boolean;
  /** Rows examined. */
  candidates: number;
  /** Rows whose local clock and history made them due. */
  eligible: number;
  /** Reminders actually claimed and dispatched. */
  sent: number;
  skippedDisabled?: boolean;
}

interface CandidateRow {
  id: string;
  user_id: string | null;
  anon_id: string | null;
  current_streak: number;
  last_activity_date: string | null;
  last_reminder_date: string | null;
  timezone: string | null;
}

export async function runStreakReminders(now: Date = new Date()): Promise<ReminderRunResult> {
  const empty: ReminderRunResult = { ok: true, candidates: 0, eligible: 0, sent: 0 };
  if (!hasSupabase) return empty;

  // Both switches: the system flag, then the notification flag (which declares
  // `requires: "streak-system"`, so this single read honours both).
  const enabled = await isEnabled("streak-notifications", {
    plan: "free",
    isAdmin: false,
    userId: null,
  }).catch(() => true);
  if (!enabled) return { ...empty, skippedDisabled: true };

  try {
    const db = createAdminClient();

    /*
      Candidate window: anyone whose last activity was within the last two UTC
      days. A live streak needing a nudge has yesterday's activity in THEIR
      calendar, and no timezone is more than ~26 hours from UTC, so two days is
      a safe superset. Narrowing in SQL is what keeps this job cheap; the exact
      per-person decision is `reminderEligible`, below.
    */
    const utcToday = localDay(now, "UTC");
    const { data } = await db
      .from("streaks")
      .select("id, user_id, anon_id, current_streak, last_activity_date, last_reminder_date, timezone")
      .gt("current_streak", 0)
      .gte("last_activity_date", addDays(utcToday, -2))
      .lte("last_activity_date", utcToday)
      .limit(MAX_CANDIDATES);

    const rows = (data ?? []) as CandidateRow[];
    let eligible = 0;
    let sent = 0;

    for (const row of rows) {
      const zone = safeZone(row.timezone);
      const today = localDay(now, zone);
      const hour = localHour(now, zone);

      // Only the fields the decision needs; the rest cannot affect it.
      const record: StreakRecord = {
        currentStreak: row.current_streak,
        longestStreak: 0,
        lastActivityDate: row.last_activity_date,
        streakStartedAt: null,
        totalActiveDays: 0,
        timezone: zone,
        restoreDeadline: null,
        lastCelebrationDate: null,
        lastReminderDate: row.last_reminder_date,
        restoresUsed: 0,
      };
      if (!reminderEligible(record, today, hour)) continue;
      eligible += 1;

      // Claim today. `or(...)` because the column is null before the first ever
      // reminder, and `neq` never matches null in SQL.
      const { data: claimed } = await db
        .from("streaks")
        .update({ last_reminder_date: today })
        .eq("id", row.id)
        .or(`last_reminder_date.is.null,last_reminder_date.neq.${today}`)
        .select("id");
      if (!claimed || claimed.length === 0) continue; // another run won it

      const payload = {
        title: STREAK_REMINDER_TITLE,
        body: STREAK_REMINDER_BODY,
        url: "/",
        // Collapse key: a second streak reminder replaces the first rather than
        // stacking, which is the difference between a nudge and nagging.
        tag: "streak-reminder",
      };
      if (row.user_id) await sendPushToUser(row.user_id, payload);
      else if (row.anon_id) await sendPushToAnon(row.anon_id, payload);
      sent += 1;
    }

    return { ok: true, candidates: rows.length, eligible, sent };
  } catch {
    // A failed run is a missed nudge, never an incident. The next hour retries.
    return { ...empty, ok: false };
  }
}
