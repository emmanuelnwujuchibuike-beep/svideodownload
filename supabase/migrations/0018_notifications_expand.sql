-- 0018_notifications_expand.sql
-- Frenz Core · Notifications Feature 1: broaden the notification taxonomy so new
-- categories can be inserted without a schema change each time, add "save" post
-- notifications, and keep the anti-spam dedupe covering save too. Idempotent.

-- ---------------------------------------------------------------------
-- Widen the allowed type set (future-proof: social, downloads, security,
-- premium, community, news, system categories all pre-allowed).
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_chk;
alter table public.notifications add constraint notifications_type_chk check (
  type in (
    -- social
    'follow','like','love','comment','reply','mention','tag','quote','repost',
    'share','save','profile_view','invite','milestone',
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

-- ---------------------------------------------------------------------
-- Extend the like reaction trigger to also notify on "save" (post bookmarked).
-- One row per (recipient, actor, type, post) — re-save/un-save won't spam.
-- ---------------------------------------------------------------------
create or replace function public.notify_on_reaction()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner_id uuid;
begin
  if new.type not in ('like','save') then return new; end if;
  select publisher_id into owner_id from public.posts where id = new.post_id;
  if owner_id is null or owner_id = new.user_id then return new; end if;
  insert into public.notifications (user_id, actor_id, type, post_id)
  values (owner_id, new.user_id, new.type, new.post_id)
  on conflict do nothing;
  return new;
end $$;

-- Include 'save' in the per-actor/post/type dedupe so it collapses like the rest.
drop index if exists notifications_dedupe_uidx;
create unique index if not exists notifications_dedupe_uidx
  on public.notifications (user_id, actor_id, type, coalesce(post_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where type in ('follow','like','save');
