-- ═══════════════════════════════════════════════════════════════════════════
--  0196 — THE ADVERTISER APPLICATION (Part 2 of the ad platform, 2026-10-07)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Builds on 0195 - nothing here re-creates a table or a function of it.
--
--   1. ad_formats learns what an advertiser must be TOLD and what a creative
--      must MEET: a description, a recommendation, the minimum size and the
--      shape (aspect ratio and tolerance). All admin-editable, nothing in code.
--   2. ad_platform_settings learns the application switches: multiple
--      placements per application (off), how many, the advertiser-facing
--      currency (USD), and how many open drafts one advertiser may hold.
--   3. ad_campaigns learns the application: the group it belongs to, the
--      rules the advertiser accepted (when + which version), and when the
--      price shown to them was locked.
--   4. ad_blocked_domains: destinations refused outright. Seeded with link
--      shorteners (a shortened link hides where a tap really goes) - the
--      admin adds and removes rows.
--   5. a PRIVATE staging bucket. An upload lands there, the server reads the
--      REAL bytes, and only a creative that passes is copied into the public
--      ad-creatives bucket. Nothing unvalidated is ever publicly served.
--   6. ad_catalog(): everything the application screen needs, in ONE read,
--      straight from the browser to Postgres - no Vercel function.
--
-- Runner rules: no semicolon inside a quoted string, functions LAST.

-- ═══ 1 · what a format tells the advertiser and requires of a creative ═══════
alter table public.ad_formats add column if not exists description text;
alter table public.ad_formats add column if not exists recommendation text;
alter table public.ad_formats add column if not exists min_width integer;
alter table public.ad_formats add column if not exists min_height integer;
alter table public.ad_formats add column if not exists aspect_ratio numeric(8, 4);
alter table public.ad_formats add column if not exists aspect_tolerance numeric(4, 3) not null default 0.12;

alter table public.ad_formats drop constraint if exists ad_formats_min_chk;
alter table public.ad_formats add constraint ad_formats_min_chk check (
  (min_width is null or min_width between 1 and 8000) and (min_height is null or min_height between 1 and 8000));
alter table public.ad_formats drop constraint if exists ad_formats_aspect_chk;
alter table public.ad_formats add constraint ad_formats_aspect_chk check (
  (aspect_ratio is null or aspect_ratio between 0.1 and 20) and aspect_tolerance between 0 and 1);

-- Fill only what an admin has not already written.
update public.ad_formats set
  description = coalesce(description, 'A slim image banner at the top of the selected pages.'),
  recommendation = coalesce(recommendation, 'A wide, simple image with a short message - 1280 x 128 works well.'),
  min_width = coalesce(min_width, 640), min_height = coalesce(min_height, 64),
  aspect_tolerance = case when aspect_ratio is null then 0.35 else aspect_tolerance end,
  aspect_ratio = coalesce(aspect_ratio, 10)
 where code = 'TOP_BANNER';
update public.ad_formats set
  description = coalesce(description, 'A 320 x 200 card shown inside the selected pages.'),
  recommendation = coalesce(recommendation, 'An image or a short video at 1280 x 800.'),
  min_width = coalesce(min_width, 640), min_height = coalesce(min_height, 400),
  aspect_ratio = coalesce(aspect_ratio, 1.6)
 where code in ('CONTENT_BANNER', 'DOWNLOAD_RESULT_BANNER');
update public.ad_formats set
  description = coalesce(description, 'A full-screen advertisement shown between user actions.'),
  recommendation = coalesce(recommendation, 'A portrait image or video at 1080 x 1920.'),
  min_width = coalesce(min_width, 540), min_height = coalesce(min_height, 960),
  aspect_ratio = coalesce(aspect_ratio, 0.5625)
 where code in ('INTERSTITIAL', 'DOWNLOAD_COMPLETED_INTERSTITIAL');
update public.ad_formats set
  description = coalesce(description, 'A short video shown when a user chooses a rewarded action.'),
  recommendation = coalesce(recommendation, 'A portrait MP4 at 1080 x 1920, sound optional.'),
  min_width = coalesce(min_width, 540), min_height = coalesce(min_height, 960),
  aspect_ratio = coalesce(aspect_ratio, 0.5625)
 where code = 'REWARD_VIDEO';

-- Placement copy in the advertiser's words (only where 0195's seed text is untouched).
update public.ad_placements set description = 'A small banner displayed below the Frenzsave header.' where code = 'global_top_banner' and description = 'The 32 px strip at the top of every page.';
update public.ad_placements set description = 'Shown between posts in the Frenzsave Feed.' where code = 'feed_banner' and description = 'Between posts in the Feed.';
update public.ad_placements set description = 'An advertisement placement within the Frenzsave Reels experience.' where code = 'reels_banner' and description = 'Between Reels.';
update public.ad_placements set description = 'Shown on the Frenz AI pages.' where code = 'ai_banner' and description = 'On the Frenz AI pages.';
update public.ad_placements set description = 'Shown on the downloader, under the link box.' where code = 'download_page_banner' and description = 'On the downloader, under the link box.';
update public.ad_placements set description = 'Shown on the card where a download is ready.' where code = 'download_result_banner' and description = 'On the download result card.';
update public.ad_placements set description = 'A full-screen advertisement between pages.' where code = 'interstitial' and description = 'A full-screen ad between pages.';
update public.ad_placements set description = 'A full-screen advertisement when a download finishes.' where code = 'download_completed_interstitial' and description = 'A full-screen ad when a download finishes.';
update public.ad_placements set description = 'Your video advertisement may be shown when users save AI-generated videos.' where code = 'ai_video_save_reward' and description = 'A reward video watched to save an AI video.';

-- ═══ 2 · application switches ════════════════════════════════════════════════
alter table public.ad_platform_settings add column if not exists multi_placement_enabled boolean not null default false;
alter table public.ad_platform_settings add column if not exists max_placements_per_application integer not null default 3;
alter table public.ad_platform_settings add column if not exists display_currency text not null default 'USD';
alter table public.ad_platform_settings add column if not exists max_open_drafts integer not null default 10;
alter table public.ad_platform_settings drop constraint if exists ad_platform_settings_app_chk;
alter table public.ad_platform_settings add constraint ad_platform_settings_app_chk check (
  max_placements_per_application between 1 and 10
  and display_currency in ('CREDIT', 'USD', 'NGN')
  and max_open_drafts between 1 and 100);

-- ═══ 3 · the application on the campaign ═════════════════════════════════════
-- application_id groups the campaigns one application created (one per
-- placement when multiple placements are on). The first campaign is the
-- group's own id.
alter table public.ad_campaigns add column if not exists application_id uuid;
alter table public.ad_campaigns add column if not exists rules_accepted_at timestamptz;
alter table public.ad_campaigns add column if not exists rules_version text;
alter table public.ad_campaigns add column if not exists quoted_at timestamptz;
create index if not exists ad_campaigns_application_idx on public.ad_campaigns (application_id) where application_id is not null;

-- Nothing reaches awaiting_payment (or beyond) without the rules on record.
alter table public.ad_campaigns drop constraint if exists ad_campaigns_rules_chk;
alter table public.ad_campaigns add constraint ad_campaigns_rules_chk check (
  status in ('draft', 'cancelled', 'removed', 'rejected')
  or (rules_accepted_at is not null and rules_version is not null));

-- A creative is uploaded (step 4) before its link is typed (step 5), so the
-- link is empty until then. An empty link never serves: activation requires
-- url_validation_status = valid, and the engine re-checks the URL itself.
alter table public.ad_creatives alter column destination_url drop not null;
alter table public.ad_creatives drop constraint if exists ad_creatives_dest_chk;
alter table public.ad_creatives add constraint ad_creatives_dest_chk check (destination_url is null or length(destination_url) between 8 and 2048);

-- ═══ 4 · refused destinations ═══════════════════════════════════════════════
create table if not exists public.ad_blocked_domains (
  domain      text primary key,
  reason      text not null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint ad_blocked_domains_domain_chk check (domain ~ '^[a-z0-9.-]+[.][a-z0-9-]+$' and domain = lower(domain))
);
alter table public.ad_blocked_domains enable row level security;
revoke insert, update, delete, truncate on public.ad_blocked_domains from anon, authenticated;
drop policy if exists "ad blocked domains admin" on public.ad_blocked_domains;
create policy "ad blocked domains admin" on public.ad_blocked_domains for select using ((select public.is_admin()));

insert into public.ad_blocked_domains (domain, reason) values
  ('bit.ly', 'link shortener'), ('tinyurl.com', 'link shortener'), ('goo.gl', 'link shortener'),
  ('is.gd', 'link shortener'), ('cutt.ly', 'link shortener'), ('rebrand.ly', 'link shortener'),
  ('shorturl.at', 'link shortener'), ('ow.ly', 'link shortener'), ('buff.ly', 'link shortener'),
  ('rb.gy', 'link shortener'), ('tiny.cc', 'link shortener'), ('s.id', 'link shortener'),
  ('t.ly', 'link shortener'), ('v.gd', 'link shortener'), ('bit.do', 'link shortener'),
  ('shorte.st', 'link shortener'), ('adf.ly', 'link shortener'), ('lnkd.in', 'link shortener'),
  ('t.co', 'link shortener'), ('qr.ae', 'link shortener'), ('urlz.fr', 'link shortener')
on conflict (domain) do nothing;

-- ═══ 5 · staging: private until the server has read the real bytes ══════════
-- No storage.objects policy: the browser writes only through a signed upload
-- URL the server mints for one exact path, and nobody reads from here but the
-- service role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ad-creatives-staging', 'ad-creatives-staging', false, 52428800,
        array['image/webp', 'image/jpeg', 'image/png', 'image/avif', 'video/mp4', 'video/webm'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

comment on column public.ad_campaigns.rules_accepted_at is 'When the advertiser ticked the Advertising Rules box for this application (0196), recorded by the server at submission. rules_version is the version they saw.';
comment on table public.ad_blocked_domains is 'Destinations an ad may never link to (0196). A host matches its own row or any parent domain row. Admin-managed.';

-- ═════════════════════════════════════════════════════════════════════════════
--  FUNCTIONS LAST
-- ═════════════════════════════════════════════════════════════════════════════

-- ── the buyer's menu, in one read: only what is enabled AND priced ──
-- Public on purpose (anon + authenticated): it is the price list. It carries
-- no campaign, no advertiser, nothing about anyone.
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
        'aspect_ratio', f.aspect_ratio, 'aspect_tolerance', f.aspect_tolerance) order by f.sort_order)
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

-- ── is a host refused? its own row, or any parent domain's ──
create or replace function public.ad_domain_blocked(p_host text) returns text
language sql stable security definer set search_path = public as $$
  select b.reason from public.ad_blocked_domains b
   where lower(p_host) = b.domain or lower(p_host) like '%.' || b.domain
   order by length(b.domain) desc
   limit 1;
$$;

do $$
begin
  revoke all on function public.ad_catalog() from public;
  grant execute on function public.ad_catalog() to anon, authenticated, service_role;
  revoke all on function public.ad_domain_blocked(text) from public, anon, authenticated;
  grant execute on function public.ad_domain_blocked(text) to service_role;
end $$;
