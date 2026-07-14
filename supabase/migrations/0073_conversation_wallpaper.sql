-- 0073_conversation_wallpaper.sql
-- Frenzsave · Chat wallpaper: a per-conversation custom background picture,
-- on top of (and taking precedence over) the existing Chat Theme color wash
-- (migration 0069). NULL = no custom wallpaper — falls back to the theme
-- wash, or the app's default WhatsApp-style light chat background when
-- neither is set. Uploaded like any other message attachment (own storage
-- only, validated server-side the same way message-attachment URLs already
-- are — see isOwnStorageUrl in app/api/messages/route.ts).

alter table public.conversations
  add column if not exists wallpaper_url text;
