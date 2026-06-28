-- =====================================================================
-- FrenzSave — admin alert ledger
-- Records each admin alert exactly once (download milestones, proxy-budget
-- warnings, …). The unique `key` is the dedupe lock: only the first writer for
-- a given key wins, so an alert email is sent at most once. Inserts happen via
-- the service-role client (bypasses RLS); admins can read their history.
-- =====================================================================

create table if not exists public.admin_alerts (
  id          uuid primary key default uuid_generate_v4(),
  kind        text not null,
  key         text not null unique,
  subject     text,
  created_at  timestamptz not null default now()
);

create index if not exists admin_alerts_created_idx
  on public.admin_alerts (created_at desc);

alter table public.admin_alerts enable row level security;

-- Admin-only read; inserts/deletes go through the service role (no policy).
drop policy if exists "admin_alerts admin read" on public.admin_alerts;
create policy "admin_alerts admin read" on public.admin_alerts
  for select using (public.is_admin());
