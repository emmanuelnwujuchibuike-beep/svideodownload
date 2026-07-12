-- 0059_notification_types_security.sql
-- Frenzsave · Premium Messaging V2 Part 11a: widen notifications.type for
-- the new account-security events this round introduces. Existing
-- security_2fa/security_recovery types are left untouched (their copy is
-- enable-only / recovery-email-specific — see docs, not reused here) since
-- this table has no per-row body/metadata column to disambiguate.

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
    'security_2fa_disabled','security_recovery_used',
    'security_passkey_enrolled','security_passkey_removed',
    -- system
    'system','admin_broadcast',
    -- trust & safety
    'post_under_review'
  )
);
