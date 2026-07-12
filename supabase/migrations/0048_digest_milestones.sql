set lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- Part 8 — Smart Daily Digest preferences + last-sent tracking. Purely
-- additive columns on the existing notification_settings table (0046).
-- ---------------------------------------------------------------------
alter table public.notification_settings
  add column if not exists digest_enabled boolean not null default true,
  add column if not exists last_digest_sent_at timestamptz;

-- ---------------------------------------------------------------------
-- Part 8 — Achievement/milestone tracking. One row per (user, milestone)
-- ever celebrated — the unique constraint is what makes "did we already
-- notify this milestone" a single idempotent upsert-or-skip instead of
-- needing separate read-then-write logic, and stops a fluctuating count
-- (e.g. a follow/unfollow right at a threshold) from re-firing the same
-- milestone repeatedly. `milestone` itself is an EXISTING notification
-- type (notifications_type_chk already includes it, since 0018) that has
-- simply never been inserted anywhere until this round — no constraint
-- change needed here.
-- ---------------------------------------------------------------------
create table if not exists public.milestone_log (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  milestone_type  text not null check (milestone_type in ('followers', 'downloads')),
  milestone_value integer not null,
  created_at      timestamptz not null default now(),
  unique (user_id, milestone_type, milestone_value)
);
create index if not exists milestone_log_user_idx on public.milestone_log (user_id);

alter table public.milestone_log enable row level security;
-- No policies — service-role only. This is a system-managed dedupe log, not
-- user-facing data (the celebratory MOMENT is the `notifications` row this
-- produces, which the user already has full read/delete access to via the
-- existing notifications RLS policy).
