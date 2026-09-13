-- ============================================================================
-- 0152 — Notification Center: the two Frenz AI deposit types
-- ============================================================================
--
-- Owner, 2026-09-13: "they should receive a push notification and an email
-- notification of the successful or failed deposit, with an invoice."
--
-- The in-app copy of every push is a row in public.notifications, and that
-- table's `type` is bounded by ONE CHECK constraint. A CHECK cannot be appended
-- to — each migration that touches it restates the WHOLE list (0132 explains
-- why). Without this, every insert of the two new types would fail at runtime
-- with a 23514 that the fire-and-forget insert swallows: the push would arrive,
-- the bell would never show it, and nothing would be logged.
--
-- The list below is 0132's verbatim, plus 'ai_deposit_successful' and
-- 'ai_deposit_failed' under premium. lib/streaks/notifications.test.ts reads
-- this file and fails the build if the registry declares a type this CHECK
-- does not allow.
--
-- Plain DDL only — no dollar-quoted block (see 0131 for why that matters).

alter table public.notifications drop constraint if exists notifications_type_chk;
alter table public.notifications add constraint notifications_type_chk check (
  type in (
    -- social
    'follow','like','love','comment','reply','mention','tag','quote','repost',
    'share','save','profile_view','invite','milestone','repost_engagement',
    'comment_reaction','repost_discovery','reshare',
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
    -- Frenz AI deposits (this migration)
    'ai_deposit_successful','ai_deposit_failed',
    -- security
    'security_login','security_new_device','security_password','security_2fa',
    'security_suspicious','security_recovery',
    'security_2fa_disabled','security_recovery_used',
    'security_passkey_enrolled','security_passkey_removed',
    -- streaks (0132)
    'streak_reminder','streak_milestone','streak_lost',
    -- system
    'system','admin_broadcast',
    -- trust & safety
    'post_under_review','moderation_appeal_resolved'
  )
);
