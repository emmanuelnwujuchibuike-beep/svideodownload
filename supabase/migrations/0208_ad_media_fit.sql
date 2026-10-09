-- ═══════════════════════════════════════════════════════════════════════════
--  0208 — ad creatives are fitted, never refused for their shape (2026-10-09)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "When advertisers upload images or videos, the system rejects them
-- because their dimensions do not exactly match the selected ad slot … Replace
-- incorrect exact-size rejection with safe, automatic optimization and
-- aspect-ratio-preserving fitting."
--
-- The four sizes, kept apart (lib/ads-platform/media-spec.ts):
--   display      the physical slot's shape      → slot registry (code), never here
--   recommended  ad_formats.width / height      → advice shown to the advertiser
--   upload max   ad_formats.max_width/height (orientation-agnostic), max_upload_bytes
--   delivery     ad_formats.delivery_long_edge, image_quality, max_file_bytes
--
-- Images are optimized in the advertiser's browser before upload (a worker).
-- Videos above the delivery size are transcoded by Cloudflare Stream, pulled by
-- URL from the private staging bucket — the bytes never pass through Vercel or
-- Railway. While a video is processing its creative stays `pending`, which
-- activate_ad_campaign already refuses, so nothing goes live unprocessed.
--
-- Additive and idempotent: safe to run before or after the site code ships
-- (the code defaults every new column when it is absent).

-- ── format limits an admin can tune (Part 7 admin, Creative formats) ──
alter table public.ad_formats add column if not exists delivery_long_edge integer not null default 1280;
alter table public.ad_formats add column if not exists image_quality integer not null default 82;
alter table public.ad_formats add column if not exists max_upload_bytes bigint;

do $$ begin
  alter table public.ad_formats add constraint ad_formats_delivery_chk check (delivery_long_edge between 240 and 3840);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ad_formats add constraint ad_formats_quality_chk check (image_quality between 40 and 100);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ad_formats add constraint ad_formats_upload_chk check (max_upload_bytes is null or max_upload_bytes between 1024 and 2147483648);
exception when duplicate_object then null; end $$;

-- full-screen formats deliver larger; the 10:1 strip needs its width
update public.ad_formats set delivery_long_edge = 1920
 where code in ('INTERSTITIAL', 'DOWNLOAD_COMPLETED_INTERSTITIAL', 'REWARD_VIDEO') and delivery_long_edge = 1280;
update public.ad_formats set delivery_long_edge = 1600 where code = 'TOP_BANNER' and delivery_long_edge = 1280;
-- a video may be uploaded larger than it is served: Stream makes the served copy
update public.ad_formats set max_upload_bytes = 209715200
 where 'video' = any (media_types) and max_upload_bytes is null;

-- ── processing state on the creative ──
alter table public.ad_creatives add column if not exists processing_status text not null default 'none';
alter table public.ad_creatives add column if not exists processing_kind text;
alter table public.ad_creatives add column if not exists stream_uid text;
alter table public.ad_creatives add column if not exists processing_error text;
alter table public.ad_creatives add column if not exists processing_started_at timestamptz;
alter table public.ad_creatives add column if not exists processing_attempts integer not null default 0;
alter table public.ad_creatives add column if not exists delivery_width integer;
alter table public.ad_creatives add column if not exists delivery_height integer;

do $$ begin
  alter table public.ad_creatives add constraint ad_creatives_processing_chk check (processing_status in ('none', 'processing', 'ready', 'failed'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ad_creatives add constraint ad_creatives_processing_kind_chk check (processing_kind is null or processing_kind in ('draft', 'replacement'));
exception when duplicate_object then null; end $$;

create index if not exists ad_creatives_stream_uid_idx on public.ad_creatives (stream_uid) where stream_uid is not null;

comment on column public.ad_creatives.processing_status is 'none = served as uploaded, processing = Cloudflare Stream is transcoding it (the creative stays pending, so it cannot activate), ready = served from the Stream MP4, failed = processing_error says why (0208).';
comment on column public.ad_formats.delivery_long_edge is 'The longest edge a creative is SERVED at, in px. Larger images are reduced in the browser before upload, larger videos are transcoded (0208).';

-- ── the staging bucket takes a video before it is transcoded (was 50 MB) ──
update storage.buckets set file_size_limit = 209715200 where id = 'ad-creatives-staging' and file_size_limit < 209715200;

-- ═════════════════════════════════════════════════════════════════════════════
--  FUNCTIONS LAST — the buyer's menu now carries the delivery limits
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.ad_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'v', 1,
    'settings', (select jsonb_build_object(
        'ads_enabled', s.ads_enabled, 'applications_open', s.applications_open,
        'multi_placement_enabled', s.multi_placement_enabled,
        'max_placements_per_application', s.max_placements_per_application,
        'display_currency', s.display_currency, 'default_slot_count', s.default_slot_count)
      from public.ad_platform_settings s where s.id),
    'formats', coalesce((select jsonb_agg(jsonb_build_object(
        'code', f.code, 'name', f.name, 'description', f.description, 'recommendation', f.recommendation,
        'media_types', f.media_types, 'width', f.width, 'height', f.height,
        'rotation_seconds', f.rotation_seconds, 'max_duration_seconds', f.max_duration_seconds,
        'max_file_bytes', f.max_file_bytes, 'max_width', f.max_width, 'max_height', f.max_height,
        'min_width', f.min_width, 'min_height', f.min_height,
        'aspect_ratio', f.aspect_ratio, 'aspect_tolerance', f.aspect_tolerance,
        'delivery_long_edge', f.delivery_long_edge, 'image_quality', f.image_quality,
        'max_upload_bytes', f.max_upload_bytes) order by f.sort_order)
      from public.ad_formats f where f.enabled), '[]'::jsonb),
    'placements', coalesce((select jsonb_agg(jsonb_build_object(
        'code', p.code, 'name', p.name, 'description', p.description,
        'format_code', p.format_code, 'page_scope', p.page_scope) order by p.sort_order)
      from public.ad_placements p join public.ad_formats f on f.code = p.format_code
     where p.enabled and f.enabled), '[]'::jsonb),
    'durations', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name, 'days', d.duration_days) order by d.sort_order, d.duration_days)
      from public.ad_durations d where d.enabled), '[]'::jsonb),
    'prices', coalesce((select jsonb_agg(jsonb_build_object(
        'placement_code', p.code, 'duration_id', pr.duration_id, 'currency', pr.currency, 'price_minor', pr.price_minor))
      from public.ad_pricing_plans pr
      join public.ad_placements p on p.id = pr.placement_id and p.enabled
      join public.ad_durations d on d.id = pr.duration_id and d.enabled
     where pr.enabled), '[]'::jsonb),
    'promotions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pm.id, 'name', pm.name, 'description', pm.description,
        'placement_code', (select p.code from public.ad_placements p where p.id = pm.placement_id),
        'duration_id', pm.duration_id, 'extra_days', pm.extra_days, 'discount_percent', pm.discount_percent,
        'ends_at', pm.ends_at, 'created_at', pm.created_at))
      from public.ad_promotions pm
     where pm.enabled and (pm.starts_at is null or pm.starts_at <= now()) and (pm.ends_at is null or pm.ends_at > now())), '[]'::jsonb),
    'at', now()
  );
$$;
