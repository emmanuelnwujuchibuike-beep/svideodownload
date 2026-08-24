import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Streak events that persist in the Notification Center (migration 0132).
 *
 * Owner, 2026-08-24: "every streak reminder, lost and all stays in
 * notification". A web push is transient — dismissed, or missed while the
 * phone is locked, and the event leaves no trace. These rows are the record.
 *
 * ── 🔴 SIGNED-IN ONLY, AND THAT IS A SCHEMA FACT ────────────────────────────
 * `notifications.user_id` is NOT NULL and references `auth.users`, so an
 * anonymous identity CANNOT have a notification row. Today that is most of
 * them — 51 of 57 streaks are anonymous — so anonymous members keep getting
 * the push and get no history. That is a real limitation, recorded here rather
 * than papered over: giving anonymous identities a notification feed means
 * making the whole table nullable-owner and reworking its RLS, which is a much
 * larger change than this one.
 *
 * ── 🔴 NEVER THROWS ─────────────────────────────────────────────────────────
 * These are raised from inside the reminder sweep and the activity write. A
 * failed notification must never cost someone the streak credit or the push
 * that the same code path is delivering.
 */

export type StreakNotificationType = "streak_reminder" | "streak_milestone" | "streak_lost";

export async function recordStreakNotification(
  userId: string | null,
  type: StreakNotificationType,
  streak: number,
  day: string,
): Promise<boolean> {
  if (!userId) return false; // anonymous — no row is possible, see above
  try {
    const { error } = await createAdminClient()
      .from("notifications")
      .insert({
        user_id: userId,
        // No actor: a streak is between a member and their own habit, so the
        // card renders the verb alone rather than "<someone> did X".
        actor_id: null,
        type,
        // The day count the card shows, and the day it refers to — so a row
        // read a week later still says what it meant when it was written.
        data: { streak, day },
      });
    return !error;
  } catch {
    return false;
  }
}
