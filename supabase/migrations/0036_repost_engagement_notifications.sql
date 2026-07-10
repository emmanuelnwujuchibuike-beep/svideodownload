
alter table public.notifications drop constraint if exists notifications_type_chk;
alter table public.notifications add constraint notifications_type_chk check (
  type in (
    -- social
    'follow','like','love','comment','reply','mention','tag','quote','repost',
    'share','save','profile_view','invite','milestone','repost_engagement',
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

-- Extend the anti-spam dedupe (one row per recipient+actor+type+post) to
-- also cover the new type — a friend re-liking/un-liking/re-liking the same
-- reposted post won't spam its reposter either. Same union caveat as the
-- constraint above: 0020_friends.sql already widened this WHERE clause to
-- include friend_request/friend_accepted (friend_reminder deliberately stays
-- out — its own reminder_sent flag already guarantees at-most-once) — keep
-- that, just add repost_engagement, don't narrow back to 0018's original set.
drop index if exists notifications_dedupe_uidx;
create unique index if not exists notifications_dedupe_uidx
  on public.notifications (user_id, actor_id, type, coalesce(post_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where type in ('follow','like','save','friend_request','friend_accepted','repost_engagement');

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
