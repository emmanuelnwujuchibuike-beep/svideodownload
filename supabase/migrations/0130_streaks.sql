-- 0130_streaks.sql
-- Universal daily streak system: signed-in AND anonymous, with a per-day
-- idempotency guarantee and anonymous push support.
-- Idempotent.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ONE ROW PER IDENTITY, AND AN IDENTITY IS EXACTLY ONE OF TWO THINGS
-- ═══════════════════════════════════════════════════════════════════════════
-- A streak belongs either to an account (`user_id`) or to an anonymous browser
-- identity (`anon_id`) — never both, never neither. The CHECK enforces that at
-- the database rather than in application code, because the merge path
-- (anonymous → signed-in) is exactly where a half-written identity would
-- otherwise appear and quietly create a second streak for one person.
--
-- Dates are stored as `date`, not `timestamptz`. A streak day is a LOCAL
-- CALENDAR DAY, and once the application has named it (lib/streaks/calc.ts,
-- from server time + the user's IANA zone) it must stay that label: keeping an
-- instant would re-introduce the timezone question on every read and let a DST
-- transition shift a day boundary after the fact.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY A SEPARATE DAILY-ACTIVITY TABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- `streaks.last_activity_date` alone would be enough to compute a streak, but
-- not enough to make crediting IDEMPOTENT under concurrency. Five tabs waking
-- together, or a phone and a laptop in the same second, all read the same
-- `last_activity_date` and all decide to increment.
--
-- The composite primary key below is the lock: the FIRST insert for
-- (streak, day) wins and every other one is a duplicate-key error the
-- application swallows. That is the whole anti-double-credit mechanism, and it
-- is enforced by Postgres rather than by hoping the reads interleave politely.
-- It also gives the 7-day profile calendar a real history to render instead of
-- an inferred one.

-- ---------------------------------------------------------------------
-- Streaks.
-- ---------------------------------------------------------------------
create table if not exists public.streaks (
  id                        uuid primary key default uuid_generate_v4(),
  user_id                   uuid references auth.users (id) on delete cascade,
  -- Opaque server-minted id carried in an httpOnly cookie. Text, not uuid, so a
  -- future identity scheme does not need a type migration.
  anon_id                   text,
  current_streak            integer not null default 0,
  longest_streak            integer not null default 0,
  last_activity_date        date,
  streak_started_at         date,
  total_active_days         integer not null default 0,
  -- The user's IANA zone, kept so the 2pm reminder job can work out THEIR local
  -- afternoon without the browser being open to ask.
  timezone                  text,
  restore_deadline          date,
  last_celebration_date     date,
  last_reminder_date        date,
  last_streak_increment_at  timestamptz,
  -- Lifetime restores spent. Caps abuse without a time-window to wait out.
  restores_used             integer not null default 0,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint streaks_one_identity check (num_nonnulls(user_id, anon_id) = 1)
);

-- Partial uniques: one streak per account, one per anonymous identity. Partial
-- rather than plain UNIQUE because the other column is NULL on every row of the
-- opposite kind, and NULLs do not conflict in a plain unique index.
create unique index if not exists streaks_user_uidx on public.streaks (user_id) where user_id is not null;
create unique index if not exists streaks_anon_uidx on public.streaks (anon_id) where anon_id is not null;

-- The reminder job's access path: live streaks that have not been active today.
-- Partial, so it indexes only the rows the job can possibly care about.
create index if not exists streaks_reminder_idx
  on public.streaks (last_activity_date)
  where current_streak > 0;

alter table public.streaks enable row level security;

-- Owners may read their own row. Everything that WRITES goes through the
-- service role in lib/streaks/engine.ts — the brief's "do not trust the client
-- for security-sensitive streak calculations" is enforced by there being no
-- client-writable policy at all. Anonymous rows have no readable policy either;
-- they are only ever reached server-side via the httpOnly cookie.
drop policy if exists "streak owner read" on public.streaks;
create policy "streak owner read" on public.streaks
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Daily activity — the idempotency ledger.
-- ---------------------------------------------------------------------
create table if not exists public.streak_daily_activity (
  streak_id     uuid not null references public.streaks (id) on delete cascade,
  activity_date date not null,
  created_at    timestamptz not null default now(),
  primary key (streak_id, activity_date)
);

alter table public.streak_daily_activity enable row level security;

drop policy if exists "streak activity owner read" on public.streak_daily_activity;
create policy "streak activity owner read" on public.streak_daily_activity
  for select using (
    exists (
      select 1 from public.streaks s
      where s.id = streak_daily_activity.streak_id and s.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- Anonymous push subscriptions.
-- ---------------------------------------------------------------------
-- The brief (§13) requires an anonymous installed PWA to be able to receive the
-- 2pm reminder. `push_subscriptions.user_id` was NOT NULL, so today an
-- anonymous browser has nowhere to register.
--
-- 🔴 EXTENDED, NOT DUPLICATED. A second subscriptions table would mean two
-- senders, two cleanup paths and two places for a stale endpoint to rot — the
-- "do not create duplicate systems" rule. These two statements are additive and
-- cannot affect an existing row or query: dropping NOT NULL widens what is
-- accepted, and the new column is nullable. Every existing read filters on
-- `user_id = <id>`, which keeps matching exactly what it matched before, and
-- the existing RLS policies (`user_id = auth.uid()`) simply never match an
-- anonymous row — which is correct, since only the service role should reach
-- them.
alter table public.push_subscriptions alter column user_id drop not null;
alter table public.push_subscriptions add column if not exists anon_id text;

create index if not exists push_subscriptions_anon_idx
  on public.push_subscriptions (anon_id) where anon_id is not null;

-- A subscription must belong to exactly one identity, same rule as streaks.
-- Guarded so re-running the migration does not fail on an existing constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'push_subscriptions_one_identity'
  ) then
    alter table public.push_subscriptions
      add constraint push_subscriptions_one_identity
      check (num_nonnulls(user_id, anon_id) = 1);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- updated_at.
-- ---------------------------------------------------------------------
create or replace function public.streaks_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists streaks_touch_updated_at on public.streaks;
create trigger streaks_touch_updated_at
  before update on public.streaks
  for each row execute function public.streaks_touch_updated_at();

-- ---------------------------------------------------------------------
-- Delivery logging for anonymous pushes.
-- ---------------------------------------------------------------------
-- `push_delivery_log.user_id` is NOT NULL, so an anonymous streak reminder
-- currently has nowhere to record a send, a retry or a prune — and the admin
-- "Push delivery" monitor reads exactly this table. Rather than let anonymous
-- deliveries go unobserved (or, worse, duplicate the sender to avoid the
-- constraint), the column is relaxed the same way `push_subscriptions.user_id`
-- was above and an `anon_id` is added beside it.
--
-- Additive and safe: every existing insert supplies `user_id`, and every
-- existing read filters or groups by it, so nothing that works today changes.
alter table public.push_delivery_log alter column user_id drop not null;
alter table public.push_delivery_log add column if not exists anon_id text;
