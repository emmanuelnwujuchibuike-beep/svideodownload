-- 0217: Feature 19 · Parts 3 and 4 — who may follow you, follow requests,
-- follow sources and daily follower flow; circle kinds, icons and palette.
--
-- Follows (0006) stay the one follow graph. This adds:
--   privacy_settings.follow_policy  everyone (default = today) | friends_of_friends
--                                   | verified | friends | approval | nobody
--   follow_requests                 when the policy is "approval": approve,
--                                   decline, ignore. Readable ONLY by the target —
--                                   the requester learns "requested" from the API,
--                                   so an ignore never shows as one.
--   follows.source                  where a follow came from (profile, search,
--                                   suggestion, feed, reels, qr, request, other)
--   follower_daily                  gained / lost per day, per account — COUNTS,
--                                   never who. Kept by a trigger on follows.
--   social_circles.kind / icon      close_friends, inner_circle, vip (one each)
--                                   and a fixed set of geometric icons, and the
--                                   colour palette gains the premium keys.
--
-- "follows self insert" now also requires the target's policy to be everyone.
-- Any other policy is decided by the server (lib/social/follows.ts), which
-- writes with the service role after its checks — a client can no longer insert
-- a follow around an approval.
--
-- Idempotent. Plain DDL first, then DO blocks, functions last. Statements that
-- must follow a function run inside the final DO block (the migration runner).

alter table public.privacy_settings add column if not exists follow_policy text not null default 'everyone';
alter table public.follows add column if not exists source text;

create table if not exists public.follow_requests (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  target_id    uuid not null references auth.users (id) on delete cascade,
  status       text not null default 'pending',
  source       text,
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  constraint follow_requests_not_self check (requester_id <> target_id)
);
create unique index if not exists follow_requests_pending_uidx on public.follow_requests (requester_id, target_id) where status = 'pending';
create index if not exists follow_requests_target_idx on public.follow_requests (target_id, created_at desc) where status = 'pending';
alter table public.follow_requests enable row level security;
drop policy if exists "follow requests target read" on public.follow_requests;
create policy "follow requests target read" on public.follow_requests
  for select using (target_id = (select auth.uid()));

create table if not exists public.follower_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  gained  integer not null default 0,
  lost    integer not null default 0,
  primary key (user_id, day)
);
alter table public.follower_daily enable row level security;
drop policy if exists "follower daily owner read" on public.follower_daily;
create policy "follower daily owner read" on public.follower_daily
  for select using (user_id = (select auth.uid()));

alter table public.social_circles add column if not exists kind text not null default 'custom';
alter table public.social_circles add column if not exists icon text not null default 'circle';
create unique index if not exists social_circles_kind_uidx on public.social_circles (owner_id, kind) where kind <> 'custom';
alter table public.social_circles drop constraint if exists social_circles_color_check;
alter table public.social_circles add constraint social_circles_color_check check (color in (
  'blue', 'violet', 'emerald', 'amber', 'rose', 'sky', 'pink', 'slate',
  'titanium', 'graphite', 'ocean', 'forest', 'royal', 'crimson', 'pearl', 'glass'));

do $$ begin
  alter table public.privacy_settings add constraint privacy_follow_policy_chk
    check (follow_policy in ('everyone', 'friends_of_friends', 'verified', 'friends', 'approval', 'nobody'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.follows add constraint follows_source_chk
    check (source is null or source in ('profile', 'search', 'suggestion', 'feed', 'reels', 'qr', 'request', 'other'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.follow_requests add constraint follow_requests_status_chk
    check (status in ('pending', 'approved', 'declined', 'ignored', 'cancelled'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.follow_requests add constraint follow_requests_source_chk
    check (source is null or source in ('profile', 'search', 'suggestion', 'feed', 'reels', 'qr', 'request', 'other'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.social_circles add constraint social_circles_kind_chk
    check (kind in ('custom', 'close_friends', 'inner_circle', 'vip'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.social_circles add constraint social_circles_icon_chk
    check (icon in ('circle', 'diamond', 'shield', 'compass', 'star', 'hexagon', 'ribbon', 'layers', 'crown', 'briefcase'));
exception when duplicate_object then null; end $$;

create or replace function public.follow_policy_of(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select ps.follow_policy from public.privacy_settings ps where ps.user_id = p_user), 'everyone')
$$;

create or replace function public.track_follower_daily() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.follower_daily (user_id, day, gained) values (new.following_id, (now() at time zone 'utc')::date, 1)
    on conflict (user_id, day) do update set gained = public.follower_daily.gained + 1;
    return new;
  end if;
  insert into public.follower_daily (user_id, day, lost) values (old.following_id, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set lost = public.follower_daily.lost + 1;
  return old;
end $$;

do $$ begin
  revoke all on function public.follow_policy_of(uuid) from public, anon;
  grant execute on function public.follow_policy_of(uuid) to authenticated;
  revoke all on function public.track_follower_daily() from public, anon, authenticated;
  drop trigger if exists follows_track_daily_trg on public.follows;
  create trigger follows_track_daily_trg after insert or delete on public.follows
    for each row execute function public.track_follower_daily();
  drop policy if exists "follows self insert" on public.follows;
  create policy "follows self insert" on public.follows
    for insert with check (
      auth.uid() = follower_id
      and follower_id <> following_id
      and not exists (
        select 1 from public.blocks b
        where (b.blocker_id = following_id and b.blocked_id = follower_id)
           or (b.blocker_id = follower_id and b.blocked_id = following_id)
      )
      and public.follow_policy_of(following_id) = 'everyone'
    );
end $$;
