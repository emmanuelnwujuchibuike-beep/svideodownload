-- ═══════════════════════════════════════════════════════════════════════════
--  0243 — each ad shows the brand name from ITS OWN application (2026-10-15)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, with a screenshot of the full-screen ad's header ("Frenzsave · AD"):
-- "Check if the name here is the brand name it uses or the frenzsave platform.
-- It should be the brand name used in application."
--
-- It already was the "Business or brand name" typed in the application, never
-- the platform's name. But it lived on `advertisers.display_name`, ONE per
-- account and overwritten by every new application. An account that applied
-- for brand A and then brand B showed "B" on brand A's live ads too. The name
-- now travels with each campaign:
--
--   · ad_campaigns.brand_name, written by the submit step on every campaign of
--     the application (lib/ads-platform/advertiser-server.ts submitApplication)
--   · existing campaigns are filled with the account's CURRENT name, which is
--     what they show today, so nothing on screen changes when this runs
--   · ad_serving_snapshot ships the campaign's brand, else the account's name
--
-- Idempotent. The site works before and after it runs (the submit step's write
-- of the new column is best-effort until then).

alter table public.ad_campaigns add column if not exists brand_name text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ad_campaigns_brand_name_chk') then
    alter table public.ad_campaigns
      add constraint ad_campaigns_brand_name_chk check (brand_name is null or length(brand_name) between 1 and 120);
  end if;
end $$;

update public.ad_campaigns c
   set brand_name = a.business_name
  from public.advertisers a
 where a.id = c.advertiser_id and c.brand_name is null;

create or replace function public.ad_serving_snapshot() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object('ads_enabled', s.ads_enabled, 'default_slot_count', s.default_slot_count)
                   from public.ad_platform_settings s where s.id),
    'formats', coalesce((select jsonb_agg(jsonb_build_object(
        'code', f.code, 'media_types', f.media_types, 'width', f.width, 'height', f.height,
        'rotation_seconds', f.rotation_seconds, 'slot_count', f.slot_count,
        'no_consecutive_repeat', f.no_consecutive_repeat, 'max_duration_seconds', f.max_duration_seconds,
        'max_file_bytes', f.max_file_bytes, 'max_width', f.max_width, 'max_height', f.max_height,
        'min_gap_seconds', f.min_gap_seconds, 'enabled', f.enabled) order by f.sort_order)
      from public.ad_formats f), '[]'::jsonb),
    'placements', coalesce((select jsonb_agg(jsonb_build_object(
        'code', p.code, 'format_code', p.format_code, 'page_scope', p.page_scope,
        'enabled', p.enabled, 'priority', p.priority) order by p.sort_order)
      from public.ad_placements p), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'placement_code', p.code, 'status', c.status,
        'payment_verified', c.payment_verified_at is not null,
        'advertiser_status', a.status,
        -- 0243: the brand THIS campaign was applied under; the account's latest name only for a campaign from before 0243
        'advertiser_name', coalesce(nullif(left(btrim(c.brand_name), 60), ''), a.display_name),
        'start_at', c.start_at, 'end_at', c.end_at, 'target_pages', c.target_pages,
        'slot_number', (select min(sl.slot_number) from public.ad_slots sl
                         where sl.campaign_id = c.id and sl.placement_id = c.placement_id and sl.status = 'assigned'),
        'creatives', coalesce((select jsonb_agg(jsonb_build_object(
            'id', cr.id, 'format_code', cr.format_code, 'media_type', cr.media_type,
            'media_url', cr.media_url, 'thumbnail_url', cr.thumbnail_url,
            'destination_url', cr.destination_url, 'headline', cr.headline, 'description', cr.description,
            'duration_seconds', cr.duration_seconds, 'width', cr.width, 'height', cr.height,
            'file_size_bytes', cr.file_size_bytes, 'status', cr.status,
            'validation_status', cr.validation_status, 'url_validation_status', cr.url_validation_status)
            order by cr.created_at)
          from public.ad_creatives cr where cr.campaign_id = c.id and cr.status = 'active'), '[]'::jsonb))
        order by c.activated_at)
      from public.ad_campaigns c
      join public.ad_placements p on p.id = c.placement_id
      join public.advertisers a on a.id = c.advertiser_id
     where c.status = 'active' and c.payment_verified_at is not null
       and a.status = 'active' and c.end_at > now()), '[]'::jsonb)
  );
$$;

revoke all on function public.ad_serving_snapshot() from public, anon, authenticated;
grant execute on function public.ad_serving_snapshot() to service_role;
