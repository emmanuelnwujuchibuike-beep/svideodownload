-- ═══════════════════════════════════════════════════════════════════════════
--  0207 — a paid ad tile in the History grid (2026-10-09)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "Add an ad slot in the history grid, that stays like a history post
-- with the same grid size … wire it to the advertisement and users can choose
-- the slot. It should be applying one in every 4 square grid in the history."
--
-- One new placement an advertiser can pick in /advertise. It uses the existing
-- CONTENT_BANNER format, so the same creative rules, upload limits and review
-- apply; the site cover-crops it into a square tile (slot `history_grid`,
-- lib/ads-platform/slot-registry.ts). Like every placement it is NOT for sale
-- until an admin prices it, and an admin can switch it off.
--
-- Insert-only and idempotent: safe to run before or after the site code ships.

insert into public.ad_placements (code, name, description, format_code, page_scope, sort_order) values
  ('history_grid', 'History grid', 'A square tile in the History grid, every 4th square, the same size as a download.', 'CONTENT_BANNER', array['history'], 25)
on conflict (code) do nothing;
