-- 0106 — Public view count on a profile (owner, 2026-08-03: "let users views
-- show in public on default and they can hide it at anytime").
--
-- One boolean on privacy_settings, defaulting TRUE so views are public for
-- everyone from the moment this lands, with a toggle in Privacy to turn it off.
-- Same shape as 0102's show_reputation / show_plan_badge: the reader selects it
-- behind a fallback and the writer strips it on failure, so the app degrades
-- gracefully if this migration has not been applied yet.

alter table public.privacy_settings
  add column if not exists show_views boolean not null default true;
