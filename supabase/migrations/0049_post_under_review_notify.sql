-- =====================================================================
-- FrenzSave — auto-moderation transparency fix.
--
-- 0010's `auto_moderate_on_report()` hides a post (status → 'under_review')
-- the moment 3 distinct open reports land on it, removing it from every
-- feed/reels query (all of which filter `status = 'published'`) — but never
-- told the OWNER any of this happened. From the owner's side, a legitimate
-- post just silently vanished from their feed and from Reels with zero
-- explanation and no way to know why or appeal — this is very likely the
-- explanation for "I couldn't find some posts in feed that was posted and
-- also in reels" (2026-07-12). The 3-report auto-hide threshold itself is
-- kept as-is (a real anti-abuse feature, not being touched here) — this
-- migration only closes the silence: the owner now gets a real notification
-- + push the moment their post is hidden for review, exactly like every
-- other state change that affects their content already does.
--
-- IMPORTANT: notifications_type_chk has been widened SEVEN times now across
-- this table's history (0013 → 0018 → 0020 → 0036 → 0037 → 0044 → this
-- file) — the list below is the FULL union of every value any prior
-- migration ever added, not a delta (see 0036/0037/0044's own comments for
-- why that distinction matters).
-- =====================================================================
set lock_timeout = '5s';

alter table public.notifications drop constraint if exists notifications_type_chk;
alter table public.notifications add constraint notifications_type_chk check (
  type in (
    -- social
    'follow','like','love','comment','reply','mention','tag','quote','repost',
    'share','save','profile_view','invite','milestone','repost_engagement',
    'comment_reaction',
    -- messaging
    'message','message_reaction','message_mention',
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
    'system','admin_broadcast',
    -- trust & safety (new)
    'post_under_review'
  )
);

-- ---------------------------------------------------------------------
-- Redeclare auto_moderate_on_report() with the notification insert added.
-- Everything else about it (the 3-report threshold, the update conditions)
-- is byte-for-byte the same as 0010 — only the new notify step is added.
-- ---------------------------------------------------------------------
create or replace function public.auto_moderate_on_report()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  threshold constant int := 3;
  open_count int;
  hidden_post_id uuid;
  hidden_post_owner uuid;
begin
  select count(*) into open_count
  from public.reports
  where target_type = NEW.target_type and target_id = NEW.target_id and status = 'open';

  if open_count >= threshold then
    if NEW.target_type = 'post' then
      update public.posts set status = 'under_review'
      where id = NEW.target_id and status = 'published'
      returning id, publisher_id into hidden_post_id, hidden_post_owner;

      -- Only fires on the transition that actually just happened (the
      -- `returning` clause above is empty on a duplicate/no-op report past
      -- the threshold on an already-hidden post) — the owner is told once,
      -- not once per additional report after the first hide.
      if hidden_post_id is not null then
        insert into public.notifications (user_id, actor_id, type, post_id)
        values (hidden_post_owner, null, 'post_under_review', hidden_post_id);
      end if;
    elsif NEW.target_type = 'comment' then
      update public.post_comments set status = 'hidden'
      where id = NEW.target_id and status = 'visible';
    end if;
  end if;
  return null;
end $$;
