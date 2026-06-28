-- =====================================================================
-- FrenzSave — Phase 5: managed affiliates & "Recommended Tools"
-- Extends the existing `affiliate_offers` table (which already powers the
-- result-page affiliate engine + tracked /api/go redirects + affiliate_clicks)
-- so the same rows can be curated as on-site "Recommended Tools" and managed
-- entirely from the admin dashboard — scheduling, ordering and per-placement
-- targeting. Global on/off toggles live in the existing `settings` table under
-- key `monetization` (no new table needed).
-- All idempotent so it's safe to re-run.
-- =====================================================================

-- Scheduling window: row is live only between starts_at..ends_at (null = open).
alter table public.affiliate_offers add column if not exists starts_at  timestamptz;
alter table public.affiliate_offers add column if not exists ends_at    timestamptz;

-- Manual ordering within a placement (lower = earlier). priority still tiers
-- the result-page weighted picker; sort_order drives the curated lists.
alter table public.affiliate_offers add column if not exists sort_order int not null default 100;

-- Where this row may render as a recommended tool. Empty = result-page affiliate
-- engine only (legacy behaviour). Values: homepage | download_result | blog |
-- footer | sidebar.
alter table public.affiliate_offers add column if not exists placements text[] not null default '{}';

create index if not exists affiliate_offers_sort_idx
  on public.affiliate_offers (active, sort_order, priority);
create index if not exists affiliate_offers_placements_idx
  on public.affiliate_offers using gin (placements);

-- Admin needs full read/write (the public policy only exposes ACTIVE rows).
-- Writes go through the service role from admin API routes, but an explicit
-- admin policy keeps direct dashboard reads (all rows, incl. disabled) working.
drop policy if exists "affiliate_offers admin all" on public.affiliate_offers;
create policy "affiliate_offers admin all" on public.affiliate_offers
  for all using (public.is_admin()) with check (public.is_admin());
