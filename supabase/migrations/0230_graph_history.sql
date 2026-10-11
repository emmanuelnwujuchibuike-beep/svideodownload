-- 0230 — Graph History (Feature 19 · Part 15, 2026-10-11).
--
-- A private, per-member record of how their network changed: friendships started
-- and ended, people they followed and unfollowed, blocks they made, professional
-- connections confirmed, communities joined and subscriptions started or ended,
-- and people added to or removed from their own circles.
--
-- Privacy is the design, not a filter: every row is written ONLY into the history
-- of the person it is theirs to know. A follow or unfollow is recorded for the
-- person who did it, never for the person followed. A block, and circle changes,
-- are the actor's alone. RLS lets a member read their own rows and nothing else.
--
-- 🔴 Account deletion (the 0228 lesson): deleting an account cascades its
-- friendships, follows and memberships, and these triggers fire during that
-- cascade. Every insert checks BOTH accounts still exist (the owner of the history
-- and the other person), so a cascade can never write a row whose foreign key the
-- database would then refuse — which would refuse the whole deletion.
--
-- Idempotent. No semicolon inside any quoted string. Every dollar-quoted block is at the end.

create table if not exists public.graph_history (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  other_id   uuid references auth.users (id) on delete set null,
  kind       text not null,
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists graph_history_user_idx on public.graph_history (user_id, created_at desc);
alter table public.graph_history enable row level security;
drop policy if exists "graph history owner read" on public.graph_history;
create policy "graph history owner read" on public.graph_history for select using ((select auth.uid()) = user_id);

comment on table public.graph_history is '0230: a member''s private history of their own network changes. Written by triggers, only into the history of the person it belongs to.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
begin
  begin
    alter table public.graph_history add constraint graph_history_kind_chk check (kind in (
      'friendship_started', 'friendship_ended', 'followed', 'unfollowed', 'blocked', 'unblocked',
      'pro_connected', 'joined_community', 'subscribed', 'membership_ended', 'member_joined',
      'circle_added', 'circle_removed') and (detail is null or char_length(detail) <= 120));
  exception when duplicate_object then null;
  end;
end $$;

-- one guarded write: nothing is recorded for, or about, an account that no longer exists
create or replace function public.graph_history_add(p_user uuid, p_other uuid, p_kind text, p_detail text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or not exists (select 1 from auth.users where id = p_user) then return; end if;
  if p_other is not null and not exists (select 1 from auth.users where id = p_other) then return; end if;
  insert into public.graph_history (user_id, other_id, kind, detail) values (p_user, p_other, p_kind, p_detail);
end $$;

create or replace function public.graph_history_friendships() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.graph_history_add(new.user_low, new.user_high, 'friendship_started');
    perform public.graph_history_add(new.user_high, new.user_low, 'friendship_started');
    return new;
  end if;
  perform public.graph_history_add(old.user_low, old.user_high, 'friendship_ended');
  perform public.graph_history_add(old.user_high, old.user_low, 'friendship_ended');
  return old;
end $$;

-- the follower's own history only: the person followed is never told about an unfollow here
create or replace function public.graph_history_follows() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.graph_history_add(new.follower_id, new.following_id, 'followed');
    return new;
  end if;
  perform public.graph_history_add(old.follower_id, old.following_id, 'unfollowed');
  return old;
end $$;

create or replace function public.graph_history_blocks() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.graph_history_add(new.blocker_id, new.blocked_id, 'blocked');
    return new;
  end if;
  perform public.graph_history_add(old.blocker_id, old.blocked_id, 'unblocked');
  return old;
end $$;

create or replace function public.graph_history_pro() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted') then
    perform public.graph_history_add(new.requester_id, new.addressee_id, 'pro_connected', new.addressee_role);
    perform public.graph_history_add(new.addressee_id, new.requester_id, 'pro_connected', new.requester_role);
  end if;
  return new;
end $$;

create or replace function public.graph_history_memberships() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or (old.status is distinct from 'active' and new.status = 'active') then
    perform public.graph_history_add(new.member_id, new.creator_id, case when new.billing = 'sub' then 'subscribed' else 'joined_community' end);
    perform public.graph_history_add(new.creator_id, new.member_id, 'member_joined', new.billing);
  elsif old.status = 'active' and new.status in ('ended', 'lapsed', 'removed') then
    perform public.graph_history_add(new.member_id, new.creator_id, 'membership_ended', new.status);
  end if;
  return new;
end $$;

-- circles are the owner's private organising: their history only
create or replace function public.graph_history_circles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.graph_history_add(new.owner_id, new.member_id, 'circle_added');
    return new;
  end if;
  perform public.graph_history_add(old.owner_id, old.member_id, 'circle_removed');
  return old;
end $$;

do $$
begin
  drop trigger if exists graph_history_friendships_trg on public.friendships;
  create trigger graph_history_friendships_trg after insert or delete on public.friendships for each row execute function public.graph_history_friendships();
  drop trigger if exists graph_history_follows_trg on public.follows;
  create trigger graph_history_follows_trg after insert or delete on public.follows for each row execute function public.graph_history_follows();
  drop trigger if exists graph_history_blocks_trg on public.blocks;
  create trigger graph_history_blocks_trg after insert or delete on public.blocks for each row execute function public.graph_history_blocks();
  drop trigger if exists graph_history_pro_trg on public.pro_connections;
  create trigger graph_history_pro_trg after insert or update of status on public.pro_connections for each row execute function public.graph_history_pro();
  drop trigger if exists graph_history_memberships_trg on public.creator_memberships;
  create trigger graph_history_memberships_trg after insert or update of status on public.creator_memberships for each row execute function public.graph_history_memberships();
  drop trigger if exists graph_history_circles_trg on public.circle_members;
  create trigger graph_history_circles_trg after insert or delete on public.circle_members for each row execute function public.graph_history_circles();
  revoke all on function public.graph_history_add(uuid, uuid, text, text) from public, anon, authenticated;
  revoke all on function public.graph_history_friendships() from public, anon, authenticated;
  revoke all on function public.graph_history_follows() from public, anon, authenticated;
  revoke all on function public.graph_history_blocks() from public, anon, authenticated;
  revoke all on function public.graph_history_pro() from public, anon, authenticated;
  revoke all on function public.graph_history_memberships() from public, anon, authenticated;
  revoke all on function public.graph_history_circles() from public, anon, authenticated;
end $$;
