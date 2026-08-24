-- =====================================================================
-- FrenzSave — per-creator notification preferences
--
-- Owner, 2026-08-23: "make users to be able to turn on and off another users
-- post notification, stories notification, feed or share notification."
--
-- Instagram's bell-on-a-profile, made real: a viewer decides, PER PERSON,
-- which of that person's activity is worth a notification. Distinct from the
-- two controls that already exist and neither of which answers this:
--
--   • notification_settings (0059) is per-CATEGORY and global — "all social
--     notifications off", never "this one creator's posts on".
--   • /api/mute/:id hides a creator's posts from your feed entirely. It is a
--     blunt, whole-person control; this is the opposite, letting you ask for
--     MORE from someone without changing what anyone else sends you.
--
-- ── The four channels, and their defaults ────────────────────────────────
-- `posts`, `stories` and `feed` default FALSE. They are opt-IN because they
-- describe activity that happens constantly: notifying every follower about
-- every post from everyone they follow is how a notification bell becomes
-- something people permanently silence. Nothing currently sends these, so
-- false also means this migration changes no existing behaviour.
--
-- `shares` defaults TRUE, because that notification ALREADY fires today (the
-- `share` type in the notifications registry — "Shared your post"). The new
-- capability there is turning it OFF for one specific person. Defaulting it
-- false would have silently stopped a notification people already receive,
-- which is a behaviour change disguised as a feature.
--
-- ── Why one row per (viewer, target) rather than a column on `follows` ───
-- These preferences are not follow state. You can want notifications from
-- someone you have not followed, and unfollowing then re-following should not
-- silently resurrect an old preference — a row here is deleted when it goes
-- back to all-defaults (see clearing in lib/social/creator-notifications.ts),
-- so the table only ever holds deliberate choices.
--
-- Idempotent.
-- =====================================================================

create table if not exists public.creator_notification_prefs (
  -- Who receives (or does not receive) the notification.
  viewer_id  uuid not null references auth.users (id) on delete cascade,
  -- Whose activity it is about.
  target_id  uuid not null references auth.users (id) on delete cascade,
  posts      boolean not null default false,
  stories    boolean not null default false,
  feed       boolean not null default false,
  shares     boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (viewer_id, target_id),
  -- Notifying yourself about your own activity is meaningless, and a row here
  -- would quietly double every self-repost notification.
  constraint creator_notif_not_self check (viewer_id <> target_id)
);

-- The hot query is the EMISSION side: "someone just posted — who asked to hear
-- about it?" That reads by target, so it needs its own index; the primary key
-- above only serves lookups that lead with viewer_id (the settings UI).
create index if not exists creator_notif_target_idx
  on public.creator_notification_prefs (target_id);

alter table public.creator_notification_prefs enable row level security;

-- A viewer owns their own preferences and nobody else's. Emission runs through
-- the service role (createAdminClient), which bypasses RLS — deliberately, so
-- reading "who wants this" never needs to expose one person's preferences to
-- another.
drop policy if exists creator_notif_select_own on public.creator_notification_prefs;
create policy creator_notif_select_own
  on public.creator_notification_prefs for select
  using (auth.uid() = viewer_id);

drop policy if exists creator_notif_write_own on public.creator_notification_prefs;
create policy creator_notif_write_own
  on public.creator_notification_prefs for all
  using (auth.uid() = viewer_id)
  with check (auth.uid() = viewer_id);

comment on table public.creator_notification_prefs is
  'Per-viewer, per-creator notification opt-ins (2026-08-23). posts/stories/feed are opt-in (default false); shares defaults true because that notification already fires and this only adds the ability to switch it off.';
