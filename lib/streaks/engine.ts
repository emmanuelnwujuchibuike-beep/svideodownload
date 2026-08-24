import { createAdminClient } from "@/lib/supabase/admin";

import {
  applyActivity,
  applyRestore,
  deriveStatus,
  emptyRecord,
  lastDays,
  localDay,
  localHour,
  mergeRecords,
  restorableStreak,
  safeZone,
  shouldCelebrate,
} from "./calc";
import type { StreakIdentity } from "./identity";
import type { StreakRecord, StreakState } from "./types";

/**
 * The streak engine — the ONE place that reads or writes streak state.
 *
 * Every decision it makes comes from `calc.ts` (pure, tested); this file is
 * only persistence and idempotency. Components, pages, the API and the cron all
 * call in here, which is what keeps the brief's "do not duplicate streak
 * calculations" rule true rather than aspirational.
 *
 * ── 🔴 SERVICE ROLE, AND NO CLIENT-WRITABLE POLICY EXISTS ────────────────
 * Migration 0130 grants the owner SELECT and nothing else. Every mutation goes
 * through here on the service role, so a crafted request cannot set its own
 * streak: the only thing a client can say is "I was here", and the server
 * decides on its own clock what that is worth.
 *
 * ── 🔴 THE SERVER OWNS "TODAY" ───────────────────────────────────────────
 * `now` is always server time. The client contributes an IANA timezone and
 * nothing else, so moving a device clock forward a week changes nothing —
 * the calendar shifts by hours at most, never by days.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Postgres unique-violation. The signal that another tab won the race. */
const DUPLICATE = "23505";

interface Row {
  id: string;
  current_streak: number;
  longest_streak: number;
  last_activity_date: string | null;
  streak_started_at: string | null;
  total_active_days: number;
  timezone: string | null;
  restore_deadline: string | null;
  last_celebration_date: string | null;
  last_reminder_date: string | null;
  restores_used: number;
}

const SELECT =
  "id, current_streak, longest_streak, last_activity_date, streak_started_at, total_active_days, timezone, restore_deadline, last_celebration_date, last_reminder_date, restores_used";

function toRecord(row: Row): StreakRecord {
  return {
    currentStreak: row.current_streak ?? 0,
    longestStreak: row.longest_streak ?? 0,
    lastActivityDate: row.last_activity_date,
    streakStartedAt: row.streak_started_at,
    totalActiveDays: row.total_active_days ?? 0,
    timezone: row.timezone,
    restoreDeadline: row.restore_deadline,
    lastCelebrationDate: row.last_celebration_date,
    lastReminderDate: row.last_reminder_date,
    restoresUsed: row.restores_used ?? 0,
  };
}

function toColumns(record: StreakRecord): Record<string, unknown> {
  return {
    current_streak: record.currentStreak,
    longest_streak: record.longestStreak,
    last_activity_date: record.lastActivityDate,
    streak_started_at: record.streakStartedAt,
    total_active_days: record.totalActiveDays,
    timezone: record.timezone,
    restore_deadline: record.restoreDeadline,
    last_celebration_date: record.lastCelebrationDate,
    last_reminder_date: record.lastReminderDate,
    restores_used: record.restoresUsed,
  };
}

/** The filter that selects one identity's row. */
function where(identity: StreakIdentity) {
  return identity.kind === "user"
    ? { column: "user_id" as const, value: identity.userId }
    : { column: "anon_id" as const, value: identity.anonId };
}

/* ────────────────────────────────────────────────────────────────────────────
   Reads
   ──────────────────────────────────────────────────────────────────────── */

async function loadRow(identity: StreakIdentity): Promise<Row | null> {
  const { column, value } = where(identity);
  const { data } = await createAdminClient().from("streaks").select(SELECT).eq(column, value).maybeSingle();
  return (data as Row | null) ?? null;
}

/**
 * Load-or-create. `upsert` on the identity's partial unique index, so two
 * simultaneous first-ever requests produce one row rather than a conflict.
 */
async function ensureRow(identity: StreakIdentity, timezone: string | null): Promise<Row | null> {
  const existing = await loadRow(identity);
  if (existing) return existing;

  const { column, value } = where(identity);
  const { data, error } = await createAdminClient()
    .from("streaks")
    .upsert({ [column]: value, timezone }, { onConflict: column })
    .select(SELECT)
    .maybeSingle();
  // A lost upsert race still leaves a row — read it back rather than failing.
  if (error) return await loadRow(identity);
  return (data as Row | null) ?? null;
}

/** Which of the last 7 local days this identity was active, for the calendar. */
async function loadWeek(streakId: string, today: string): Promise<{ date: string; active: boolean }[]> {
  const days = lastDays(today, 7);
  try {
    const { data } = await createAdminClient()
      .from("streak_daily_activity")
      .select("activity_date")
      .eq("streak_id", streakId)
      .gte("activity_date", days[0]!)
      .lte("activity_date", today);
    const active = new Set(((data ?? []) as { activity_date: string }[]).map((r) => r.activity_date));
    return days.map((date) => ({ date, active: active.has(date) }));
  } catch {
    return days.map((date) => ({ date, active: false }));
  }
}

function toState(record: StreakRecord, now: Date, week: { date: string; active: boolean }[]): StreakState {
  const zone = safeZone(record.timezone);
  const today = localDay(now, zone);
  return {
    ...record,
    status: deriveStatus(record, today, localHour(now, zone)),
    shouldCelebrate: shouldCelebrate(record, today),
    canRestore: restorableStreak(record, today) > 0,
    restorableStreak: restorableStreak(record, today),
    today,
    week,
  };
}

/** The "no data / service unavailable" state. Never an error — see §24. */
export function neutralState(now: Date = new Date(), timezone: string | null = null): StreakState {
  const record = emptyRecord(timezone);
  const today = localDay(now, safeZone(timezone));
  return {
    ...record,
    status: "NEW",
    shouldCelebrate: false,
    canRestore: false,
    restorableStreak: 0,
    today,
    week: lastDays(today, 7).map((date) => ({ date, active: false })),
  };
}

export async function getStreak(identity: StreakIdentity, now: Date = new Date()): Promise<StreakState> {
  if (!hasSupabase) return neutralState(now);
  try {
    const row = await loadRow(identity);
    if (!row) return neutralState(now);
    const record = toRecord(row);
    return toState(record, now, await loadWeek(row.id, localDay(now, safeZone(record.timezone))));
  } catch {
    return neutralState(now);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   Writes
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Credit today's activity. Idempotent, and safe under concurrency.
 *
 * ── 🔴 THE LEDGER INSERT IS THE LOCK ─────────────────────────────────────
 * Five tabs waking together all read the same `last_activity_date` and all
 * conclude they should increment. Deciding in application code cannot fix that;
 * `streak_daily_activity`'s composite primary key can. Exactly one INSERT for
 * (streak, day) succeeds and every other one comes back `23505` — so the
 * winner is the only caller that ever applies the transition.
 *
 * ── The repair path ──────────────────────────────────────────────────────
 * If the ledger says today happened but the streak row disagrees, a previous
 * request crashed between the two writes. The ledger is the source of truth for
 * "did today happen", so we apply the transition anyway — guarded by a
 * conditional UPDATE that no-ops if another request has already repaired it.
 * Without this, that one crash would silently cost the user their day.
 */
export async function recordActivity(
  identity: StreakIdentity,
  timezone: string | null,
  now: Date = new Date(),
): Promise<StreakState> {
  if (!hasSupabase) return neutralState(now, timezone);

  try {
    const db = createAdminClient();
    const row = await ensureRow(identity, timezone);
    if (!row) return neutralState(now, timezone);

    // The zone we just learned wins over the stored one — people travel.
    const zone = safeZone(timezone ?? row.timezone);
    const today = localDay(now, zone);
    let record: StreakRecord = { ...toRecord(row), timezone: zone };

    const { error } = await db
      .from("streak_daily_activity")
      .insert({ streak_id: row.id, activity_date: today });

    const alreadyCredited = !!error && error.code === DUPLICATE;
    if (error && !alreadyCredited) {
      // A real write failure. Report what we know rather than inventing a day.
      return toState(record, now, await loadWeek(row.id, today));
    }

    const needsApply = !alreadyCredited || record.lastActivityDate !== today;
    if (needsApply) {
      const outcome = applyActivity(record, today);
      if (outcome.kind !== "already-today") {
        record = outcome.record;
        await db
          .from("streaks")
          .update({
            ...toColumns(record),
            last_streak_increment_at: outcome.kind === "continued" ? now.toISOString() : row.last_activity_date === today ? undefined : now.toISOString(),
          })
          .eq("id", row.id)
          // No-op if a concurrent repair already landed today.
          .or(`last_activity_date.is.null,last_activity_date.neq.${today}`);
      } else if (record.timezone !== row.timezone) {
        await db.from("streaks").update({ timezone: zone }).eq("id", row.id);
      }
    } else if (record.timezone !== row.timezone) {
      await db.from("streaks").update({ timezone: zone }).eq("id", row.id);
    }

    return toState(record, now, await loadWeek(row.id, today));
  } catch {
    // §24: the streak must never break the page. A failed credit is a missing
    // celebration, not an error screen — and never a falsely incremented streak.
    return neutralState(now, timezone);
  }
}

/**
 * Mark today celebrated, so the animation cannot replay.
 *
 * Conditional on the date, so two tabs that both saw `shouldCelebrate` cannot
 * both "claim" it and neither can a replay after midnight.
 */
export async function markCelebrated(identity: StreakIdentity, now: Date = new Date()): Promise<void> {
  if (!hasSupabase) return;
  try {
    const row = await loadRow(identity);
    if (!row) return;
    const today = localDay(now, safeZone(row.timezone));
    await createAdminClient()
      .from("streaks")
      .update({ last_celebration_date: today })
      .eq("id", row.id)
      .or(`last_celebration_date.is.null,last_celebration_date.neq.${today}`);
  } catch {
    /* a missed mark means at worst one replay; never worth an error */
  }
}

/** Restore an interrupted streak. Returns the new state, or null if not allowed. */
export async function restoreStreak(identity: StreakIdentity, now: Date = new Date()): Promise<StreakState | null> {
  if (!hasSupabase) return null;
  try {
    const db = createAdminClient();
    const row = await loadRow(identity);
    if (!row) return null;

    const record = toRecord(row);
    const today = localDay(now, safeZone(record.timezone));
    const restored = applyRestore(record, today);
    // `applyRestore` enforces the window AND the lifetime cap; a client that
    // calls this endpoint repeatedly simply gets null.
    if (!restored) return null;

    const { error } = await db
      .from("streaks")
      .update(toColumns(restored))
      .eq("id", row.id)
      // Only restore against the record we just read — a second concurrent
      // restore finds the deadline already cleared and changes nothing.
      .eq("restore_deadline", row.restore_deadline ?? "");
    if (error) return null;

    // The restored run counts today as active, so the calendar agrees with it.
    await db
      .from("streak_daily_activity")
      .insert({ streak_id: row.id, activity_date: today })
      .then(undefined, () => undefined);

    return toState(restored, now, await loadWeek(row.id, today));
  } catch {
    return null;
  }
}

/**
 * Fold an anonymous streak into an account's (§5).
 *
 * Runs on every authenticated streak request that still carries an anon cookie
 * — sign-in is not a single observable moment on the server, so the merge has
 * to be something that is safe to attempt repeatedly. `mergeRecords` is
 * idempotent and monotonic, and the anonymous row is deleted afterwards so the
 * same history cannot be counted twice.
 */
export async function mergeAnonymousStreak(userId: string, anonId: string): Promise<void> {
  if (!hasSupabase) return;
  try {
    const db = createAdminClient();
    const [anonRow, userRow] = await Promise.all([
      loadRow({ kind: "anon", anonId }),
      loadRow({ kind: "user", userId, anonId: null }),
    ]);
    if (!anonRow) return;

    if (!userRow) {
      // No account streak yet: adopt the anonymous row wholesale. Cheaper and
      // lossless compared with copy-then-delete, and it keeps the ledger rows
      // (and therefore the 7-day calendar) attached.
      await db.from("streaks").update({ user_id: userId, anon_id: null }).eq("id", anonRow.id);
      return;
    }

    const merged = mergeRecords(toRecord(userRow), toRecord(anonRow));
    await db.from("streaks").update(toColumns(merged)).eq("id", userRow.id);

    // Carry the anonymous activity days over, so the calendar and any future
    // recount see one continuous history. Conflicts are days both identities
    // already had — ignored rather than merged.
    const { data: days } = await db
      .from("streak_daily_activity")
      .select("activity_date")
      .eq("streak_id", anonRow.id);
    const rows = ((days ?? []) as { activity_date: string }[]).map((d) => ({
      streak_id: userRow.id,
      activity_date: d.activity_date,
    }));
    if (rows.length) {
      await db
        .from("streak_daily_activity")
        .upsert(rows, { onConflict: "streak_id,activity_date", ignoreDuplicates: true });
    }

    await db.from("streaks").delete().eq("id", anonRow.id);
  } catch {
    /* a failed merge leaves both rows intact and retries on the next request */
  }
}
