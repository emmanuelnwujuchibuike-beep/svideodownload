-- 0232 — Relationship Privacy™, Consent and Digital Boundaries (Feature 19 · Part 17, 2026-10-11).
--
--   privacy_settings gains
--     mention_policy        who can notify you with an @mention: everyone | following (people you follow) | friends | nobody
--     collab_invite_policy  who can invite you to collaborate on a post: same four
--     memory_tag_policy     who can put you on a shared memory: friends | nobody
--     request_filters       friend requests filed quietly instead of notified: {"noPhoto":bool,"minAccountDays":int}
--     boundary_mode/_until/_restore   a Boundary Mode in force, when it ends, and the settings to put back
--   blocks / muted_creators gain expires_at — a temporary block or mute (the reconcile cron removes it when it ends)
--   graph_history learns: followed_you, unfollowed_you (the follower's own rows were 0230's), privacy_changed,
--     boundary_on, boundary_off, removed_from_memory
--   notify_on_comment_mention (0037) is rewritten: it never notified-checked blocks — someone you blocked could
--     still @mention you and reach you. Now a block either way, or your mention_policy, stops the notification.
--
-- Additive. Idempotent. No semicolon inside any quoted string. Every dollar-quoted block is at the end.

alter table public.privacy_settings add column if not exists mention_policy text not null default 'everyone';
alter table public.privacy_settings add column if not exists collab_invite_policy text not null default 'everyone';
alter table public.privacy_settings add column if not exists memory_tag_policy text not null default 'friends';
alter table public.privacy_settings add column if not exists request_filters jsonb not null default '{}'::jsonb;
alter table public.privacy_settings add column if not exists boundary_mode text;
alter table public.privacy_settings add column if not exists boundary_until timestamptz;
alter table public.privacy_settings add column if not exists boundary_restore jsonb;
create index if not exists privacy_settings_boundary_due_idx on public.privacy_settings (boundary_until) where boundary_until is not null;

alter table public.blocks add column if not exists expires_at timestamptz;
create index if not exists blocks_expiring_idx on public.blocks (expires_at) where expires_at is not null;
alter table public.muted_creators add column if not exists expires_at timestamptz;
create index if not exists muted_creators_expiring_idx on public.muted_creators (expires_at) where expires_at is not null;

alter table public.graph_history drop constraint if exists graph_history_kind_chk;

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
begin
  begin
    alter table public.privacy_settings add constraint privacy_mention_chk check (mention_policy in ('everyone', 'following', 'friends', 'nobody'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.privacy_settings add constraint privacy_collab_invite_chk check (collab_invite_policy in ('everyone', 'following', 'friends', 'nobody'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.privacy_settings add constraint privacy_memory_tag_chk check (memory_tag_policy in ('friends', 'nobody'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.privacy_settings add constraint privacy_boundary_chk check (boundary_mode is null or boundary_mode in ('quiet', 'vacation', 'friends_only', 'work', 'creator', 'invisible', 'weekend', 'custom'));
  exception when duplicate_object then null;
  end;
  alter table public.graph_history add constraint graph_history_kind_chk check (kind in (
    'friendship_started', 'friendship_ended', 'followed', 'unfollowed', 'blocked', 'unblocked',
    'pro_connected', 'joined_community', 'subscribed', 'membership_ended', 'member_joined',
    'circle_added', 'circle_removed',
    'followed_you', 'unfollowed_you', 'privacy_changed', 'boundary_on', 'boundary_off', 'removed_from_memory')
    and (detail is null or char_length(detail) <= 120));
end $$;

-- 0230's follow history, now also for the person followed (owner brief: "who followed, who unfollowed")
create or replace function public.graph_history_follows() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.graph_history_add(new.follower_id, new.following_id, 'followed');
    perform public.graph_history_add(new.following_id, new.follower_id, 'followed_you');
    return new;
  end if;
  perform public.graph_history_add(old.follower_id, old.following_id, 'unfollowed');
  perform public.graph_history_add(old.following_id, old.follower_id, 'unfollowed_you');
  return old;
end $$;

-- your own privacy changes, in your own history: which controls changed, never their old values
create or replace function public.graph_history_privacy() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  changed text[] := '{}';
begin
  if old.messages_policy is distinct from new.messages_policy then changed := array_append(changed, 'messages'); end if;
  if old.follow_policy is distinct from new.follow_policy then changed := array_append(changed, 'follows'); end if;
  if old.friend_requests_policy is distinct from new.friend_requests_policy then changed := array_append(changed, 'friend requests'); end if;
  if old.mention_policy is distinct from new.mention_policy then changed := array_append(changed, 'mentions'); end if;
  if old.collab_invite_policy is distinct from new.collab_invite_policy then changed := array_append(changed, 'collaboration invites'); end if;
  if old.memory_tag_policy is distinct from new.memory_tag_policy then changed := array_append(changed, 'memories'); end if;
  if old.comments_policy is distinct from new.comments_policy then changed := array_append(changed, 'comments'); end if;
  if old.friends_visibility is distinct from new.friends_visibility then changed := array_append(changed, 'friend list'); end if;
  if old.show_in_recommendations is distinct from new.show_in_recommendations then changed := array_append(changed, 'recommendations'); end if;
  if old.boundary_mode is distinct from new.boundary_mode then
    perform public.graph_history_add(new.user_id, null, case when new.boundary_mode is null then 'boundary_off' else 'boundary_on' end, coalesce(new.boundary_mode, old.boundary_mode));
  end if;
  if array_length(changed, 1) > 0 then
    perform public.graph_history_add(new.user_id, null, 'privacy_changed', left(array_to_string(changed, ', '), 120));
  end if;
  return new;
end $$;

-- 0037's mention notifier: blocks either way and the mentioned person's mention_policy now decide
create or replace function public.notify_on_comment_mention()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  owner_id      uuid;
  parent_author uuid;
  handle_row    record;
  target_id     uuid;
  pol           text;
begin
  if new.body is null or new.body = '' then return new; end if;
  select publisher_id into owner_id from public.posts where id = new.post_id;
  if new.parent_id is not null then
    select author_id into parent_author from public.post_comments where id = new.parent_id;
  end if;
  for handle_row in
    select distinct trim(trailing '.' from lower(m[1])) as handle
    from regexp_matches(new.body, '@([A-Za-z0-9_.]+)', 'g') as m
  loop
    select id into target_id from public.profiles where lower(handle) = handle_row.handle limit 1;
    if target_id is null then continue; end if;
    if target_id = new.author_id then continue; end if;
    if target_id = owner_id or target_id = parent_author then continue; end if;
    if exists (select 1 from public.blocks b where (b.blocker_id = target_id and b.blocked_id = new.author_id) or (b.blocker_id = new.author_id and b.blocked_id = target_id)) then continue; end if;
    select coalesce(ps.mention_policy, 'everyone') into pol from public.privacy_settings ps where ps.user_id = target_id;
    pol := coalesce(pol, 'everyone');
    if pol = 'nobody' then continue; end if;
    if pol = 'following' and not exists (select 1 from public.follows f where f.follower_id = target_id and f.following_id = new.author_id) then continue; end if;
    if pol = 'friends' and not exists (select 1 from public.friendships fr where fr.user_low = least(target_id, new.author_id) and fr.user_high = greatest(target_id, new.author_id)) then continue; end if;
    insert into public.notifications (user_id, actor_id, type, post_id, comment_id)
    values (target_id, new.author_id, 'mention', new.post_id, new.id);
  end loop;
  return new;
end $$;

do $$
begin
  drop trigger if exists graph_history_privacy_trg on public.privacy_settings;
  create trigger graph_history_privacy_trg after update on public.privacy_settings for each row execute function public.graph_history_privacy();
  revoke all on function public.graph_history_privacy() from public, anon, authenticated;
  revoke all on function public.graph_history_follows() from public, anon, authenticated;
  revoke all on function public.notify_on_comment_mention() from public, anon, authenticated;
  -- the server records consent withdrawals (removed_from_memory) through the guarded writer
  grant execute on function public.graph_history_add(uuid, uuid, text, text) to service_role;
end $$;
