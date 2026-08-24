-- =====================================================================
-- 0132_streak_notifications.sql
-- Frenzsave · Streak events persist in the Notification Center
--
-- Owner, 2026-08-24: "the streak reminder should also be sent as push and
-- in app push that stays in notification, every streak stays in notification,
-- every streak reminder, lost and all stays in notification".
--
-- Until now a streak reminder existed ONLY as a web push. A push is a
-- transient banner: dismiss it, or miss it while the phone is locked and the
-- OS collapses it, and the event is gone with no record anywhere. These rows
-- give the same events a permanent home in the Notification Center.
--
-- ── 🔴 THE TYPE LIST IS CARRIED FORWARD WHOLE ─────────────────────────
-- `notifications_type_chk` is a single CHECK, so it cannot be "added to" —
-- it must be dropped and rewritten in full. Every earlier migration that
-- touched it (0018, 0036, 0037, 0042, 0059, 0064, 0116) restated the entire
-- list for the same reason. This is 0116's list verbatim plus three streak
-- types; dropping one by accident would fail every insert of that type at
-- runtime, not here.
--
-- ── 🔴 NO FUNCTIONS OR DO-BLOCKS IN THIS FILE ─────────────────────────
-- 0130 put plain DDL after a dollar-quoted block and the DDL silently did
-- not run (fixed by 0131). Everything here is plain DDL, deliberately.
--
-- Idempotent; safe to re-run.
-- =====================================================================

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
    -- security
    'security_login','security_new_device','security_password','security_2fa',
    'security_suspicious','security_recovery',
    'security_2fa_disabled','security_recovery_used',
    'security_passkey_enrolled','security_passkey_removed',
    -- streaks (this migration)
    'streak_reminder','streak_milestone','streak_lost',
    -- system
    'system','admin_broadcast',
    -- trust & safety
    'post_under_review','moderation_appeal_resolved'
  )
);

-- ── "You lost your streak", exactly once ─────────────────────────────
-- Claimed the same way `last_reminder_date` is: the sweep writes this date
-- with a conditional UPDATE and only the run that wins the write sends. A
-- streak stays broken until the member returns, so without a claim every
-- hourly sweep would re-announce the same loss forever.
alter table public.streaks add column if not exists lost_notified_date date;

-- ── "New streak record", exactly once per day ────────────────────────
-- The milestone rides on the server's existing once-per-day celebration gate,
-- but that gate lives in the response rather than the row, so a second device
-- opening the app the same day would insert a second notification. This
-- records the day the milestone was announced.
alter table public.streaks add column if not exists milestone_notified_date date;

comment on column public.streaks.lost_notified_date is
  'Local day a streak-lost notification was announced. Claim-before-send, like last_reminder_date.';
comment on column public.streaks.milestone_notified_date is
  'Local day a streak-milestone notification was announced. Prevents a second device re-announcing.';
