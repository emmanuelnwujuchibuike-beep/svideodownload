-- ═══════════════════════════════════════════════════════════════════════════
--  0211 — "All slots": one campaign in every ad slot (2026-10-09)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "add a way users can apply to advertise on all slot, with a price set
-- in admin dashboard, for a period of time. All slot shows on all available
-- slots and also rotates when others buy all slots."
--
-- A format and a placement, nothing else: the price is a row in
-- ad_pricing_plans the admin sets per duration (none is seeded - not for sale
-- until priced), and serving merges an all-slots campaign into every slot's
-- rotation where its media fits that slot's own rules
-- (lib/ads-platform/eligibility.ts). A slot's own buyers keep first place.
--
-- Insert-only and idempotent.

insert into public.ad_formats (code, name, media_types, width, height, rotation_seconds, slot_count, no_consecutive_repeat, max_duration_seconds, max_file_bytes, min_gap_seconds, sort_order) values
  ('ALL_SLOTS', 'All slots', array['image', 'video'], 1280, 800, 5, 10, false, 15, 10485760, 0, 5)
on conflict (code) do nothing;

update public.ad_formats
   set description = 'Your ad in every ad slot on Frenzsave - the most reach. A video also runs as a reward video when it is 15 seconds or shorter.',
       recommendation = '1280 x 800 image, or a video up to 15 seconds'
 where code = 'ALL_SLOTS' and description is null;

insert into public.ad_placements (code, name, description, format_code, page_scope, sort_order) values
  ('all_slots', 'All slots', 'Every ad slot across Frenzsave, rotating with the other ads in each.', 'ALL_SLOTS', array['all_pages'], 5)
on conflict (code) do nothing;
