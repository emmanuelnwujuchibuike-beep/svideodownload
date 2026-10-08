-- ═══════════════════════════════════════════════════════════════════════════
--  0195 — THE SELF-SERVE ADVERTISING PLATFORM, PART 1: ENGINE + DATA (2026-10-07)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-07: a premium self-serve ad platform. Part 1 is the engine
-- and the data model that Parts 2-7 (advertiser app, safety, checkout, client
-- rendering, admin, refunds) build on. Full write-up: docs/AD_PLATFORM.md.
--
-- ── What this REUSES (nothing below duplicates it) ──────────────────────────
--   identity      auth.users + profiles, public.is_admin()        (0001, 0144)
--   money         ai_product_balances / ai_product_ledger (CREDIT wallet, 0184)
--                 ai_topup_attempts = the ONE payment-attempt ledger for both
--                 rails (Paystack, Bachs). This adds the purpose ad_campaign.
--   webhooks      payment_provider_events (0186) - unchanged
--   ingest        the browser-to-Postgres batch pattern of track_events (0172)
--   storage       a PUBLIC bucket read straight from the CDN, written only by
--                 the service role (the 0182 pattern)
--
-- ── What it does NOT touch ──────────────────────────────────────────────────
--   public.ads / ad_impressions / ad_clicks stay the operator-managed NETWORK
--   inventory (AdSense, ExoClick, HilltopAds, Monetag). Self-serve campaigns are
--   a different product: an advertiser, a payment, a contract with an end date.
--
-- ── Three numbers that are NOT the same thing ───────────────────────────────
--   ad_formats.rotation_seconds        how often a banner swaps (e.g. 5 s)
--   ad_durations.duration_days         how long a campaign runs (e.g. 7 days)
--   ad_formats.max_duration_seconds    how long a video creative may be (15 s)
--
-- ── Runner rules (HARD LAWS) ────────────────────────────────────────────────
--   no semicolon inside any single-quoted string · plain DDL first, every
--   dollar-quoted function LAST · every statement idempotent.

-- ═══ 1 · CONFIGURATION (admin-controlled, database-driven) ═══════════════════

create table if not exists public.ad_platform_settings (
  id                  boolean primary key default true,
  ads_enabled         boolean not null default true,
  applications_open   boolean not null default false,
  default_slot_count  integer not null default 10,
  updated_by          uuid references auth.users (id) on delete set null,
  updated_at          timestamptz not null default now(),
  constraint ad_platform_settings_singleton_chk check (id),
  constraint ad_platform_settings_slots_chk check (default_slot_count between 1 and 50)
);

create table if not exists public.ad_formats (
  code                   text primary key,
  name                   text not null,
  media_types            text[] not null default array['image']::text[],
  width                  integer,
  height                 integer,
  rotation_seconds       integer,
  slot_count             integer,
  no_consecutive_repeat  boolean not null default false,
  max_duration_seconds   integer,
  max_file_bytes         bigint not null default 5242880,
  max_width              integer not null default 2160,
  max_height             integer not null default 3840,
  min_gap_seconds        integer not null default 0,
  enabled                boolean not null default true,
  sort_order             integer not null default 100,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint ad_formats_code_chk check (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  constraint ad_formats_media_chk check (media_types <@ array['image', 'video']::text[] and cardinality(media_types) > 0),
  constraint ad_formats_rotation_chk check (rotation_seconds is null or rotation_seconds between 2 and 600),
  constraint ad_formats_slots_chk check (slot_count is null or slot_count between 1 and 50),
  constraint ad_formats_duration_chk check (max_duration_seconds is null or max_duration_seconds between 1 and 600),
  constraint ad_formats_bytes_chk check (max_file_bytes between 1024 and 209715200),
  constraint ad_formats_gap_chk check (min_gap_seconds between 0 and 86400)
);

create table if not exists public.ad_placements (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  name         text not null,
  description  text,
  format_code  text not null references public.ad_formats (code) on update cascade,
  page_scope   text[] not null default array['all_pages']::text[],
  enabled      boolean not null default true,
  priority     integer not null default 100,
  sort_order   integer not null default 100,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint ad_placements_code_chk check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint ad_placements_scope_chk check (cardinality(page_scope) > 0)
);

create table if not exists public.ad_durations (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  duration_days  integer not null unique,
  enabled        boolean not null default true,
  sort_order     integer not null default 100,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint ad_durations_days_chk check (duration_days between 1 and 366)
);

-- A price is the price of ONE placement for ONE duration in ONE unit.
-- CREDIT = whole wallet credits, USD = cents, NGN = kobo. No row = not for sale.
create table if not exists public.ad_pricing_plans (
  id            uuid primary key default gen_random_uuid(),
  placement_id  uuid not null references public.ad_placements (id) on delete cascade,
  duration_id   uuid not null references public.ad_durations (id) on delete cascade,
  currency      text not null,
  price_minor   bigint not null,
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint ad_pricing_plans_currency_chk check (currency in ('CREDIT', 'USD', 'NGN')),
  constraint ad_pricing_plans_price_chk check (price_minor >= 0),
  constraint ad_pricing_plans_unique unique (placement_id, duration_id, currency)
);

-- A promotion is applied by the DATABASE (ad_campaign_quote), never chosen by
-- the browser. A null placement or duration means it applies to every one.
create table if not exists public.ad_promotions (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  description       text,
  placement_id      uuid references public.ad_placements (id) on delete cascade,
  duration_id       uuid references public.ad_durations (id) on delete cascade,
  extra_days        integer not null default 0,
  discount_percent  numeric(5, 2) not null default 0,
  starts_at         timestamptz,
  ends_at           timestamptz,
  enabled           boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ad_promotions_extra_chk check (extra_days between 0 and 366),
  constraint ad_promotions_discount_chk check (discount_percent >= 0 and discount_percent <= 100),
  constraint ad_promotions_window_chk check (ends_at is null or starts_at is null or ends_at > starts_at)
);

-- ═══ 2 · ADVERTISERS, CAMPAIGNS, CREATIVES, SLOTS ════════════════════════════

-- A normal member becomes an advertiser. No second auth system, no copy of the
-- profile - only what a business needs that a profile does not hold.
create table if not exists public.advertisers (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique references auth.users (id) on delete cascade,
  business_name  text not null,
  display_name   text not null,
  contact_email  text,
  website_url    text,
  status         text not null default 'active',
  status_reason  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint advertisers_status_chk check (status in ('active', 'restricted', 'suspended', 'disabled')),
  constraint advertisers_names_chk check (length(business_name) between 1 and 120 and length(display_name) between 1 and 60)
);

create table if not exists public.ad_campaigns (
  id                    uuid primary key default gen_random_uuid(),
  advertiser_id         uuid not null references public.advertisers (id) on delete cascade,
  name                  text not null,
  status                text not null default 'draft',
  placement_id          uuid not null references public.ad_placements (id),
  duration_id           uuid not null references public.ad_durations (id),
  target_pages          text[] not null default '{}'::text[],
  currency              text,
  total_amount_minor    bigint,
  daily_amount_minor    bigint,
  pricing_plan_id       uuid references public.ad_pricing_plans (id) on delete set null,
  promotion_id          uuid references public.ad_promotions (id) on delete set null,
  price_snapshot        jsonb,
  duration_days         integer,
  extra_days            integer not null default 0,
  payment_method        text,
  payment_reference     text unique,
  payment_verified_at   timestamptz,
  auto_start            boolean not null default true,
  start_at              timestamptz,
  end_at                timestamptz,
  activated_at          timestamptz,
  started_at            timestamptz,
  review_flags          text[] not null default '{}'::text[],
  status_reason         text,
  version               integer not null default 1,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint ad_campaigns_status_chk check (status in (
    'draft', 'awaiting_payment', 'payment_processing', 'paid', 'validating',
    'active', 'paused', 'expired', 'rejected', 'cancelled', 'removed')),
  constraint ad_campaigns_name_chk check (length(name) between 1 and 120),
  constraint ad_campaigns_method_chk check (payment_method is null or payment_method in ('credits', 'paystack', 'bachs')),
  constraint ad_campaigns_currency_chk check (currency is null or currency in ('CREDIT', 'USD', 'NGN')),
  constraint ad_campaigns_amount_chk check (total_amount_minor is null or total_amount_minor >= 0),
  constraint ad_campaigns_window_chk check (end_at is null or start_at is null or end_at > start_at),
  -- 🔴 the invariant the whole money path rests on: nothing past awaiting
  -- payment exists without a server-verified payment
  constraint ad_campaigns_paid_chk check (
    status in ('draft', 'awaiting_payment', 'payment_processing', 'cancelled', 'removed', 'rejected')
    or payment_verified_at is not null)
);

create table if not exists public.ad_creatives (
  id                     uuid primary key default gen_random_uuid(),
  campaign_id            uuid not null references public.ad_campaigns (id) on delete cascade,
  format_code            text not null references public.ad_formats (code) on update cascade,
  media_type             text not null,
  storage_path           text,
  media_url              text,
  thumbnail_url          text,
  mime_type              text,
  destination_url        text not null,
  headline               text,
  description            text,
  duration_seconds       numeric(7, 2),
  file_size_bytes        bigint,
  width                  integer,
  height                 integer,
  status                 text not null default 'active',
  validation_status      text not null default 'pending',
  validation_errors      text[] not null default '{}'::text[],
  validated_at           timestamptz,
  url_validation_status  text not null default 'pending',
  url_block_reason       text,
  url_validated_at       timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint ad_creatives_media_chk check (media_type in ('image', 'video')),
  constraint ad_creatives_status_chk check (status in ('active', 'paused', 'removed')),
  constraint ad_creatives_validation_chk check (validation_status in ('pending', 'valid', 'invalid', 'blocked')),
  constraint ad_creatives_url_chk check (url_validation_status in ('pending', 'valid', 'blocked')),
  constraint ad_creatives_dest_chk check (length(destination_url) between 8 and 2048),
  constraint ad_creatives_headline_chk check (headline is null or length(headline) <= 90),
  constraint ad_creatives_desc_chk check (description is null or length(description) <= 240)
);

-- The rotating pool. A slot is a POSITION in a placement's rotation - it may be
-- open, or held by a campaign. One campaign may hold more than one slot.
-- A slot whose campaign is no longer live is free again without any cleanup.
create table if not exists public.ad_slots (
  id            uuid primary key default gen_random_uuid(),
  placement_id  uuid not null references public.ad_placements (id) on delete cascade,
  slot_number   integer not null,
  campaign_id   uuid references public.ad_campaigns (id) on delete set null,
  priority      integer not null default 100,
  status        text not null default 'open',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint ad_slots_number_chk check (slot_number between 1 and 50),
  constraint ad_slots_status_chk check (status in ('open', 'assigned', 'held', 'disabled')),
  constraint ad_slots_unique unique (placement_id, slot_number)
);

-- ═══ 3 · EVENTS ══════════════════════════════════════════════════════════════

-- Lifecycle and operator audit: activated, paused, campaign_started,
-- campaign_expired, rejected, removed - who, when, from which status.
create table if not exists public.ad_campaign_events (
  id           bigint generated always as identity primary key,
  campaign_id  uuid not null references public.ad_campaigns (id) on delete cascade,
  kind         text not null,
  from_status  text,
  to_status    text,
  actor_id     uuid references auth.users (id) on delete set null,
  actor_role   text not null default 'system',
  reason       text,
  created_at   timestamptz not null default now(),
  constraint ad_campaign_events_role_chk check (actor_role in ('system', 'admin', 'advertiser'))
);

-- Viewer events, once each. event_id is minted by the browser per (view,
-- type) so a double-fire is the SAME id and lands once. Pruned after 35 days
-- by ad_campaigns_sync_lifecycle - the counters below are the durable record.
create table if not exists public.ad_events (
  event_id        uuid primary key,
  campaign_id     uuid not null references public.ad_campaigns (id) on delete cascade,
  creative_id     uuid not null references public.ad_creatives (id) on delete cascade,
  placement_code  text not null,
  event_type      text not null,
  page            text,
  visitor_id      text,
  user_id         uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint ad_events_type_chk check (event_type in (
    'loaded', 'visible', 'impression', 'click', 'video_start', 'video_complete',
    'interstitial_view', 'reward_video_start', 'reward_video_complete'))
);

create table if not exists public.ad_campaign_daily_stats (
  campaign_id            uuid not null references public.ad_campaigns (id) on delete cascade,
  creative_id            uuid not null references public.ad_creatives (id) on delete cascade,
  placement_code         text not null,
  day                    date not null,
  loads                  integer not null default 0,
  visibles               integer not null default 0,
  impressions            integer not null default 0,
  clicks                 integer not null default 0,
  video_starts           integer not null default 0,
  video_completes        integer not null default 0,
  interstitial_views     integer not null default 0,
  reward_starts          integer not null default 0,
  reward_completes       integer not null default 0,
  primary key (campaign_id, creative_id, placement_code, day)
);

-- ═══ 4 · THE PAYMENT LEDGER LEARNS ONE MORE PURPOSE ══════════════════════════
-- ai_topup_attempts is the one attempt ledger for both rails. A card checkout
-- for a campaign is a row with purpose ad_campaign and item_id = campaign id.
alter table public.ai_topup_attempts drop constraint if exists ai_topup_attempts_purpose_chk;
alter table public.ai_topup_attempts add constraint ai_topup_attempts_purpose_chk
  check (purpose in ('wallet_topup', 'ai_subscription', 'ad_campaign'));

-- ═══ 5 · INDEXES (only the lookups the engine and the owner screens make) ════
create index if not exists ad_campaigns_serving_idx on public.ad_campaigns (placement_id, end_at) where status = 'active';
create index if not exists ad_campaigns_advertiser_idx on public.ad_campaigns (advertiser_id, created_at desc);
create index if not exists ad_campaigns_lifecycle_idx on public.ad_campaigns (status, end_at) where status in ('active', 'paused');
create index if not exists ad_creatives_campaign_idx on public.ad_creatives (campaign_id);
create index if not exists ad_slots_campaign_idx on public.ad_slots (campaign_id) where campaign_id is not null;
create index if not exists ad_campaign_events_campaign_idx on public.ad_campaign_events (campaign_id, created_at desc);
create index if not exists ad_events_created_idx on public.ad_events (created_at);
create index if not exists ad_pricing_plans_lookup_idx on public.ad_pricing_plans (placement_id, duration_id) where enabled;

-- ═══ 6 · ROW LEVEL SECURITY ══════════════════════════════════════════════════
-- Reads: the configuration a buyer needs is public (enabled rows only), an
-- advertiser reads their OWN business, campaigns, creatives, audit and stats,
-- an admin reads everything. Writes: NONE from the browser. Every write is a
-- server route (service role) or a security-definer function below - so the
-- browser can never set a price, a status, a slot or a payment.

alter table public.ad_platform_settings enable row level security;
alter table public.ad_formats enable row level security;
alter table public.ad_placements enable row level security;
alter table public.ad_durations enable row level security;
alter table public.ad_pricing_plans enable row level security;
alter table public.ad_promotions enable row level security;
alter table public.advertisers enable row level security;
alter table public.ad_campaigns enable row level security;
alter table public.ad_creatives enable row level security;
alter table public.ad_slots enable row level security;
alter table public.ad_campaign_events enable row level security;
alter table public.ad_events enable row level security;
alter table public.ad_campaign_daily_stats enable row level security;

revoke insert, update, delete, truncate on
  public.ad_platform_settings, public.ad_formats, public.ad_placements, public.ad_durations,
  public.ad_pricing_plans, public.ad_promotions, public.advertisers, public.ad_campaigns,
  public.ad_creatives, public.ad_slots, public.ad_campaign_events, public.ad_events,
  public.ad_campaign_daily_stats
  from anon, authenticated;
revoke select on public.ad_events from anon, authenticated;

drop policy if exists "ad settings readable" on public.ad_platform_settings;
create policy "ad settings readable" on public.ad_platform_settings for select using (true);

drop policy if exists "ad formats enabled or admin" on public.ad_formats;
create policy "ad formats enabled or admin" on public.ad_formats
  for select using (enabled or (select public.is_admin()));

drop policy if exists "ad placements enabled or admin" on public.ad_placements;
create policy "ad placements enabled or admin" on public.ad_placements
  for select using (enabled or (select public.is_admin()));

drop policy if exists "ad durations enabled or admin" on public.ad_durations;
create policy "ad durations enabled or admin" on public.ad_durations
  for select using (enabled or (select public.is_admin()));

drop policy if exists "ad pricing enabled or admin" on public.ad_pricing_plans;
create policy "ad pricing enabled or admin" on public.ad_pricing_plans
  for select using (enabled or (select public.is_admin()));

drop policy if exists "ad promotions live or admin" on public.ad_promotions;
create policy "ad promotions live or admin" on public.ad_promotions
  for select using (
    (enabled and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()))
    or (select public.is_admin()));

drop policy if exists "advertisers own or admin" on public.advertisers;
create policy "advertisers own or admin" on public.advertisers
  for select using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "ad campaigns own or admin" on public.ad_campaigns;
create policy "ad campaigns own or admin" on public.ad_campaigns
  for select using (
    advertiser_id in (select a.id from public.advertisers a where a.user_id = (select auth.uid()))
    or (select public.is_admin()));

drop policy if exists "ad creatives own or admin" on public.ad_creatives;
create policy "ad creatives own or admin" on public.ad_creatives
  for select using (
    campaign_id in (select c.id from public.ad_campaigns c join public.advertisers a on a.id = c.advertiser_id
                    where a.user_id = (select auth.uid()))
    or (select public.is_admin()));

drop policy if exists "ad slots admin" on public.ad_slots;
create policy "ad slots admin" on public.ad_slots for select using ((select public.is_admin()));

drop policy if exists "ad campaign events own or admin" on public.ad_campaign_events;
create policy "ad campaign events own or admin" on public.ad_campaign_events
  for select using (
    campaign_id in (select c.id from public.ad_campaigns c join public.advertisers a on a.id = c.advertiser_id
                    where a.user_id = (select auth.uid()))
    or (select public.is_admin()));

drop policy if exists "ad stats own or admin" on public.ad_campaign_daily_stats;
create policy "ad stats own or admin" on public.ad_campaign_daily_stats
  for select using (
    campaign_id in (select c.id from public.ad_campaigns c join public.advertisers a on a.id = c.advertiser_id
                    where a.user_id = (select auth.uid()))
    or (select public.is_admin()));

-- ═══ 7 · STORAGE: creatives are read from the CDN, never through Vercel ══════
-- Public read (the served creative IS public), no storage.objects policy: an
-- advertiser uploads with a signed upload URL the server mints (Part 2), so the
-- bytes go browser to Supabase and never through Vercel or Railway memory.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ad-creatives', 'ad-creatives', true, 52428800,
        array['image/webp', 'image/jpeg', 'image/png', 'image/avif', 'video/mp4', 'video/webm'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ═══ 8 · SEEDS: the shape, never a price ═════════════════════════════════════
-- Formats, placements and durations are seeded so the engine has a shape. No
-- price and no promotion is seeded: nothing is for sale until an admin sets a
-- price, and applications stay closed (applications_open = false).

insert into public.ad_platform_settings (id) values (true) on conflict (id) do nothing;

insert into public.ad_formats (code, name, media_types, width, height, rotation_seconds, slot_count, no_consecutive_repeat, max_duration_seconds, max_file_bytes, min_gap_seconds, sort_order) values
  ('TOP_BANNER', 'Top banner', array['image'], null, 32, 5, 10, false, null, 1048576, 0, 10),
  ('CONTENT_BANNER', 'Content banner', array['image', 'video'], 320, 200, 5, 10, false, 30, 10485760, 0, 20),
  ('DOWNLOAD_RESULT_BANNER', 'Download result banner', array['image', 'video'], 320, 200, 5, 10, false, 30, 10485760, 0, 30),
  ('INTERSTITIAL', 'Interstitial', array['image', 'video'], null, null, null, 10, true, 30, 20971520, 120, 40),
  ('DOWNLOAD_COMPLETED_INTERSTITIAL', 'Download completed interstitial', array['image', 'video'], null, null, null, 10, true, 30, 20971520, 0, 50),
  ('REWARD_VIDEO', 'Reward video', array['video'], null, null, null, 10, true, 15, 52428800, 0, 60)
on conflict (code) do nothing;

insert into public.ad_placements (code, name, description, format_code, page_scope, sort_order) values
  ('global_top_banner', 'Global top banner', 'The 32 px strip at the top of every page.', 'TOP_BANNER', array['all_pages'], 10),
  ('feed_banner', 'Feed', 'Between posts in the Feed.', 'CONTENT_BANNER', array['feed'], 20),
  ('reels_banner', 'Reels', 'Between Reels.', 'CONTENT_BANNER', array['reels', 'ai_reels'], 30),
  ('ai_banner', 'AI pages', 'On the Frenz AI pages.', 'CONTENT_BANNER', array['ai'], 40),
  ('stories_card', 'Stories', 'A full-screen card between Stories.', 'INTERSTITIAL', array['stories'], 50),
  ('download_page_banner', 'Download page', 'On the downloader, under the link box.', 'CONTENT_BANNER', array['download'], 60),
  ('download_result_banner', 'Download result', 'On the download result card.', 'DOWNLOAD_RESULT_BANNER', array['download_result'], 70),
  ('interstitial', 'Interstitial', 'A full-screen ad between pages.', 'INTERSTITIAL', array['all_pages'], 80),
  ('download_completed_interstitial', 'Download completed', 'A full-screen ad when a download finishes.', 'DOWNLOAD_COMPLETED_INTERSTITIAL', array['download', 'download_result'], 90),
  ('ai_video_save_reward', 'AI video save reward', 'A reward video watched to save an AI video.', 'REWARD_VIDEO', array['ai', 'ai_reels'], 100)
on conflict (code) do nothing;

insert into public.ad_durations (name, duration_days, sort_order) values
  ('1 day', 1, 10), ('2 days', 2, 20), ('7 days', 7, 30), ('14 days', 14, 40), ('30 days', 30, 50)
on conflict (duration_days) do nothing;

comment on table public.ad_campaigns is 'A self-serve ad campaign (0195). Status, price, payment and slot are written only by the server and the functions in 0195 - never by the browser. payment_verified_at is set only by pay_ad_campaign_with_credits or settle_ad_campaign_payment.';
comment on column public.ad_campaigns.duration_days is 'How long the campaign runs, snapshotted from ad_durations at payment. NOT the banner rotation interval and NOT a video length.';
comment on column public.ad_formats.rotation_seconds is 'How often a rotating placement swaps to the next ad, in the browser, with no request. NOT the campaign length.';
comment on column public.ad_formats.max_duration_seconds is 'The longest video creative this format accepts, re-checked at serve time so a lowered limit applies at once.';
comment on table public.ad_events is 'One row per viewer event (0195), deduplicated by a browser-minted event_id. Pruned after 35 days - ad_campaign_daily_stats is the durable record.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN. NO PLAIN DDL BELOW EXCEPT TRIGGERS.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── the guard: the table itself refuses an unpaid or unauthorised live campaign ──
create or replace function public.ad_campaigns_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_adv text;
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
    -- the money record is written once and never rewritten
    if old.payment_verified_at is not null and (
         new.payment_verified_at is distinct from old.payment_verified_at
      or new.payment_reference is distinct from old.payment_reference
      or new.total_amount_minor is distinct from old.total_amount_minor
      or new.currency is distinct from old.currency) then
      raise exception 'ad campaign payment record is immutable';
    end if;
  end if;
  if new.status = 'active' then
    if new.payment_verified_at is null then
      raise exception 'ad campaign cannot be active without a verified payment';
    end if;
    select status into v_adv from public.advertisers where id = new.advertiser_id;
    if v_adv is distinct from 'active' then
      raise exception 'ad campaign cannot be active while its advertiser is %', coalesce(v_adv, 'missing');
    end if;
    if new.start_at is null or new.end_at is null then
      raise exception 'ad campaign cannot be active without a start and an end';
    end if;
  end if;
  return new;
end;
$$;

-- ── the allowed status moves. lib/ads-platform/campaign-status.ts holds the SAME
--    map and a test asserts the two agree. Activation is NOT here - only
--    activate_ad_campaign may move a campaign to active. ──
create or replace function public.ad_campaign_transition_allowed(p_from text, p_to text) returns boolean
language sql immutable set search_path = public as $$
  select case p_from
    when 'draft'              then p_to in ('awaiting_payment', 'cancelled', 'removed')
    when 'awaiting_payment'   then p_to in ('draft', 'payment_processing', 'cancelled', 'removed')
    when 'payment_processing' then p_to in ('awaiting_payment', 'cancelled', 'removed')
    when 'paid'               then p_to in ('validating', 'rejected', 'removed')
    when 'validating'         then p_to in ('rejected', 'removed')
    when 'active'             then p_to in ('paused', 'expired', 'removed')
    when 'paused'             then p_to in ('expired', 'removed')
    when 'expired'            then p_to in ('removed')
    when 'rejected'           then p_to in ('removed')
    when 'cancelled'          then p_to in ('removed')
    else false
  end;
$$;

-- ── one status move, optimistic: p_expected_version must match or nothing changes ──
create or replace function public.transition_ad_campaign(
  p_campaign uuid, p_to text, p_expected_version integer, p_actor uuid, p_actor_role text, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_from    text;
  v_version integer;
begin
  if p_actor_role not in ('system', 'admin', 'advertiser') then
    return jsonb_build_object('ok', false, 'reason', 'bad_role');
  end if;
  select status, version into v_from, v_version from public.ad_campaigns where id = p_campaign for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_expected_version is not null and v_version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'stale', 'version', v_version, 'status', v_from);
  end if;
  if not public.ad_campaign_transition_allowed(v_from, p_to) then
    return jsonb_build_object('ok', false, 'reason', 'transition_not_allowed', 'from', v_from, 'to', p_to);
  end if;
  -- an advertiser may only move their own campaign before it is paid for
  if p_actor_role = 'advertiser' and not (
       (v_from = 'draft' and p_to in ('awaiting_payment', 'cancelled'))
    or (v_from = 'awaiting_payment' and p_to in ('draft', 'cancelled'))) then
    return jsonb_build_object('ok', false, 'reason', 'not_permitted');
  end if;
  update public.ad_campaigns
     set status = p_to, status_reason = coalesce(p_reason, status_reason)
   where id = p_campaign
  returning version into v_version;
  insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role, reason)
  values (p_campaign, case p_to when 'expired' then 'campaign_expired' else p_to end, v_from, p_to, p_actor, p_actor_role, p_reason);
  return jsonb_build_object('ok', true, 'from', v_from, 'to', p_to, 'version', v_version);
end;
$$;

-- ── the price, decided by the database from admin rows only ──
create or replace function public.ad_campaign_quote(p_campaign uuid, p_currency text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_placement   uuid;
  v_duration    uuid;
  v_pl_enabled  boolean;
  v_fmt_enabled boolean;
  v_days        integer;
  v_d_enabled   boolean;
  v_plan        uuid;
  v_price       bigint;
  v_promo       uuid;
  v_discount    numeric := 0;
  v_extra       integer := 0;
  v_total       bigint;
begin
  select c.placement_id, c.duration_id into v_placement, v_duration from public.ad_campaigns c where c.id = p_campaign;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select p.enabled, f.enabled into v_pl_enabled, v_fmt_enabled
    from public.ad_placements p join public.ad_formats f on f.code = p.format_code where p.id = v_placement;
  if not coalesce(v_pl_enabled, false) then return jsonb_build_object('ok', false, 'reason', 'placement_disabled'); end if;
  if not coalesce(v_fmt_enabled, false) then return jsonb_build_object('ok', false, 'reason', 'format_disabled'); end if;
  select duration_days, enabled into v_days, v_d_enabled from public.ad_durations where id = v_duration;
  if not coalesce(v_d_enabled, false) then return jsonb_build_object('ok', false, 'reason', 'duration_disabled'); end if;
  select id, price_minor into v_plan, v_price from public.ad_pricing_plans
   where placement_id = v_placement and duration_id = v_duration and currency = p_currency and enabled;
  if v_plan is null then return jsonb_build_object('ok', false, 'reason', 'no_price'); end if;
  select id, discount_percent, extra_days into v_promo, v_discount, v_extra from public.ad_promotions
   where enabled
     and (placement_id is null or placement_id = v_placement)
     and (duration_id is null or duration_id = v_duration)
     and (starts_at is null or starts_at <= now())
     and (ends_at is null or ends_at > now())
   order by discount_percent desc, extra_days desc, created_at
   limit 1;
  v_discount := coalesce(v_discount, 0);
  v_extra := coalesce(v_extra, 0);
  -- the discount is rounded DOWN, so the total is never below the advertised rate
  v_total := greatest(0, v_price - floor(v_price * v_discount / 100)::bigint);
  return jsonb_build_object(
    'ok', true, 'currency', p_currency, 'list_price', v_price, 'discount_percent', v_discount,
    'total', v_total, 'duration_days', v_days, 'extra_days', v_extra,
    'pricing_plan_id', v_plan, 'promotion_id', v_promo, 'quoted_at', now());
end;
$$;

-- ── pay from the wallet: one transaction, once, priced by the database ──
-- The CREDIT wallet is filled through the existing Paystack/Bachs top-up, whose
-- webhooks are already the authority. Spending it here needs no browser claim.
create or replace function public.pay_ad_campaign_with_credits(p_user uuid, p_campaign uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_status   text;
  v_verified timestamptz;
  v_owner    uuid;
  v_adv      text;
  v_q        jsonb;
  v_total    bigint;
  v_balance  bigint;
  v_wd       bigint;
  v_wallet   text;
  v_wpart    bigint := 0;
  v_ref      text := 'ad-campaign:' || p_campaign::text;
  v_days     integer;
begin
  select c.status, c.payment_verified_at, a.user_id, a.status into v_status, v_verified, v_owner, v_adv
    from public.ad_campaigns c join public.advertisers a on a.id = c.advertiser_id
   where c.id = p_campaign
     for update of c;
  if not found or v_owner is distinct from p_user then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_verified is not null then return jsonb_build_object('ok', true, 'already_paid', true, 'reference', v_ref); end if;
  if v_adv <> 'active' then return jsonb_build_object('ok', false, 'reason', 'advertiser_not_active'); end if;
  if v_status not in ('draft', 'awaiting_payment') then return jsonb_build_object('ok', false, 'reason', 'bad_status', 'status', v_status); end if;
  v_q := public.ad_campaign_quote(p_campaign, 'CREDIT');
  if not (v_q ->> 'ok')::boolean then return v_q; end if;
  v_total := (v_q ->> 'total')::bigint;
  v_days := (v_q ->> 'duration_days')::integer;
  if v_total > 0 then
    select balance_cents, withdrawable_cents, currency into v_balance, v_wd, v_wallet
      from public.ai_product_balances where user_id = p_user and product = 'character_replace' for update;
    if v_wallet is distinct from 'CREDIT' then return jsonb_build_object('ok', false, 'reason', 'no_wallet'); end if;
    if v_balance < v_total then return jsonb_build_object('ok', false, 'reason', 'insufficient', 'balance', v_balance, 'total', v_total); end if;
    -- cashable credit is spent LAST, like every charge (0187)
    v_wpart := greatest(0, v_total - (v_balance - v_wd));
    update public.ai_product_balances
       set balance_cents = balance_cents - v_total, withdrawable_cents = withdrawable_cents - v_wpart, updated_at = now()
     where user_id = p_user and product = 'character_replace'
    returning balance_cents into v_balance;
    insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, metadata, withdrawable_part)
    values (p_user, 'character_replace', 'processing_charge', 'settled', -v_total, v_balance, 'CREDIT', v_ref, 'Ad campaign',
            jsonb_build_object('purpose', 'ad_campaign', 'campaign_id', p_campaign), v_wpart);
  end if;
  update public.ad_campaigns
     set status = 'paid', currency = 'CREDIT', total_amount_minor = v_total,
         daily_amount_minor = ceil(v_total::numeric / greatest(1, v_days))::bigint,
         pricing_plan_id = (v_q ->> 'pricing_plan_id')::uuid, promotion_id = (v_q ->> 'promotion_id')::uuid,
         price_snapshot = v_q, duration_days = v_days, extra_days = (v_q ->> 'extra_days')::integer,
         payment_method = 'credits', payment_reference = v_ref, payment_verified_at = now()
   where id = p_campaign;
  insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role, reason)
  values (p_campaign, 'paid', v_status, 'paid', p_user, 'advertiser', 'credits ' || v_total);
  return jsonb_build_object('ok', true, 'reference', v_ref, 'total', v_total, 'balance_after', v_balance, 'withdrawable_part', v_wpart);
end;
$$;

-- ── settle a CARD payment (Paystack/Bachs). Called by the webhook / verify path
--    AFTER the provider's signature was checked - never by the browser. The
--    checkout (Part 3) writes the attempt and puts the campaign in
--    payment_processing with the quoted total and the attempt reference. ──
create or replace function public.settle_ad_campaign_payment(p_reference text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_purpose  text;
  v_astatus  text;
  v_amount   bigint;
  v_cur      text;
  v_item     text;
  v_cid      uuid;
  v_status   text;
  v_verified timestamptz;
  v_total    bigint;
  v_ccur     text;
  v_cref     text;
begin
  select purpose, status, amount_cents, currency, item_id into v_purpose, v_astatus, v_amount, v_cur, v_item
    from public.ai_topup_attempts where reference = p_reference;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_attempt'); end if;
  if v_purpose <> 'ad_campaign' then return jsonb_build_object('ok', false, 'reason', 'not_an_ad_payment'); end if;
  if v_astatus <> 'success' then return jsonb_build_object('ok', false, 'reason', 'not_paid', 'status', v_astatus); end if;
  if v_item !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return jsonb_build_object('ok', false, 'reason', 'bad_item'); end if;
  v_cid := v_item::uuid;
  select status, payment_verified_at, total_amount_minor, currency, payment_reference
    into v_status, v_verified, v_total, v_ccur, v_cref
    from public.ad_campaigns where id = v_cid for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_verified is not null then return jsonb_build_object('ok', true, 'already_paid', true, 'campaign_id', v_cid); end if;
  if v_cref is distinct from p_reference then return jsonb_build_object('ok', false, 'reason', 'reference_mismatch'); end if;
  if v_status not in ('awaiting_payment', 'payment_processing') then return jsonb_build_object('ok', false, 'reason', 'bad_status', 'status', v_status); end if;
  if v_total is null or v_ccur is distinct from v_cur or v_amount < v_total then
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;
  update public.ad_campaigns set status = 'paid', payment_verified_at = now() where id = v_cid;
  insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_role, reason)
  values (v_cid, 'paid', v_status, 'paid', 'system', 'card ' || p_reference);
  return jsonb_build_object('ok', true, 'campaign_id', v_cid);
end;
$$;

-- ── activation: the ONLY way into active. Checks payment, advertiser, every
--    creative, the placement, and takes a free slot. Anything flagged stays in
--    validating with the reasons written down - never live by accident. ──
create or replace function public.activate_ad_campaign(p_campaign uuid, p_actor uuid, p_actor_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c            public.ad_campaigns%rowtype;
  v_adv        text;
  v_pl_enabled boolean;
  v_fmt_code   text;
  v_fmt_on     boolean;
  v_slots      integer;
  v_slot       integer;
  v_flags      text[] := '{}'::text[];
  v_start      timestamptz;
  v_end        timestamptz;
  v_count      integer;
  v_first      boolean;
begin
  if p_actor_role not in ('system', 'admin') then return jsonb_build_object('ok', false, 'reason', 'not_permitted'); end if;
  select * into c from public.ad_campaigns where id = p_campaign for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if c.status = 'active' then return jsonb_build_object('ok', true, 'already_active', true); end if;
  if c.status not in ('paid', 'validating', 'paused') then return jsonb_build_object('ok', false, 'reason', 'bad_status', 'status', c.status); end if;
  if c.payment_verified_at is null then return jsonb_build_object('ok', false, 'reason', 'payment_unverified'); end if;
  v_first := c.status in ('paid', 'validating');

  select status into v_adv from public.advertisers where id = c.advertiser_id;
  if v_adv is distinct from 'active' then v_flags := v_flags || 'advertiser_not_active'::text; end if;

  select p.enabled, p.format_code, f.enabled, coalesce(f.slot_count, s.default_slot_count)
    into v_pl_enabled, v_fmt_code, v_fmt_on, v_slots
    from public.ad_placements p
    join public.ad_formats f on f.code = p.format_code
    cross join public.ad_platform_settings s
   where p.id = c.placement_id;
  if not coalesce(v_pl_enabled, false) then v_flags := v_flags || 'placement_disabled'::text; end if;
  if not coalesce(v_fmt_on, false) then v_flags := v_flags || 'format_disabled'::text; end if;

  select count(*) into v_count from public.ad_creatives where campaign_id = p_campaign and status = 'active';
  if v_count = 0 then v_flags := v_flags || 'no_creative'::text; end if;
  if exists (select 1 from public.ad_creatives where campaign_id = p_campaign and status = 'active' and format_code <> v_fmt_code) then
    v_flags := v_flags || 'format_mismatch'::text;
  end if;
  if exists (select 1 from public.ad_creatives where campaign_id = p_campaign and status = 'active' and validation_status = 'pending') then
    v_flags := v_flags || 'validation_pending'::text;
  end if;
  if exists (select 1 from public.ad_creatives where campaign_id = p_campaign and status = 'active' and validation_status in ('invalid', 'blocked')) then
    v_flags := v_flags || 'creative_invalid'::text;
  end if;
  if exists (select 1 from public.ad_creatives where campaign_id = p_campaign and status = 'active' and url_validation_status <> 'valid') then
    v_flags := v_flags || 'destination_not_valid'::text;
  end if;

  if not v_first and c.end_at is not null and c.end_at <= now() then
    update public.ad_campaigns set status = 'expired' where id = p_campaign;
    insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role)
    values (p_campaign, 'campaign_expired', c.status, 'expired', p_actor, p_actor_role);
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if cardinality(v_flags) = 0 and v_first then
    -- a free slot: one that is open, or whose holder is no longer live
    perform pg_advisory_xact_lock(hashtext('ad-slots:' || c.placement_id::text));
    select n into v_slot
      from generate_series(1, v_slots) n
     where not exists (
       select 1 from public.ad_slots sl
         join public.ad_campaigns o on o.id = sl.campaign_id
        where sl.placement_id = c.placement_id and sl.slot_number = n and o.id <> p_campaign
          and o.status in ('paid', 'validating', 'active', 'paused')
          and (o.end_at is null or o.end_at > now()))
       and not exists (
       select 1 from public.ad_slots sl
        where sl.placement_id = c.placement_id and sl.slot_number = n and sl.status = 'disabled')
     order by n
     limit 1;
    if v_slot is null then v_flags := v_flags || 'placement_full'::text; end if;
  end if;

  if cardinality(v_flags) > 0 then
    if c.status <> 'validating' then
      update public.ad_campaigns set status = 'validating', review_flags = v_flags where id = p_campaign;
    else
      update public.ad_campaigns set review_flags = v_flags where id = p_campaign;
    end if;
    insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role, reason)
    values (p_campaign, 'flagged', c.status, 'validating', p_actor, p_actor_role, array_to_string(v_flags, ','));
    return jsonb_build_object('ok', false, 'reason', 'flagged', 'flags', to_jsonb(v_flags));
  end if;

  if v_first then
    insert into public.ad_slots (placement_id, slot_number, campaign_id, status)
    values (c.placement_id, v_slot, p_campaign, 'assigned')
    on conflict (placement_id, slot_number) do update set campaign_id = excluded.campaign_id, status = 'assigned', updated_at = now();
    -- auto_start: live the moment it is valid. Otherwise at its scheduled start, never in the past.
    v_start := case when c.auto_start or c.start_at is null then now() else greatest(now(), c.start_at) end;
    v_end := v_start + make_interval(days => coalesce(c.duration_days, 0) + coalesce(c.extra_days, 0));
    update public.ad_campaigns
       set status = 'active', start_at = v_start, end_at = v_end, activated_at = now(), review_flags = '{}'::text[],
           started_at = case when v_start <= now() then now() end
     where id = p_campaign;
  else
    update public.ad_campaigns set status = 'active', review_flags = '{}'::text[] where id = p_campaign;
  end if;
  insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role)
  values (p_campaign, case when v_first then 'activated' else 'resumed' end, c.status, 'active', p_actor, p_actor_role);
  if v_first and v_start <= now() then
    insert into public.ad_campaign_events (campaign_id, kind, to_status, actor_role) values (p_campaign, 'campaign_started', 'active', 'system');
  end if;
  return jsonb_build_object('ok', true, 'slot', v_slot, 'start_at', coalesce(v_start, c.start_at), 'end_at', coalesce(v_end, c.end_at));
end;
$$;

-- ── lifecycle without a cron: run by the serving route on a CDN miss (at most
--    once per 5-minute bucket per region). Serving never depends on it - the
--    engine filters on time - it only keeps status and the audit honest. ──
create or replace function public.ad_campaigns_sync_lifecycle() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_expired integer := 0;
  v_started integer := 0;
  v_pruned  integer := 0;
begin
  with due as (
    select id, status from public.ad_campaigns
     where status in ('active', 'paused') and end_at <= now()
     for update skip locked
  ), upd as (
    update public.ad_campaigns c set status = 'expired' from due where c.id = due.id
    returning c.id, due.status as from_status
  )
  insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_role)
  select id, 'campaign_expired', from_status, 'expired', 'system' from upd;
  get diagnostics v_expired = row_count;

  with st as (
    update public.ad_campaigns set started_at = now()
     where status = 'active' and started_at is null and start_at <= now()
    returning id
  )
  insert into public.ad_campaign_events (campaign_id, kind, to_status, actor_role)
  select id, 'campaign_started', 'active', 'system' from st;
  get diagnostics v_started = row_count;

  delete from public.ad_events where event_id in (
    select event_id from public.ad_events where created_at < now() - interval '35 days' limit 5000);
  get diagnostics v_pruned = row_count;

  return jsonb_build_object('expired', v_expired, 'started', v_started, 'pruned', v_pruned);
end;
$$;

-- ── what the serving route needs, and NOTHING private: no email, no payment,
--    no price, no moderation reason. The rules themselves live in ONE place,
--    lib/ads-platform/eligibility.ts (getEligibleAds). This only refuses to
--    ship rows that could never serve. ──
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
        'advertiser_status', a.status, 'advertiser_name', a.display_name,
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

-- ── viewer events, straight from the browser (the track_events pattern, 0172):
--    batched, at most 50 per call, once per event_id, counters bumped only for
--    a row that actually landed. Never raises into the page. ──
create or replace function public.track_ad_events(p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_count integer := 0;
  v_n     integer;
  r       jsonb;
  v_type  text;
  v_cid   uuid;
  v_crid  uuid;
  v_pl    text;
  v_uuid  text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then return 0; end if;
  if jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 50 then return 0; end if;
  for r in select * from jsonb_array_elements(p_rows)
  loop
    begin
      continue when coalesce(r ->> 'id', '') !~ v_uuid or coalesce(r ->> 'c', '') !~ v_uuid or coalesce(r ->> 'cr', '') !~ v_uuid;
      v_type := r ->> 't';
      continue when v_type is null or v_type not in ('loaded', 'visible', 'impression', 'click', 'video_start', 'video_complete',
                                                    'interstitial_view', 'reward_video_start', 'reward_video_complete');
      v_cid := (r ->> 'c')::uuid;
      v_crid := (r ->> 'cr')::uuid;
      -- only a creative of a campaign that is (or was until a day ago) live counts
      select p.code into v_pl
        from public.ad_creatives cr
        join public.ad_campaigns c on c.id = cr.campaign_id
        join public.ad_placements p on p.id = c.placement_id
       where cr.id = v_crid and c.id = v_cid
         and c.status in ('active', 'paused', 'expired') and c.end_at > now() - interval '1 day';
      continue when v_pl is null;
      insert into public.ad_events (event_id, campaign_id, creative_id, placement_code, event_type, page, visitor_id, user_id)
      values ((r ->> 'id')::uuid, v_cid, v_crid, v_pl, v_type, left(r ->> 'p', 32), left(r ->> 'v', 64), v_uid)
      on conflict (event_id) do nothing;
      get diagnostics v_n = row_count;
      continue when v_n = 0;
      insert into public.ad_campaign_daily_stats as s (campaign_id, creative_id, placement_code, day,
        loads, visibles, impressions, clicks, video_starts, video_completes, interstitial_views, reward_starts, reward_completes)
      values (v_cid, v_crid, v_pl, (now() at time zone 'utc')::date,
        (v_type = 'loaded')::int, (v_type = 'visible')::int, (v_type = 'impression')::int, (v_type = 'click')::int,
        (v_type = 'video_start')::int, (v_type = 'video_complete')::int, (v_type = 'interstitial_view')::int,
        (v_type = 'reward_video_start')::int, (v_type = 'reward_video_complete')::int)
      on conflict (campaign_id, creative_id, placement_code, day) do update set
        loads = s.loads + excluded.loads, visibles = s.visibles + excluded.visibles,
        impressions = s.impressions + excluded.impressions, clicks = s.clicks + excluded.clicks,
        video_starts = s.video_starts + excluded.video_starts, video_completes = s.video_completes + excluded.video_completes,
        interstitial_views = s.interstitial_views + excluded.interstitial_views,
        reward_starts = s.reward_starts + excluded.reward_starts, reward_completes = s.reward_completes + excluded.reward_completes;
      v_count := v_count + 1;
    exception when others then
      raise warning 'track_ad_events row skipped: % %', sqlstate, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$$;

-- ── triggers (reference the functions above) ──
drop trigger if exists ad_campaigns_guard on public.ad_campaigns;
create trigger ad_campaigns_guard before insert or update on public.ad_campaigns
  for each row execute function public.ad_campaigns_guard();

do $$
declare
  t text;
begin
  foreach t in array array['ad_platform_settings', 'ad_formats', 'ad_placements', 'ad_durations', 'ad_pricing_plans',
                           'ad_promotions', 'advertisers', 'ad_creatives', 'ad_slots'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_content_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- ── who may call what. A new function is executable by the browser until this
--    runs (HARD LAW) - so every one is revoked, and only the ingest is reopened. ──
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.ad_campaigns_guard()',
    'public.ad_campaign_transition_allowed(text, text)',
    'public.transition_ad_campaign(uuid, text, integer, uuid, text, text)',
    'public.ad_campaign_quote(uuid, text)',
    'public.pay_ad_campaign_with_credits(uuid, uuid)',
    'public.settle_ad_campaign_payment(text)',
    'public.activate_ad_campaign(uuid, uuid, text)',
    'public.ad_campaigns_sync_lifecycle()',
    'public.ad_serving_snapshot()',
    'public.track_ad_events(jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
  grant execute on function public.track_ad_events(jsonb) to anon, authenticated;
end $$;
