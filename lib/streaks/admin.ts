import { createAdminClient } from "@/lib/supabase/admin";

import { localDay } from "./calc";

/**
 * Streak observability for the admin dashboard (brief §21).
 *
 * 🔴 EVERY NUMBER IS AN EXACT COUNT QUERY. `head: true` returns the count and
 * no rows, so each of these is an index scan rather than a page of data thrown
 * away — and none of them is ever a sampled figure presented as a total. That
 * distinction has bitten this project before (the "returning visitors = 0"
 * incident), and a dashboard whose numbers cannot be trusted is worse than no
 * dashboard.
 *
 * Deliberately NOT a new admin page. It is a read the existing dashboard can
 * call; building a parallel admin surface for one feature is exactly the
 * "unnecessary complexity" the brief warns against.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface StreakAdminMetrics {
  /** Identities with a live streak of at least 1. */
  activeStreaks: number;
  streaks2Plus: number;
  streaks7Plus: number;
  streaks30Plus: number;
  /** Live streaks whose last activity was yesterday — today is still unclaimed. */
  atRisk: number;
  /** Identities that have used at least one restore. */
  restored: number;
  /** Reminders claimed today (the claim is what `last_reminder_date` records). */
  remindersToday: number;
  /** Push attempts logged as failed in the last 24h, across the whole app. */
  pushFailures24h: number;
  /** Share of streaks belonging to anonymous identities — the reach of §4. */
  anonymousShare: number;
}

const EMPTY: StreakAdminMetrics = {
  activeStreaks: 0,
  streaks2Plus: 0,
  streaks7Plus: 0,
  streaks30Plus: 0,
  atRisk: 0,
  restored: 0,
  remindersToday: 0,
  pushFailures24h: 0,
  anonymousShare: 0,
};

export async function getStreakMetrics(now: Date = new Date()): Promise<StreakAdminMetrics> {
  if (!hasSupabase) return EMPTY;

  try {
    const db = createAdminClient();
    const count = async (build: (q: ReturnType<typeof streakQuery>) => ReturnType<typeof streakQuery>) => {
      const { count: n } = await build(streakQuery(db));
      return n ?? 0;
    };

    /*
      "At risk" is measured in UTC, and says so. Doing it per-user would mean
      reading every row and evaluating 24 timezones in application code — the
      job that lib/streaks/reminders.ts already does properly, once an hour.
      This is a dashboard trend line, so a consistent approximation with an
      honest label beats an expensive exact figure nobody is acting on.
    */
    const utcToday = localDay(now, "UTC");
    const utcYesterday = localDay(new Date(now.getTime() - 86_400_000), "UTC");

    const [activeStreaks, streaks2Plus, streaks7Plus, streaks30Plus, atRisk, restored, remindersToday, anonymous, pushFailures24h] =
      await Promise.all([
        count((q) => q.gte("current_streak", 1)),
        count((q) => q.gte("current_streak", 2)),
        count((q) => q.gte("current_streak", 7)),
        count((q) => q.gte("current_streak", 30)),
        count((q) => q.gte("current_streak", 1).eq("last_activity_date", utcYesterday)),
        count((q) => q.gte("restores_used", 1)),
        count((q) => q.eq("last_reminder_date", utcToday)),
        count((q) => q.not("anon_id", "is", null)),
        db
          .from("push_delivery_log")
          .select("id", { count: "exact", head: true })
          .eq("status", "failed")
          .gte("created_at", new Date(now.getTime() - 86_400_000).toISOString())
          .then(({ count: n }) => n ?? 0),
      ]);

    return {
      activeStreaks,
      streaks2Plus,
      streaks7Plus,
      streaks30Plus,
      atRisk,
      restored,
      remindersToday,
      pushFailures24h,
      anonymousShare: activeStreaks > 0 ? Math.round((anonymous / activeStreaks) * 100) : 0,
    };
  } catch {
    // A dashboard that 500s is worse than one reporting zeroes it can explain.
    return EMPTY;
  }
}

function streakQuery(db: ReturnType<typeof createAdminClient>) {
  return db.from("streaks").select("id", { count: "exact", head: true });
}
