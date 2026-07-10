-- =====================================================================
-- 0036_repost_engagement_notifications.sql — "Sarah liked the post you
-- reposted" (Feature 17 Part 8's "Friend Repost Notifications")
-- =====================================================================
-- Every existing engagement trigger (notify_on_reaction, notify_on_comment)
-- only ever notifies the ORIGINAL post's publisher_id — none of them know
-- reposts exist. A reposter never hears about engagement their repost drove.
--
-- Relationship-aware by design (not "everyone who reposted this viral post
-- gets spammed by every stranger's like"): only fires when the person who
-- reacted/commented is an actual FRIEND of the reposter — the exact
-- "mutual friend" framing the spec asks for. Covers like, save, and comment
-- (which already covers replies — a reply is just a post_comments row with a
-- parent_id). Deliberately does NOT cover shares: shares_count is a plain
-- aggregate counter (posts.shares_count, 0007_content_posts.sql), not
-- per-actor rows, so there's no "who shared" to check friendship against.
--
-- Separate trigger functions (not folded into the existing notify_on_reaction/
-- notify_on_comment) so the already-working primary-owner notification path
-- is never touched — this is purely additive.

alter table public.notifications drop constraint if exists notifications_type_chk;
alter table public.notifications add constraint notifications_type_chk check (
  type in (
    -- social
    'follow','like','love','comment','reply','mention','tag','quote','repost',
    'share','save','profile_view','invite','milestone','repost_engagement',
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

-- Extend the anti-spam dedupe (one row per recipient+actor+type+post) to
-- also cover the new type — a friend re-liking/un-liking/re-liking the same
-- reposted post won't spam its reposter either.
drop index if exists notifications_dedupe_uidx;
create unique index if not exists notifications_dedupe_uidx
  on public.notifications (user_id, actor_id, type, coalesce(post_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where type in ('follow','like','save','repost_engagement');

create or replace function public.notify_repost_engagement()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor       uuid;
  target_post uuid;
  r           record;
begin
  if TG_TABLE_NAME = 'post_reactions' then
    if new.type not in ('like','save') then return new; end if;
    actor := new.user_id;
    target_post := new.post_id;
  else
    actor := new.author_id;
    target_post := new.post_id;
  end if;

  for r in
    select re.user_id as reposter_id
    from public.reposts re
    where re.post_id = target_post
      and re.user_id <> actor
  loop
    if exists (
      select 1 from public.friendships f
      where f.user_low = least(actor, r.reposter_id)
        and f.user_high = greatest(actor, r.reposter_id)
    ) then
      insert into public.notifications (user_id, actor_id, type, post_id)
      values (r.reposter_id, actor, 'repost_engagement', target_post)
      on conflict do nothing;
    end if;
  end loop;

  return new;
end $$;

drop trigger if exists trg_notify_repost_engagement_reaction on public.post_reactions;
create trigger trg_notify_repost_engagement_reaction after insert on public.post_reactions
  for each row execute function public.notify_repost_engagement();

drop trigger if exists trg_notify_repost_engagement_comment on public.post_comments;
create trigger trg_notify_repost_engagement_comment after insert on public.post_comments
  for each row execute function public.notify_repost_engagement();
