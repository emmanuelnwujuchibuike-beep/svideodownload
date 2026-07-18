-- Download Hub™ + Discovery Gateway™. See docs/DOWNLOAD_HUB_RFC.md §5.
--
-- PRIVACY, stated once and enforced by the schema below: none of these tables
-- stores a source URL or a media title. The URL is the most sensitive field in
-- this product — it identifies exactly what a person watched. Analytics value
-- lives entirely in the aggregate (platform, kind, duration bucket), and the URL
-- adds nothing to that while carrying the whole liability. It is already never
-- logged, and there is deliberately no column here that could hold it.

/* ---------------------------------------------------------------- events -- */

-- One row per completed download. Feeds admin analytics and the ranking weights.
create table if not exists public.download_events (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users (id) on delete set null,
  platform_id   text not null,
  media_kind    text not null check (media_kind in ('video', 'audio', 'image')),
  -- Bucketed, not exact: a precise duration alongside a platform and a timestamp
  -- starts to identify the specific video, which is what we are avoiding.
  duration_band text not null check (duration_band in ('none', 'short', 'medium', 'long')),
  height_band   text not null default 'unknown',
  plan          text not null default 'free',
  created_at    timestamptz not null default now()
);

create index if not exists download_events_created_idx
  on public.download_events (created_at desc);
create index if not exists download_events_platform_idx
  on public.download_events (platform_id, created_at desc);

/* ----------------------------------------------------------- impressions -- */

-- Recommendation shown / clicked / dismissed. The denominator for acceptance rate.
create table if not exists public.gateway_impressions (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users (id) on delete set null,
  action_id  text not null,
  outcome    text not null default 'shown' check (outcome in ('shown', 'clicked', 'dismissed')),
  platform_id text not null default '',
  media_kind text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists gateway_impressions_action_idx
  on public.gateway_impressions (action_id, outcome, created_at desc);

/* ---------------------------------------------------------------- config -- */

-- Admin-editable editorial weights. Read at build/ISR, never per-request, so the
-- Gateway stays a static client-side ranker.
--
-- NOTE what is absent: there is no `availability` column. Availability is derived
-- from the Product Genome (lib/download-hub/recommend.ts) and is deliberately NOT
-- configurable — an admin toggle here would let a human mark a product that does
-- not exist as "live", which is precisely the failure the Reality Ledger exists to
-- prevent. Some things should not be configurable.
create table if not exists public.gateway_config (
  action_id  text primary key,
  base       int not null default 50 check (base between 0 and 100),
  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

/* -------------------------------------------------------------- waitlist -- */

-- Notify-me signups for `planned` destinations. Real rows — this is what makes a
-- "coming soon" CTA honest rather than decorative.
create table if not exists public.product_waitlist (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users (id) on delete cascade,
  ip_hash    text not null default '',
  action_id  text not null,
  created_at timestamptz not null default now()
);

-- One signup per identity per action. coalesce() so anonymous signups dedupe too
-- (a plain nullable column would NOT dedupe — NULLs are distinct in a unique index).
create unique index if not exists product_waitlist_unique_idx
  on public.product_waitlist ((coalesce(user_id::text, ip_hash)), action_id);

/* -------------------------------------------------------------- learning -- */

create table if not exists public.learning_progress (
  user_id      uuid not null references auth.users (id) on delete cascade,
  lesson_slug  text not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, lesson_slug)
);

/* ------------------------------------------------------------------- RLS -- */

alter table public.download_events    enable row level security;
alter table public.gateway_impressions enable row level security;
alter table public.gateway_config     enable row level security;
alter table public.product_waitlist   enable row level security;
alter table public.learning_progress  enable row level security;

-- Analytics tables: written by the service role only (the API routes), read by
-- admins only. No client ever reads or writes these directly.
drop policy if exists download_events_admin_read on public.download_events;
create policy download_events_admin_read on public.download_events
  for select using (public.is_admin());

drop policy if exists gateway_impressions_admin_read on public.gateway_impressions;
create policy gateway_impressions_admin_read on public.gateway_impressions
  for select using (public.is_admin());

-- Config: world-readable (it is editorial weighting, not secret), admin-writable.
drop policy if exists gateway_config_read on public.gateway_config;
create policy gateway_config_read on public.gateway_config
  for select using (true);

drop policy if exists gateway_config_admin_write on public.gateway_config;
create policy gateway_config_admin_write on public.gateway_config
  for all using (public.is_admin()) with check (public.is_admin());

-- Waitlist: you may see and remove your own signup, nothing else. Anonymous rows
-- are unreadable by anyone but an admin, which is correct — they are keyed to an
-- IP hash and have no owner to show them to.
drop policy if exists product_waitlist_own on public.product_waitlist;
create policy product_waitlist_own on public.product_waitlist
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists product_waitlist_delete_own on public.product_waitlist;
create policy product_waitlist_delete_own on public.product_waitlist
  for delete using (auth.uid() = user_id);

-- Learning progress: strictly the owner's.
drop policy if exists learning_progress_own on public.learning_progress;
create policy learning_progress_own on public.learning_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

/* ------------------------------------------------------------- retention -- */

-- 90-day retention on the event tables, then aggregate-only. Called by the
-- existing cron surface (app/api/cron).
create or replace function public.prune_download_hub_events()
returns void language sql security definer set search_path = public as $$
  delete from public.download_events    where created_at < now() - interval '90 days';
  delete from public.gateway_impressions where created_at < now() - interval '90 days';
$$;
