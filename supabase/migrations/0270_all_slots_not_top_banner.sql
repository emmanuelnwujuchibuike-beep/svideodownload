-- ═══════════════════════════════════════════════════════════════════════════
--  0270 — "All slots" no longer includes the global top banner (2026-10-23)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-23: "the banner should only show this image" — the global top
-- banner carries only creatives bought for it (lib/ads-platform/eligibility.ts
-- leaves all-slots campaigns out of `global_top_banner`). The advertiser-facing
-- words said "every ad slot", which is no longer true; they now say so.
-- Text only: no row is added, moved or removed.

update public.ad_formats
   set description = 'Your ad in every ad slot on Frenzsave except the top banner - the most reach. A video also runs as a reward video when it is 15 seconds or shorter.'
 where code = 'ALL_SLOTS'
   and description = 'Your ad in every ad slot on Frenzsave - the most reach. A video also runs as a reward video when it is 15 seconds or shorter.';

update public.ad_placements
   set description = 'Every ad slot across Frenzsave except the top banner, rotating with the other ads in each.'
 where code = 'all_slots'
   and description = 'Every ad slot across Frenzsave, rotating with the other ads in each.';
