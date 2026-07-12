set lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- Part 7 — push delivery reliability. One row per delivery ATTEMPT
-- (sendPushToUser in lib/push/web-push.ts), not per notification, so a
-- device that needed a retry shows both attempts. This is intentionally a
-- handful of indexed COUNT/aggregate queries away from being "monitoring" —
-- see lib/social/messaging-stats.ts's identical reasoning for why this app's
-- real scale doesn't warrant a separate metrics pipeline/time-series store.
-- Operational data, not user-facing: RLS is enabled with NO policies, so it's
-- reachable only via the service-role admin client (the admin dashboard),
-- same as an application log would be.
-- ---------------------------------------------------------------------
create table if not exists public.push_delivery_log (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references public.push_subscriptions(id) on delete set null,
  tag             text,
  status          text not null check (status in ('sent','retried','failed','pruned')),
  status_code     int,
  error           text,
  attempt         int not null default 1,
  created_at      timestamptz not null default now()
);

create index if not exists push_delivery_log_created_idx on public.push_delivery_log (created_at desc);
create index if not exists push_delivery_log_user_idx on public.push_delivery_log (user_id, created_at desc);

alter table public.push_delivery_log enable row level security;
-- No policies — service-role only (see header comment).
