import { isEnabled } from "@/lib/platform/flags-store";
import { sendPushToAnon, sendPushToUser } from "@/lib/push/web-push";
import { createAdminClient } from "@/lib/supabase/admin";

import { recordStreakNotification } from "./notifications";

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
  /** "Your streak ended" announcements claimed and dispatched. */
  lost?: number;
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

interface LostRow {
  id: string;
  user_id: string | null;
  current_streak: number;
  last_activity_date: string | null;
  timezone: string | null;
  lost_notified_date: string | null;
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
      // The push is the nudge; this is the record that survives dismissing it.
      // Deliberately after the send: a notification row is worth less than the
      // push, so it must never be able to prevent one.
      await recordStreakNotification(row.user_id, "streak_reminder", row.current_streak, today);
      sent += 1;
    }

    const lost = await announceLostStreaks(now);
    return { ok: true, candidates: rows.length, eligible, sent, lost };
  } catch {
    // A failed run is a missed nudge, never an incident. The next hour retries.
    return { ...empty, ok: false };
  }
}

/**
 * "Your streak ended" — announced once, when it actually ends.
 *
 * ── 🔴 WHY THIS NEEDS ITS OWN SWEEP ─────────────────────────────────────────
 * Nothing in this product ever *observes* a streak breaking. `current_streak`
 * is only recalculated when someone is active, so a member who stops visiting
 * keeps a stale positive number forever and no code path runs for them. The
 * reminder loop above cannot cover it either: it deliberately only looks at
 * streaks whose last activity was within two days, which is precisely the set
 * that has NOT been lost yet.
 *
 * ── 🔴 CLAIM BEFORE SEND, LIKE THE REMINDER ─────────────────────────────────
 * A broken streak stays broken until the member returns, so an unclaimed
 * announcement would repeat every hour, forever — the loudest possible bug.
 * `lost_notified_date` (0132) is written with a conditional UPDATE and only
 * the run that wins it sends.
 *
 * The streak itself is NOT reset here. `applyActivity` recomputes it from
 * `last_activity_date` on the member's next visit, and that remains the single
 * place the number is decided; writing it from two places is how the two
 * disagree.
 */
async function announceLostStreaks(now: Date): Promise<number> {
  const db = createAdminClient();
  const utcToday = localDay(now, "UTC");
  /*
    Three days rather than two: "lost" must be unambiguous in EVERY timezone.
    At two days a member on UTC+14 whose streak is merely at risk would be told
    it had ended. The restore window (§16) also lives in those first days, so
    announcing a loss while it can still be restored would be wrong twice.
  */
  const { data } = await db
    .from("streaks")
    .select("id, user_id, current_streak, last_activity_date, timezone, lost_notified_date")
    .gt("current_streak", 0)
    .not("user_id", "is", null) // anonymous identities cannot hold a notification row
    .lt("last_activity_date", addDays(utcToday, -3))
    .limit(MAX_CANDIDATES);

  let announced = 0;
  for (const row of (data ?? []) as LostRow[]) {
    const today = localDay(now, safeZone(row.timezone));
    if (row.lost_notified_date === today) continue;

    const { data: claimed } = await db
      .from("streaks")
      .update({ lost_notified_date: today })
      .eq("id", row.id)
      .or(`lost_notified_date.is.null,lost_notified_date.neq.${today}`)
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    if (row.user_id) {
      await sendPushToUser(row.user_id, {
        title: "Your streak ended",
        body: `Your ${row.current_streak}-day streak has ended. Start a new one today.`,
        url: "/",
        tag: "streak-lost",
      });
    }
    await recordStreakNotification(row.user_id, "streak_lost", row.current_streak, today);
    announced += 1;
  }
  return announced;
}
