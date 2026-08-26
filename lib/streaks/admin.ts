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

  /* ── The loss/restore ledger (migration 0135) ─────────────────────────────
     Owner, 2026-08-25: "how many days lost and restored".

     🔴 THESE START AT ZERO AND ACCRUE FORWARD. Before 0135 a broken run left no
     trace — `applyActivity` overwrote `current_streak` with 1 and the length of
     the run that just ended ceased to exist. There is nothing to backfill from,
     so `ledgerSince` carries the first day the ledger could have recorded
     anything and the UI states it. Presenting an empty ledger as "nobody has
     ever lost a streak" would be a fabricated statistic. */
  /** Total DAYS lost across all recorded losses. */
  daysLost: number;
  /** How many runs ended. */
  lossEvents: number;
  /** Total DAYS brought back by restores. */
  daysRestored: number;
  /** How many restores happened (distinct from `restored`, which counts PEOPLE). */
  restoreEvents: number;
  /** Earliest event on record — null when the ledger is still empty. */
  ledgerSince: string | null;
}

/**
 * One signed-in member currently on a streak. The owner asked to "see signed in
 * users who are on streak and how many days streak" — a LIST, not another
 * scalar, so this is a separate read rather than a field on the metrics above.
 *
 * 🔴 Signed-in ONLY, by construction (`user_id is not null`). Anonymous streaks
 * are the majority of rows and have no name to show; `anonymousShare` above is
 * how their reach is reported, and this list says what it excludes.
 */
export interface StreakMember {
  userId: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | null;
  restoresUsed: number;
  /** Days lost by this member since the ledger began. */
  daysLost: number;
  /** Days this member has had restored. */
  daysRestored: number;
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
  daysLost: 0,
  lossEvents: 0,
  daysRestored: 0,
  restoreEvents: 0,
  ledgerSince: null,
};

/**
 * Sum the loss/restore ledger.
 *
 * 🔴 PAGED, not a bare `select`. PostgREST silently truncates at 1000 rows —
 * this project has already shipped a wrong number that way — and a sum over a
 * truncated page is exactly the "confident wrong answer" that incident produced.
 * Reading in explicit ranges until a short page comes back is the honest form,
 * and the ledger is small (one row per streak break, ever) so this is a couple
 * of round trips at most for a long time.
 */
async function readLedger(db: ReturnType<typeof createAdminClient>) {
  const PAGE = 1000;
  let from = 0;
  let daysLost = 0;
  let lossEvents = 0;
  let daysRestored = 0;
  let restoreEvents = 0;
  let ledgerSince: string | null = null;

  for (;;) {
    const { data, error } = await db
      .from("streak_events")
      .select("kind, days, occurred_on")
      .order("occurred_on", { ascending: true })
      .range(from, from + PAGE - 1);
    // A missing table (migration not yet applied) must read as an empty
    // ledger, never as a crashed dashboard.
    if (error) break;
    const rows = (data ?? []) as { kind: string; days: number; occurred_on: string }[];
    if (rows.length === 0) break;

    if (ledgerSince === null && rows[0]) ledgerSince = rows[0].occurred_on;
    for (const r of rows) {
      if (r.kind === "lost") {
        daysLost += r.days;
        lossEvents += 1;
      } else if (r.kind === "restored") {
        daysRestored += r.days;
        restoreEvents += 1;
      }
    }

    if (rows.length < PAGE) break;
    from += PAGE;
  }

  return { daysLost, lossEvents, daysRestored, restoreEvents, ledgerSince };
}

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

    const [activeStreaks, streaks2Plus, streaks7Plus, streaks30Plus, atRisk, restored, remindersToday, anonymous, pushFailures24h, ledger] =
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
        readLedger(db),
      ]);

    return {
      ...ledger,
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

/**
 * The signed-in members currently on a streak, longest first.
 *
 * Owner, 2026-08-25: "I want to be able to see signed in users who are on streak
 * and how many days streak and how many days lost and restored."
 *
 * ── Why a bounded list and not "all of them" ─────────────────────────────────
 * `limit` is applied in the QUERY, not after the fetch. Ordering by
 * `current_streak desc` in Postgres and taking the top N is an index-ordered
 * read; pulling every streak row and sorting in Node is the shape that silently
 * became a 1000-row truncation elsewhere in this codebase and reported a
 * confidently wrong number. If this ever needs to be exhaustive it should be
 * paged like `readLedger`, never unbounded.
 */
export async function getStreakMembers(limit = 50): Promise<StreakMember[]> {
  if (!hasSupabase) return [];

  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("streaks")
      .select("id, user_id, current_streak, longest_streak, last_activity_date, restores_used")
      // Signed-in only — an anonymous row has no name to show. The panel says
      // so, and `anonymousShare` is where their reach is reported instead.
      .not("user_id", "is", null)
      .gte("current_streak", 1)
      .order("current_streak", { ascending: false })
      .limit(limit);
    if (error || !data) return [];

    const rows = data as {
      id: string;
      user_id: string;
      current_streak: number;
      longest_streak: number;
      last_activity_date: string | null;
      restores_used: number;
    }[];
    if (rows.length === 0) return [];

    /*
      Two follow-up reads, both keyed by the ids we already have — never a
      per-row query in a loop, which is the N+1 the performance gate calls out
      by name.
    */
    const [profiles, events] = await Promise.all([
      db
        .from("profiles")
        .select("id, handle, display_name, avatar_url")
        .in("id", rows.map((r) => r.user_id)),
      db
        .from("streak_events")
        .select("streak_id, kind, days")
        .in("streak_id", rows.map((r) => r.id)),
    ]);

    const profileById = new Map<string, { handle: string | null; display_name: string | null; avatar_url: string | null }>();
    for (const p of (profiles.data ?? []) as {
      id: string;
      handle: string | null;
      display_name: string | null;
      avatar_url: string | null;
    }[]) {
      profileById.set(p.id, p);
    }

    const ledgerByStreak = new Map<string, { lost: number; restored: number }>();
    for (const e of (events.data ?? []) as { streak_id: string; kind: string; days: number }[]) {
      const acc = ledgerByStreak.get(e.streak_id) ?? { lost: 0, restored: 0 };
      if (e.kind === "lost") acc.lost += e.days;
      else if (e.kind === "restored") acc.restored += e.days;
      ledgerByStreak.set(e.streak_id, acc);
    }

    return rows.map((r) => {
      const p = profileById.get(r.user_id);
      const led = ledgerByStreak.get(r.id);
      return {
        userId: r.user_id,
        handle: p?.handle ?? null,
        displayName: p?.display_name ?? null,
        avatarUrl: p?.avatar_url ?? null,
        currentStreak: r.current_streak ?? 0,
        longestStreak: r.longest_streak ?? 0,
        lastActivityDate: r.last_activity_date,
        restoresUsed: r.restores_used ?? 0,
        daysLost: led?.lost ?? 0,
        daysRestored: led?.restored ?? 0,
      } satisfies StreakMember;
    });
  } catch {
    return [];
  }
}
