-- =====================================================================
-- FrenzSave — Feature 17 Part 9: comments platform notification completeness
--   • notify_on_comment(): a reply now notifies the ACTUAL comment it replied
--     to (type 'reply', already a reserved-but-unused NotificationType) instead
--     of always notifying only the post owner regardless of depth.
--   • notify_on_comment_mention(): @mentions inside a comment/reply now notify
--     each mentioned user (type 'mention', also already reserved+unused) —
--     server-side regex parse of the stored body (mirrors the exact character
--     class components/social/rich-text.tsx already renders as clickable
--     links), so a mention notifies exactly the people it renders a link for,
--     however the @handle text got there (composer autocomplete or typed by
--     hand) — one source of truth.
--   • notify_on_comment_reaction(): reacting to a comment now notifies its
--     author (new type 'comment_reaction') — comment_reactions previously only
--     ever bumped a counter (0022's bump_comment_reactions), it never notified
--     anyone.
-- All additive triggers on already-existing tables; nothing here touches or
-- risks the existing working triggers besides notify_on_comment's own body.
--
-- IMPORTANT: notifications_type_chk has now been widened FIVE times across
-- this table's history (0013 → 0018 → 0020 → 0036 → this file). The list
-- below is the full union of every value any prior migration ever added, not
-- just the most recently written one — see 0036's own comment for why that
-- distinction matters (a real bug hit exactly this the last time this
-- constraint was touched).
-- =====================================================================

alter table public.notifications drop constraint if exists notifications_type_chk;
alter table public.notifications add constraint notifications_type_chk check (
  type in (
    -- social
    'follow','like','love','comment','reply','mention','tag','quote','repost',
    'share','save','profile_view','invite','milestone','repost_engagement',
    'comment_reaction',
    -- friends
    'friend_request','friend_accepted','friend_reminder',
    -- downloads
    'download_complete','download_failed','download_ready','processing_finished',
    -- community
    'community_invite','community_accepted','community_announcement','community_event',
    -- news
    'news_breaking','news_trending','news_following','news_recommended',
    -- premium
    'subscription_activated','payment_successful','renewal_reminder','premium_expiring',
    -- security
    'security_login','security_new_device','security_password','security_2fa',
    'security_suspicious','security_recovery',
    -- system
    'system'
  )
);

-- Comment-reaction notifications are deduped per (recipient, actor, COMMENT) —
-- deliberately a SEPARATE index from notifications_dedupe_uidx, which keys on
-- post_id: reusing that one would incorrectly collapse "reacted to comment A"
-- and "reacted to comment B" on the same post into a single notification the
-- second time it happened, since post_id alone can't tell the comments apart.
create unique index if not exists notifications_dedupe_comment_uidx
  on public.notifications (user_id, actor_id, type, coalesce(comment_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where type in ('comment_reaction');

-- ---------------------------------------------------------------------
-- Reply notifications: a reply now tells the person who WROTE the comment
-- being replied to, not just the post owner. The composer UI only ever lets
-- you reply to a top-level comment (nested replies render no Reply button —
-- see features/social/comments.tsx CommentItem's canReply={false} on depth>0),
-- so parent_id here is always exactly the comment the user tapped Reply on,
-- never a flattened ancestor.
-- ---------------------------------------------------------------------
create or replace function public.notify_on_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  owner_id      uuid;
  parent_author uuid;
begin
  select publisher_id into owner_id from public.posts where id = new.post_id;

  if new.parent_id is not null then
    select author_id into parent_author from public.post_comments where id = new.parent_id;
    if parent_author is not null and parent_author <> new.author_id then
      insert into public.notifications (user_id, actor_id, type, post_id, comment_id)
      values (parent_author, new.author_id, 'reply', new.post_id, new.id);
    end if;
    return new;
  end if;

  if owner_id is null or owner_id = new.author_id then return new; end if;
  insert into public.notifications (user_id, actor_id, type, post_id, comment_id)
  values (owner_id, new.author_id, 'comment', new.post_id, new.id);
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Mention notifications. Skips whoever already got a more specific
-- 'comment'/'reply' notification for this exact same insert, so mentioning
-- the post owner or the parent-comment author in your reply to them doesn't
-- also double up as a second, redundant notification for the identical event.
-- ---------------------------------------------------------------------
create or replace function public.notify_on_comment_mention()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  owner_id      uuid;
  parent_author uuid;
  handle_row    record;
  target_id     uuid;
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
    insert into public.notifications (user_id, actor_id, type, post_id, comment_id)
    values (target_id, new.author_id, 'mention', new.post_id, new.id);
  end loop;
  return new;
end $$;

drop trigger if exists trg_notify_comment_mention on public.post_comments;
create trigger trg_notify_comment_mention after insert on public.post_comments
  for each row execute function public.notify_on_comment_mention();

-- ---------------------------------------------------------------------
-- Comment-reaction notifications. Only fires on a fresh reaction (INSERT):
-- POST /api/comments/:id/like upserts on (comment_id, user_id), so switching
-- your emoji on a comment you already reacted to is an UPDATE, not a new
-- INSERT — deliberately not notifying again for that, only for a genuinely
-- new react (and `on conflict do nothing` covers a react/unreact/react burst
-- against the dedupe index above).
-- ---------------------------------------------------------------------
create or replace function public.notify_on_comment_reaction()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c_author uuid;
  c_post   uuid;
begin
  select author_id, post_id into c_author, c_post from public.post_comments where id = new.comment_id;
  if c_author is null or c_author = new.user_id then return new; end if;
  insert into public.notifications (user_id, actor_id, type, post_id, comment_id)
  values (c_author, new.user_id, 'comment_reaction', c_post, new.comment_id)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists trg_notify_comment_reaction on public.comment_reactions;
create trigger trg_notify_comment_reaction after insert on public.comment_reactions
  for each row execute function public.notify_on_comment_reaction();
