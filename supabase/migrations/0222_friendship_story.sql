-- 0222 — Friend Profiles™ & the Relationship Timeline (Feature 19 · Part 7).
--
-- The timeline itself stores NOTHING new: every moment on it is a timestamp a
-- row already owns (friendships, friend_requests, follows, messages, post
-- reactions, comments, reposts), read at request time - see
-- lib/social/graph/milestones.ts for why a copied milestones table would
-- drift. What is new here is only what did not exist anywhere:
--
--   1. friend_goals - the Shared Bucket List. One list per friendship, both
--      friends read and write it, and it is readable by nobody else. If the
--      friendship ends the list stops being reachable (every policy requires
--      a live friendship), and the rows go with the accounts.
--   2. time_capsules.recipient_id - a capsule sealed FOR a friend (0099 had
--      only capsules to yourself). The recipient can read a row only once it
--      has unlocked: the database refuses the read before then, so the message
--      cannot be fetched early through any client. The author keeps the
--      0099 policy over their own rows.
--   3. friendship_timeline_hidden - "users control what is remembered": a
--      member can take a kind of moment (for example "first message") off
--      THEIR view of one friendship. Owner-only. The other person's view is
--      theirs to decide.
--
-- Idempotent. Every dollar-quoted block is at the end.

create table if not exists public.friend_goals (
  id         uuid primary key default gen_random_uuid(),
  user_low   uuid not null references auth.users (id) on delete cascade,
  user_high  uuid not null references auth.users (id) on delete cascade,
  title      text not null,
  created_by uuid not null references auth.users (id) on delete cascade,
  done_at    timestamptz,
  done_by    uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint friend_goals_order_chk check (user_low < user_high),
  constraint friend_goals_title_chk check (char_length(btrim(title)) between 1 and 120),
  constraint friend_goals_author_chk check (created_by in (user_low, user_high)),
  constraint friend_goals_done_chk check ((done_at is null) = (done_by is null))
);
create index if not exists friend_goals_pair_idx on public.friend_goals (user_low, user_high, created_at desc);
alter table public.friend_goals enable row level security;

alter table public.time_capsules add column if not exists recipient_id uuid references auth.users (id) on delete cascade;
alter table public.time_capsules drop constraint if exists time_capsules_recipient_chk;
alter table public.time_capsules add constraint time_capsules_recipient_chk check (recipient_id is null or recipient_id <> user_id);
create index if not exists time_capsules_recipient_idx on public.time_capsules (recipient_id, unlock_at) where recipient_id is not null;

create table if not exists public.friendship_timeline_hidden (
  owner_id   uuid not null references auth.users (id) on delete cascade,
  friend_id  uuid not null references auth.users (id) on delete cascade,
  kind       text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, friend_id, kind),
  constraint friendship_timeline_hidden_kind_chk check (char_length(kind) between 1 and 40)
);
alter table public.friendship_timeline_hidden enable row level security;
drop policy if exists "timeline hidden owner" on public.friendship_timeline_hidden;
create policy "timeline hidden owner" on public.friendship_timeline_hidden
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

comment on table public.friend_goals is '0222: the Shared Bucket List of one friendship - both friends read and write it while they are friends, nobody else can.';
comment on column public.time_capsules.recipient_id is '0222: a capsule sealed for a friend. The recipient can read the row only after unlock_at.';
comment on table public.friendship_timeline_hidden is '0222: kinds of moments a member took off their own view of one friendship.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

-- Are these two people friends right now? (friendships keeps the canonical low/high pair)
create or replace function public.are_friends(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_a is not null and p_b is not null and p_a <> p_b and exists (
    select 1 from public.friendships f where f.user_low = least(p_a, p_b) and f.user_high = greatest(p_a, p_b)
  )
$$;

do $$
begin
  drop policy if exists "friend goals pair read" on public.friend_goals;
  create policy "friend goals pair read" on public.friend_goals for select
    using (auth.uid() in (user_low, user_high) and public.are_friends(user_low, user_high));
  drop policy if exists "friend goals pair insert" on public.friend_goals;
  create policy "friend goals pair insert" on public.friend_goals for insert
    with check (created_by = auth.uid() and auth.uid() in (user_low, user_high) and public.are_friends(user_low, user_high) and done_at is null);
  drop policy if exists "friend goals pair update" on public.friend_goals;
  create policy "friend goals pair update" on public.friend_goals for update
    using (auth.uid() in (user_low, user_high) and public.are_friends(user_low, user_high))
    with check (auth.uid() in (user_low, user_high) and (done_by is null or done_by = auth.uid()));
  drop policy if exists "friend goals pair delete" on public.friend_goals;
  create policy "friend goals pair delete" on public.friend_goals for delete
    using (auth.uid() in (user_low, user_high) and public.are_friends(user_low, user_high));

  -- the recipient of a capsule: only once it has unlocked, and only while still friends with its author
  drop policy if exists "time_capsules recipient after unlock" on public.time_capsules;
  create policy "time_capsules recipient after unlock" on public.time_capsules for select
    using (recipient_id = auth.uid() and unlock_at <= now() and public.are_friends(user_id, recipient_id));

  revoke all on function public.are_friends(uuid, uuid) from public, anon;
  grant execute on function public.are_friends(uuid, uuid) to authenticated;
end;
$$;
