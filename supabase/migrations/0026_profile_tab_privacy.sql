-- 0026_profile_tab_privacy.sql
-- Per-tab profile privacy (Repost spec §7): each activity tab — Reposts, Liked,
-- Saved — gets its own visibility (public | followers | private), so a visitor
-- who isn't allowed simply never sees the tab. Followers/Following lists already
-- have followers_visibility (migration 0006). Defaults preserve today's behaviour
-- exactly: Reposts were public; Liked/Saved were owner-only (private). Idempotent.

alter table public.privacy_settings
  add column if not exists reposts_visibility text not null default 'public'
    check (reposts_visibility in ('public', 'followers', 'private')),
  add column if not exists likes_visibility   text not null default 'private'
    check (likes_visibility in ('public', 'followers', 'private')),
  add column if not exists saves_visibility    text not null default 'private'
    check (saves_visibility in ('public', 'followers', 'private'));
