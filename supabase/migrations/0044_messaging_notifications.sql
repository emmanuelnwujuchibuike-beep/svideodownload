-- =====================================================================
-- FrenzSave — Premium Messaging V2 Part 4: notifications, alerts & smart
-- delivery. Purely additive. Idempotent.
--
-- Live-traffic note (see 0043's own header — the deadlock hit applying
-- that migration): same defensive `lock_timeout` here.
-- =====================================================================
set lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- New notification types: `message_mention` (a chat @mention — a distinct
-- type rather than reusing the post/comment `mention` type, since it needs
-- its own icon/verb/href pointing at a conversation, not a post) and
-- `admin_broadcast` (owner-sent platform-wide alert, styled differently
-- from a personal notification in the UI).
--
-- IMPORTANT: notifications_type_chk has been widened SIX times now across
-- this table's history (0013 → 0018 → 0020 → 0036 → 0037 → this file) — the
-- list below is the FULL union of every value any prior migration ever
-- added, not a delta (see 0036/0037's own comments for why that distinction
-- matters — a real bug hit exactly this the last time this was gotten
-- wrong).
-- ---------------------------------------------------------------------
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
    'system','admin_broadcast'
  )
);

-- ---------------------------------------------------------------------
-- In-app interaction sounds (Part 4 spec 4b): a master switch + one switch
-- per interaction type, set from "message settings" at the top of the
-- inbox — deliberately NOT inside an open thread (owner instruction). This
-- governs the FOREGROUND, in-app sound-effect layer only (Web Audio,
-- synthesized tones — see lib/notifications/sound-fx.ts); it has nothing to
-- do with the OS's own push-notification sound, which a web app cannot
-- override on either iOS or Android (see docs/PROJECT_NOTES.md's Part 4
-- entry for the full native-vs-web reasoning).
-- ---------------------------------------------------------------------
create table if not exists public.notification_sound_prefs (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  master_enabled   boolean not null default true,
  message_enabled  boolean not null default true,
  mention_enabled  boolean not null default true,
  reaction_enabled boolean not null default true,
  typing_enabled   boolean not null default true,
  updated_at       timestamptz not null default now()
);
alter table public.notification_sound_prefs enable row level security;
drop policy if exists "sound prefs self all" on public.notification_sound_prefs;
create policy "sound prefs self all" on public.notification_sound_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Admin broadcast alerts — segment targeting is plan tier (the one
-- real, already-queryable user segment this app has today; "activity
-- recency" / arbitrary cohorts are a real follow-up, not built here).
-- ---------------------------------------------------------------------
create table if not exists public.notification_broadcasts (
  id          uuid primary key default uuid_generate_v4(),
  title       text not null,
  body        text not null,
  target_plan text not null default 'all' check (target_plan in ('all', 'free', 'pro', 'business')),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  sent_count  integer not null default 0
);
alter table public.notification_broadcasts enable row level security;
-- No client policy at all — every read/write goes through the admin-gated
-- route + service role, same as every other admin-only surface in this app.

-- ---------------------------------------------------------------------
-- Chat @mentions: notification creation for these stays in application code
-- (lib/social/messages.ts's sendMessage(), which already builds the
-- per-recipient `notifications` rows for every send) rather than a second
-- DB trigger — unlike comments (0037's notify_on_comment_mention()), a
-- message's notification rows are already assembled in TS per-recipient, so
-- adding a mention type there is one branch, not a second insert path that
-- could double-notify. No schema object needed here beyond the type itself
-- (already added above).
-- ---------------------------------------------------------------------
