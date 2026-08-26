-- ============================================================================
--  0135 — STREAK EVENT LEDGER (loss + restore)
-- ============================================================================
--
-- Owner, 2026-08-25: "I want to be able to see signed in users who are on
-- streak and how many days streak and how many days lost and restored."
--
-- The first two were already answerable from `public.streaks`. The last two
-- were NOT, and this is the reason:
--
--   • A LOSS leaves no trace at all. `applyActivity` returns `kind: "reset"`
--     and overwrites `current_streak` with 1 — the length of the run that just
--     broke is gone the instant it breaks. `longest_streak` only survives if
--     the broken run happened to be their personal best.
--   • A RESTORE increments `restores_used`, which is a lifetime COUNT. It says
--     a restore happened; it never says how many days it brought back or when.
--
-- So "how many days lost and restored" is a schema addition, not a query, and
-- inferring it from a current streak value would be a fabricated statistic —
-- the thing this project has a standing rule against.
--
-- 🔴 THIS IS NOT BACKFILLABLE. Losses before this migration were never written
-- down anywhere, so the counts start at zero and accrue forward. The admin
-- panel says so on the tile rather than presenting an empty ledger as "no
-- users have ever lost a streak". `restores_used` is unaffected and stays the
-- exact lifetime restore count it always was.

create table if not exists public.streak_events (
  id           bigint generated always as identity primary key,
  streak_id    uuid not null references public.streaks (id) on delete cascade,
  -- 'lost'     — a run ended; `days` is how long it had reached.
  -- 'restored' — a run was brought back; `days` is how many it returned.
  kind         text not null check (kind in ('lost', 'restored')),
  -- Always the length of the run in question, never a delta. A 'lost' row with
  -- days = 12 and a 'restored' row with days = 12 describe the same 12 days
  -- going away and coming back, which is exactly what the owner asked to see.
  days         integer not null check (days >= 0),
  -- The identity's LOCAL day, matching `streaks.last_activity_date`. Local, not
  -- UTC, because every other date on the streak record is local and one column
  -- disagreeing is how a "lost on the 14th" ends up next to a "restored on the
  -- 13th" for the same user.
  occurred_on  date not null,
  created_at   timestamptz not null default now()
);

-- The admin dashboard's two access paths: totals by kind over a window, and one
-- identity's history.
create index if not exists streak_events_kind_idx
  on public.streak_events (kind, occurred_on desc);
create index if not exists streak_events_streak_idx
  on public.streak_events (streak_id, occurred_on desc);

-- Same posture as `public.streaks`: every write goes through the service role
-- in lib/streaks/engine.ts, so RLS is enabled with NO client-writable policy.
-- A client cannot manufacture a loss or a restore because there is no policy
-- that would let it write one.
alter table public.streak_events enable row level security;

-- Owners may read their own history (the profile's streak card can show it
-- later). Anonymous rows stay unreadable — they are only ever reached
-- server-side through the httpOnly cookie, exactly like `streaks` itself.
drop policy if exists "streak events owner read" on public.streak_events;
create policy "streak events owner read" on public.streak_events
  for select using (
    exists (
      select 1 from public.streaks s
      where s.id = streak_events.streak_id and s.user_id = auth.uid()
    )
  );
