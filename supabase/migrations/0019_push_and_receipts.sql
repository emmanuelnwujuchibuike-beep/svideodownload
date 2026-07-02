-- 0019_push_and_receipts.sql
-- Notifications Phase 2: (1) Web Push subscriptions so notifications reach users
-- with the browser closed, and (2) message delivery receipts (delivered/read).
-- Idempotent.

-- ---------------------------------------------------------------------
-- Web Push subscriptions (one row per browser/device push endpoint).
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push owner read" on public.push_subscriptions;
create policy "push owner read" on public.push_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists "push owner insert" on public.push_subscriptions;
create policy "push owner insert" on public.push_subscriptions
  for insert with check (user_id = auth.uid());

drop policy if exists "push owner delete" on public.push_subscriptions;
create policy "push owner delete" on public.push_subscriptions
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Message delivery receipts: delivered_at is set when the recipient's app
-- first fetches the message; read_at (existing) when they open the thread.
-- REPLICA IDENTITY FULL so realtime UPDATE events carry these columns reliably
-- (the chat subscribes to read/delivered changes to update the ticks live).
-- ---------------------------------------------------------------------
alter table public.messages add column if not exists delivered_at timestamptz;
alter table public.messages replica identity full;
