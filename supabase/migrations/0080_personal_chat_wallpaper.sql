-- =====================================================================
-- 0080_personal_chat_wallpaper.sql
-- Frenzsave · A chat wallpaper can now be set for BOTH participants or for
-- ONLY the person who set it.
--
-- Owner ask (2026-07-16): "make users get to choose where their wallpaper
-- displays, both chat and only you option".
--
-- Until now a wallpaper was only ever `conversations.wallpaper_url` — one
-- shared picture that both sides of the thread saw, with no way to set a
-- background just for yourself. The two scopes map onto the two tables that
-- already encode exactly that distinction:
--
--   "Both of you" -> conversations.wallpaper_url            (migration 0073)
--   "Only you"    -> chat_appearance_preferences.wallpaper_url  (this one)
--
-- `chat_appearance_preferences` is already per-(user, conversation) after 0078
-- and already holds the other "only changes what YOU see" settings (font
-- style, bubble style/color), so a personal wallpaper belongs on that row
-- rather than in a new table.
--
-- Resolution order in the app: a personal wallpaper wins over the shared one;
-- clearing it (null) falls back to whatever the conversation has, and clearing
-- both means no wallpaper. Idempotent.
-- =====================================================================

alter table public.chat_appearance_preferences
  add column if not exists wallpaper_url text;
