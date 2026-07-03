-- =====================================================================
-- 0024_profile_location_business.sql
-- Profile enrichment: a free-text `location` (used to surface nearby
-- creators in Discovery) and a `business_url` (the profile "business link"
-- that replaces the old generic website field in the editor).
-- Idempotent; safe to re-run. Apply manually in Supabase.
-- =====================================================================

alter table public.profiles add column if not exists location     text;
alter table public.profiles add column if not exists business_url text;

-- Speeds up "creators in the same place" lookups for the discovery grid.
create index if not exists profiles_location_idx
  on public.profiles (lower(location)) where location is not null;
