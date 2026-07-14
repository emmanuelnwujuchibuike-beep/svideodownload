-- =====================================================================
-- 0076_user_restrictions.sql
-- Frenzsave · Granular blocking (owner ask, 2026-07-14): "users can block
-- another user from different ways, chatting with them, watching their
-- status, calls, and others, also include a general blocking option." The
-- existing `public.blocks` table (0006) is a full, bidirectional block —
-- messaging/comments/discovery/profile visibility — and stays exactly as-is
-- as the "Block everywhere" umbrella. This adds a lighter, scoped table for
-- restricting ONE dimension at a time (messaging / status-stories / calls)
-- without a full block, mirroring `blocks`/`muted_creators` structurally.
-- Idempotent; safe to re-run.
-- =====================================================================

create table if not exists public.user_restrictions (
  restrictor_id uuid not null references auth.users (id) on delete cascade,
  restricted_id uuid not null references auth.users (id) on delete cascade,
  scope         text not null check (scope in ('messaging', 'status', 'calls')),
  created_at    timestamptz not null default now(),
  primary key (restrictor_id, restricted_id, scope),
  constraint user_restrictions_no_self check (restrictor_id <> restricted_id)
);
create index if not exists user_restrictions_restricted_idx on public.user_restrictions (restricted_id, scope);

alter table public.user_restrictions enable row level security;

-- Only the restrictor sees/manages their own restrictions — same shape as
-- "blocks self all" (0006). Enforcement reads happen server-side via the
-- admin client (lib/social/messages.ts, lib/social/stories.ts), same as
-- every other blocks/mutes check in this codebase.
drop policy if exists "user_restrictions self all" on public.user_restrictions;
create policy "user_restrictions self all" on public.user_restrictions
  for all using (auth.uid() = restrictor_id) with check (auth.uid() = restrictor_id);
