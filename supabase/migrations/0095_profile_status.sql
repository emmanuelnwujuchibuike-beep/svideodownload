-- 0095 — Profile status + mood (Feature 18 · Premium Profile Platform, Part 9).
--
-- A short, expressive status line ("shipping all week", "back from Lagos") plus an
-- optional mood ("Focused", "Celebrating") that a member can set on their profile
-- and edit in settings. Both are nullable and free of any default, so existing
-- rows are unaffected.
--
-- The application reads and writes these columns DEFENSIVELY (a dedicated,
-- try/caught query for reads; a separate best-effort UPDATE for writes), so the
-- profile page and the profile editor keep working correctly whether or not this
-- migration has been applied yet — the feature simply stays dormant until it is.
alter table public.profiles add column if not exists status text;
alter table public.profiles add column if not exists mood text;
