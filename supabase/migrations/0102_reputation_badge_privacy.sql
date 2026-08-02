-- 0102 — Reputation + plan-badge public visibility (owner, 2026-08-02).
--
-- Reputation is shown publicly on a profile BY DEFAULT, and the Pro/Business
-- ("Diamond/Crown") badge is shown BY DEFAULT — both can be hidden by the member
-- from their Privacy settings. Two booleans on privacy_settings, defaulting true
-- so every existing member keeps the current (shown) behaviour until they opt out.
--
-- The reader (getPrivacySettings) selects these behind a fallback and the writer
-- (/api/privacy) strips them on failure, so the app degrades gracefully if this
-- migration has not been applied yet.

alter table public.privacy_settings
  add column if not exists show_reputation boolean not null default true,
  add column if not exists show_plan_badge boolean not null default true;
