-- 0069_conversation_theme.sql
-- Frenzsave · Premium Messaging inbox mockup completion: Chat Themes. NULL =
-- app default look (the existing behavior for every conversation). Each
-- named value drives BOTH an accent color (sent bubbles, send button, per-
-- thread accents) and a matching background wash — owner's explicit choice,
-- beyond what the reference mockup itself shows (color swatches only).

alter table public.conversations
  add column if not exists theme text;

alter table public.conversations
  drop constraint if exists conversations_theme_chk;
alter table public.conversations
  add constraint conversations_theme_chk
  check (theme is null or theme in ('blue', 'pink', 'green', 'orange', 'purple'));
