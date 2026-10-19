-- 0264 — Two more chat themes, from design/ChatMenu.dc.html (owner, 2026-10-19: "Theme swatches (brand colors
-- only)" and "build any backend attached that needs it for completion").
--
-- The design's swatches are Frenz (the gradient — the app's default, stored as null), Blue, Violet, Magenta,
-- Midnight and Mono. Blue, Violet (purple) and Magenta (pink) already exist; Midnight and Mono need the
-- column's check to allow them. green and orange stay allowed so a chat that already uses one keeps it —
-- the picker just no longer offers them.
--
-- Additive and idempotent. No semicolon inside any quoted string.

alter table public.conversations
  drop constraint if exists conversations_theme_chk;
alter table public.conversations
  add constraint conversations_theme_chk
  check (theme is null or theme in ('blue', 'pink', 'green', 'orange', 'purple', 'midnight', 'mono'));
