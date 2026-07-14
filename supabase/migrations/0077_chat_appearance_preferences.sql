-- =====================================================================
-- 0077_chat_appearance_preferences.sql
-- Frenzsave · Personal chat appearance (owner ask, 2026-07-14): "user can set
-- up text font size and it reflect in both chats, set chat bubble styles and
-- color." Deliberately a NEW per-USER table, not an extension of
-- `conversations.theme`/`wallpaper_url` (0069/0073) — those are per-
-- CONVERSATION and shared by both participants; a font-size/bubble
-- preference is personal and applies "in both chats" (i.e. every
-- conversation), so it belongs on the viewer's own row. Same idiom as
-- `user_home_preferences` (0040): one row per user, RLS-restricted to the
-- owner, best-effort defaults in application code if the row doesn't exist.
-- Idempotent; safe to re-run.
-- =====================================================================

create table if not exists public.chat_appearance_preferences (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  font_size    text not null default 'medium' check (font_size in ('small', 'medium', 'large', 'xlarge')),
  bubble_style text not null default 'default' check (bubble_style in ('default', 'compact', 'sharp')),
  -- Personal color for the viewer's OWN sent bubbles, everywhere — a hex
  -- string like '#7C5CFF'. Null = keep falling back to today's default
  -- (the conversation's Chat Theme gradient, or bg-brand) — purely additive.
  bubble_color text,
  updated_at   timestamptz not null default now()
);

alter table public.chat_appearance_preferences enable row level security;

drop policy if exists "chat_appearance_preferences self all" on public.chat_appearance_preferences;
create policy "chat_appearance_preferences self all" on public.chat_appearance_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
