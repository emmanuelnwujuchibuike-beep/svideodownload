-- =====================================================================
-- FrenzSave — Premium Messaging V2 Part 1: messages join the notification
-- system. Two new types: 'message' (app-level insert from sendMessage —
-- see friend_request's own lib/social/friends.ts precedent, since messages
-- already funnel through one call site) and 'message_reaction' (SQL
-- trigger, mirroring notify_on_comment_reaction — message_reactions writes
-- go through the RLS-direct client, not one central function). 'message'
-- is deliberately NOT deduped: unlike a like/follow, a second message is
-- never a "duplicate" of the first — every send is a genuine new event.
-- Volume is collapsed at the UI-grouping layer (lib/social/notifications.ts),
-- not by a DB constraint.
--
-- IMPORTANT: notifications_type_chk has been widened repeatedly (0013 →
-- 0018 → 0020 → 0036 → 0037 → this file). This is the FULL union again,
-- not a delta — see 0037's own header for why that distinction matters (a
-- real bug hit exactly this the last time this constraint was touched).
-- Idempotent.
-- =====================================================================

alter table public.notifications
  add column if not exists conversation_id uuid references public.conversations (id) on delete cascade,
  add column if not exists message_id      uuid references public.messages (id) on delete cascade;

create index if not exists notifications_conversation_idx
  on public.notifications (conversation_id) where conversation_id is not null;

alter table public.notifications drop constraint if exists notifications_type_chk;
alter table public.notifications add constraint notifications_type_chk check (
  type in (
    -- social
    'follow','like','love','comment','reply','mention','tag','quote','repost',
    'share','save','profile_view','invite','milestone','repost_engagement',
    'comment_reaction',
    -- friends
    'friend_request','friend_accepted','friend_reminder',
    -- messages
    'message','message_reaction',
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

-- message_reaction dedupes per (recipient, actor, message) — exactly
-- notifications_dedupe_comment_uidx's own reasoning, ported.
create unique index if not exists notifications_dedupe_message_reaction_uidx
  on public.notifications (user_id, actor_id, type, coalesce(message_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where type in ('message_reaction');

create or replace function public.notify_on_message_reaction()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sender uuid;
  conv   uuid;
begin
  select sender_id, conversation_id into sender, conv from public.messages where id = new.message_id;
  if sender is null or sender = new.user_id then return new; end if;
  insert into public.notifications (user_id, actor_id, type, conversation_id, message_id)
  values (sender, new.user_id, 'message_reaction', conv, new.message_id)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists trg_notify_message_reaction on public.message_reactions;
create trigger trg_notify_message_reaction after insert on public.message_reactions
  for each row execute function public.notify_on_message_reaction();
