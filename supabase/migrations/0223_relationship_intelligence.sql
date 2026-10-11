-- 0223 — Relationship Intelligence™ & Connection Health (Feature 19 · Part 8).
--
-- Two small things, everything else is derived at read time:
--
--   1. relationship_prefs - one private row per (member, friend) for the two
--      controls the brief adds: ARCHIVE ("hide activity, keep memories,
--      restore anytime") and the RECONNECT nudge (snoozed until a date, or
--      turned off for that friend). Owner-only. The friend never learns of it.
--
--   2. relationship_activity(viewer) - per direct conversation of the viewer:
--      their friend, messages in the last 90 days, messages in the 90 days
--      before that, and the last message time. Aggregated IN the database, so
--      a member with a thousand chats costs one query and one small result,
--      not a download of their message history. Service role only. It counts
--      the conversations the viewer is half of, and nothing else.
--
-- What is deliberately NOT here: anything about how the OTHER person behaves
-- toward the viewer (reply speed, read receipts, profile visits). The brief's
-- "Response Patterns" would make this a tool for monitoring someone, see
-- lib/social/graph/strength.ts. It is refused, not deferred.
--
-- Idempotent. Every dollar-quoted block is at the end.

create table if not exists public.relationship_prefs (
  owner_id                uuid not null references auth.users (id) on delete cascade,
  friend_id               uuid not null references auth.users (id) on delete cascade,
  archived_at             timestamptz,
  reconnect_snoozed_until timestamptz,
  reconnect_off           boolean not null default false,
  updated_at              timestamptz not null default now(),
  primary key (owner_id, friend_id),
  constraint relationship_prefs_not_self check (owner_id <> friend_id)
);
create index if not exists relationship_prefs_archived_idx on public.relationship_prefs (owner_id) where archived_at is not null;
alter table public.relationship_prefs enable row level security;
drop policy if exists "relationship prefs owner" on public.relationship_prefs;
create policy "relationship prefs owner" on public.relationship_prefs
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

comment on table public.relationship_prefs is '0223: a member''s private controls for one friend - archived, and the reconnect nudge snoozed or off. Owner-only.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.relationship_activity(p_viewer uuid)
returns table (friend_id uuid, conversation_id uuid, msgs_90 integer, msgs_prev_90 integer, last_message_at timestamptz)
language sql stable security definer set search_path = public as $$
  select
    case when c.user_low = p_viewer then c.user_high else c.user_low end as friend_id,
    c.id as conversation_id,
    (select count(*)::int from public.messages m where m.conversation_id = c.id and m.created_at >= now() - interval '90 days') as msgs_90,
    (select count(*)::int from public.messages m where m.conversation_id = c.id and m.created_at >= now() - interval '180 days' and m.created_at < now() - interval '90 days') as msgs_prev_90,
    (select max(m.created_at) from public.messages m where m.conversation_id = c.id) as last_message_at
  from public.conversations c
  where c.type = 'direct' and p_viewer in (c.user_low, c.user_high)
$$;

do $$
begin
  revoke all on function public.relationship_activity(uuid) from public, anon, authenticated;
end;
$$;
