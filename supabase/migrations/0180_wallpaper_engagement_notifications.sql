-- ═══════════════════════════════════════════════════════════════════════════
--  0180 — a wallpaper's uploader hears about it (2026-10-04)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "Let users who uploaded a wallpaper get notified when someone liked,
-- saved, or downloaded their wallpaper."
--
-- `wallpapers.uploaded_by` has existed since 0105 and nothing has ever read it
-- to tell that member anything. Three new notification types, one per action.
--
-- ── 🔴 WHY THREE TYPES AND NOT `like` / `save` REUSED ──────────────────────
--
-- The standing rule in this project: a borrowed event type inherits its LABEL
-- and its DESTINATION. `like` is "Liked your post" and deep-links to the post;
-- firing it for a wallpaper would put "Liked your post" in the Notification
-- Center for something that is not a post, pointing at a route that cannot show
-- it. The registry entry and `destinations.ts` give these three their own words
-- and their own door.
--
-- `wallpaper_download` has no post-side equivalent at all — downloads are the
-- one wallpaper metric that is purely earned, and the thing an uploader most
-- wants to hear about.
--
-- ── What this migration is ─────────────────────────────────────────────────
--
-- One widened CHECK. Permissive: every existing value stays accepted, no row is
-- invalidated, no data is read or written, no column or index is touched. It is
-- the storage-side mirror of `lib/platform/notifications-registry.ts`, which the
-- registry's own docstring says to keep in step.
--
-- Plain DDL only — no dollar-quoted block (see 0131 for why that matters).

alter table public.notifications drop constraint if exists notifications_type_chk;
alter table public.notifications add constraint notifications_type_chk check (
  type in (
    -- social
    'follow','like','love','comment','reply','mention','tag','quote','repost',
    'share','save','profile_view','invite','milestone','repost_engagement',
    'comment_reaction','repost_discovery','reshare',
    -- 🔴 NEW in this migration: a member's own wallpaper, engaged with
    'wallpaper_like','wallpaper_save','wallpaper_download',
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
    -- Frenz AI deposits (0152)
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
