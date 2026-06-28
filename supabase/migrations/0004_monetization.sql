-- =====================================================================
-- FrenzSave — Phase 4: monetization ecosystem
-- Tables: events, ads, ad_impressions, ad_clicks, affiliate_offers,
--         affiliate_clicks, subscriptions, api_keys, api_usage
-- All RLS-enforced. Inserts for tracking/billing go through the service
-- role (server). `public.is_admin()` is defined in 0001.
-- =====================================================================

do $$ begin
  create type public.billing_plan as enum ('free', 'pro', 'business');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.subscription_status as enum
    ('active', 'trialing', 'past_due', 'canceled', 'incomplete', 'unpaid');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- events — unified analytics stream (downloads, ad/affiliate clicks,
-- subscriptions, api calls, …). The one table every subsystem writes to.
-- ---------------------------------------------------------------------
create table if not exists public.events (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users (id) on delete set null,
  type        text not null,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists events_type_created_idx on public.events (type, created_at desc);
create index if not exists events_user_idx on public.events (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- ads — DB-driven ad slots; one active row per (zone, priority).
-- ---------------------------------------------------------------------
create table if not exists public.ads (
  id          uuid primary key default uuid_generate_v4(),
  zone        text not null,        -- global | homepage_top | download_result_page | sidebar | exit_intent_popup | mobile_bottom_banner
  network     text not null,        -- adsterra | propellerads | native | house | ...
  format      text not null default 'display', -- display (banner/iframe) | pop (popunder/social-bar/multitag) | native
  script_code text,                 -- raw embed script/markup from the network
  image_url   text,                 -- for native/house ads
  target_url  text,                 -- for native/house ads (click-through)
  headline    text,                 -- native/house copy
  width       int,                  -- banner width  (e.g. 300, 728, 320)
  height      int,                  -- banner height (e.g. 250, 90, 50)
  priority    int  not null default 100,
  weight      int  not null default 1,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
-- idempotent: add columns if the table already existed from an earlier run
alter table public.ads add column if not exists width  int;
alter table public.ads add column if not exists height int;
create index if not exists ads_zone_active_idx on public.ads (zone, active, priority);

create table if not exists public.ad_impressions (
  id          uuid primary key default uuid_generate_v4(),
  ad_id       uuid references public.ads (id) on delete set null,
  zone        text not null,
  user_id     uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists ad_impressions_zone_created_idx on public.ad_impressions (zone, created_at desc);

create table if not exists public.ad_clicks (
  id          uuid primary key default uuid_generate_v4(),
  ad_id       uuid references public.ads (id) on delete set null,
  zone        text not null,
  user_id     uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists ad_clicks_zone_created_idx on public.ad_clicks (zone, created_at desc);

-- ---------------------------------------------------------------------
-- affiliate_offers — targeted CTAs chosen by device/country/priority.
-- ---------------------------------------------------------------------
create table if not exists public.affiliate_offers (
  id                uuid primary key default uuid_generate_v4(),
  name              text not null,
  description       text,
  url               text not null,
  image_url         text,
  cta               text not null default 'Learn more',
  category          text,
  country_targeting text[] not null default '{}',  -- ISO codes; empty = all
  device_targeting  text[] not null default '{}',  -- 'mobile' | 'desktop'; empty = all
  priority          int  not null default 100,
  weight            int  not null default 1,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);
create index if not exists affiliate_offers_active_idx on public.affiliate_offers (active, priority);

create table if not exists public.affiliate_clicks (
  id          uuid primary key default uuid_generate_v4(),
  offer_id    uuid references public.affiliate_offers (id) on delete set null,
  user_id     uuid references auth.users (id) on delete set null,
  country     text,
  device      text,
  created_at  timestamptz not null default now()
);
create index if not exists affiliate_clicks_offer_created_idx on public.affiliate_clicks (offer_id, created_at desc);

-- ---------------------------------------------------------------------
-- subscriptions — Paystack-synced; source of truth for a user's plan.
-- Provider-agnostic refs so the billing provider can change without a schema
-- change (customer_ref = Paystack customer_code, subscription_ref = sub code).
-- ---------------------------------------------------------------------
create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  plan                   public.billing_plan not null default 'free',
  status                 public.subscription_status,
  provider               text not null default 'paystack',
  customer_ref           text,   -- Paystack customer_code
  subscription_ref       text,   -- Paystack subscription_code
  email_token            text,   -- Paystack token required to disable a sub
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  updated_at             timestamptz not null default now()
);
-- idempotent: a subscriptions table from an earlier (Stripe) run is migrated here
alter table public.subscriptions add column if not exists provider             text not null default 'paystack';
alter table public.subscriptions add column if not exists customer_ref         text;
alter table public.subscriptions add column if not exists subscription_ref     text;
alter table public.subscriptions add column if not exists email_token          text;
alter table public.subscriptions add column if not exists current_period_end   timestamptz;
alter table public.subscriptions add column if not exists cancel_at_period_end boolean not null default false;
create index if not exists subscriptions_customer_ref_idx on public.subscriptions (customer_ref);
create index if not exists subscriptions_subscription_ref_idx on public.subscriptions (subscription_ref);

-- ---------------------------------------------------------------------
-- api_keys — hashed; the raw key is shown once at creation and never stored.
-- ---------------------------------------------------------------------
create table if not exists public.api_keys (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null default 'Default',
  key_hash    text not null unique,   -- sha256 of the raw key
  key_prefix  text not null,          -- e.g. 'svd_live_a1b2' for display
  last_used   timestamptz,
  revoked     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists api_keys_user_idx on public.api_keys (user_id);

create table if not exists public.api_usage (
  id          uuid primary key default uuid_generate_v4(),
  api_key_id  uuid references public.api_keys (id) on delete cascade,
  user_id     uuid references auth.users (id) on delete set null,
  endpoint    text not null,
  status      int not null default 200,
  bytes       bigint not null default 0,
  day         date not null default (now() at time zone 'utc')::date,
  created_at  timestamptz not null default now()
);
create index if not exists api_usage_key_day_idx on public.api_usage (api_key_id, day);
create index if not exists api_usage_user_day_idx on public.api_usage (user_id, day);

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.events           enable row level security;
alter table public.ads              enable row level security;
alter table public.ad_impressions   enable row level security;
alter table public.ad_clicks        enable row level security;
alter table public.affiliate_offers enable row level security;
alter table public.affiliate_clicks enable row level security;
alter table public.subscriptions    enable row level security;
alter table public.api_keys         enable row level security;
alter table public.api_usage        enable row level security;

-- events: admin-only read; inserts via service role (no insert policy).
drop policy if exists "events admin read" on public.events;
create policy "events admin read" on public.events for select using (public.is_admin());

-- ads: anyone can read ACTIVE slots (script is meant to be embedded); admin writes.
drop policy if exists "ads public read" on public.ads;
create policy "ads public read" on public.ads for select using (active or public.is_admin());
drop policy if exists "ads admin write" on public.ads;
create policy "ads admin write" on public.ads for all using (public.is_admin()) with check (public.is_admin());

-- ad/affiliate tracking tables: admin-only read; inserts via service role.
drop policy if exists "ad_impressions admin read" on public.ad_impressions;
create policy "ad_impressions admin read" on public.ad_impressions for select using (public.is_admin());
drop policy if exists "ad_clicks admin read" on public.ad_clicks;
create policy "ad_clicks admin read" on public.ad_clicks for select using (public.is_admin());
drop policy if exists "affiliate_clicks admin read" on public.affiliate_clicks;
create policy "affiliate_clicks admin read" on public.affiliate_clicks for select using (public.is_admin());

-- affiliate_offers: public read active; admin writes.
drop policy if exists "affiliate_offers public read" on public.affiliate_offers;
create policy "affiliate_offers public read" on public.affiliate_offers
  for select using (active or public.is_admin());
drop policy if exists "affiliate_offers admin write" on public.affiliate_offers;
create policy "affiliate_offers admin write" on public.affiliate_offers
  for all using (public.is_admin()) with check (public.is_admin());

-- subscriptions: a user reads their own; admins read all. Writes via service role.
drop policy if exists "subscriptions self read" on public.subscriptions;
create policy "subscriptions self read" on public.subscriptions
  for select using (auth.uid() = user_id or public.is_admin());

-- api_keys: a user reads their own rows; admins read all. Writes via service role.
drop policy if exists "api_keys self read" on public.api_keys;
create policy "api_keys self read" on public.api_keys
  for select using (auth.uid() = user_id or public.is_admin());

-- api_usage: a user reads their own; admins read all. Inserts via service role.
drop policy if exists "api_usage self read" on public.api_usage;
create policy "api_usage self read" on public.api_usage
  for select using (auth.uid() = user_id or public.is_admin());

-- ---------------------------------------------------------------------
-- Helper: resolve a user's effective plan (free if no active row).
-- ---------------------------------------------------------------------
create or replace function public.user_plan(uid uuid)
returns public.billing_plan
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select plan from public.subscriptions
       where user_id = uid
         and status in ('active', 'trialing')
       limit 1),
    'free'::public.billing_plan
  );
$$;
