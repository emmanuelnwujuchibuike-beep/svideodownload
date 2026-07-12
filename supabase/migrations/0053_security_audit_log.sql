-- 0053_security_audit_log.sql
-- Frenzsave · Premium Messaging V2 Part 11a: generic, append-only security
-- audit trail. event_type is deliberately free-form text (not a CHECK-
-- constrained enum like notifications.type) so later rounds (moderation
-- pipeline) can add new event types without a migration each time.
-- ip_hash/never raw IP — this table can be read by its own owner (Privacy
-- Dashboard), so nothing sensitive enough to deanonymize goes in it.

create table if not exists public.security_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Self this round (user acted on their own account). A later moderation
  -- round can point this at an admin/moderator acting on the row's user_id.
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  -- Polymorphic hook, unused this round — lets 11c attach a report/post id
  -- without a schema change.
  target_type text,
  target_id uuid,
  ip_hash text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists security_audit_log_user_idx
  on public.security_audit_log (user_id, created_at desc);

alter table public.security_audit_log enable row level security;

-- Owner can read their own history (Privacy Dashboard / "recent security
-- activity"). Append-only: no insert/update/delete policy for anyone but
-- service_role, which bypasses RLS entirely via the admin client.
drop policy if exists "security_audit_log_select_own" on public.security_audit_log;
create policy "security_audit_log_select_own" on public.security_audit_log
  for select using (auth.uid() = user_id);
