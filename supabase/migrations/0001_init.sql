-- =====================================================================
-- SVideoDownload — initial schema
-- Tables: profiles, downloads, analytics, traffic_logs, settings,
--         platform_stats
-- Includes: enums, indexes, RLS policies, triggers
-- =====================================================================

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('user', 'pro', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.download_status as enum ('pending', 'processing', 'completed', 'failed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  avatar_url  text,
  role        public.user_role not null default 'user',
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- downloads
-- ---------------------------------------------------------------------
create table if not exists public.downloads (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users (id) on delete set null,
  source_url  text not null,
  platform    text not null,
  title       text,
  thumbnail   text,
  format      text,
  status      public.download_status not null default 'completed',
  is_favorite boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists downloads_user_id_created_idx
  on public.downloads (user_id, created_at desc);
create index if not exists downloads_platform_idx
  on public.downloads (platform);

-- ---------------------------------------------------------------------
-- analytics
-- ---------------------------------------------------------------------
create table if not exists public.analytics (
  id          uuid primary key default uuid_generate_v4(),
  event_name  text not null,
  user_id     uuid references auth.users (id) on delete set null,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists analytics_event_created_idx
  on public.analytics (event_name, created_at desc);

-- ---------------------------------------------------------------------
-- traffic_logs
-- ---------------------------------------------------------------------
create table if not exists public.traffic_logs (
  id          uuid primary key default uuid_generate_v4(),
  ip_hash     text,
  country     text,
  device      text,
  referrer    text,
  created_at  timestamptz not null default now()
);

create index if not exists traffic_logs_created_idx
  on public.traffic_logs (created_at desc);

-- ---------------------------------------------------------------------
-- settings (singleton key/value app config)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id     uuid primary key default uuid_generate_v4(),
  key    text not null unique,
  value  jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------------
-- platform_stats (aggregate counters, updated by trigger)
-- ---------------------------------------------------------------------
create table if not exists public.platform_stats (
  id              uuid primary key default uuid_generate_v4(),
  platform        text not null unique,
  total_downloads bigint not null default 0
);

-- =====================================================================
-- Triggers
-- =====================================================================

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, avatar_url)
  values (new.id, new.email, new.raw_user_meta_data ->> 'avatar_url')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Increment platform_stats whenever a completed download is inserted.
create or replace function public.bump_platform_stats()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'completed' then
    insert into public.platform_stats (platform, total_downloads)
    values (new.platform, 1)
    on conflict (platform)
      do update set total_downloads = public.platform_stats.total_downloads + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists on_download_completed on public.downloads;
create trigger on_download_completed
  after insert on public.downloads
  for each row execute function public.bump_platform_stats();

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.profiles       enable row level security;
alter table public.downloads      enable row level security;
alter table public.analytics      enable row level security;
alter table public.traffic_logs   enable row level security;
alter table public.settings       enable row level security;
alter table public.platform_stats enable row level security;

-- Helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- profiles: users manage their own row; admins see all.
drop policy if exists "profiles self select" on public.profiles;
create policy "profiles self select" on public.profiles
  for select using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update" on public.profiles
  for update using (auth.uid() = id);

-- downloads: owners manage their own; admins read all.
drop policy if exists "downloads owner select" on public.downloads;
create policy "downloads owner select" on public.downloads
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "downloads owner insert" on public.downloads;
create policy "downloads owner insert" on public.downloads
  for insert with check (auth.uid() = user_id);

drop policy if exists "downloads owner update" on public.downloads;
create policy "downloads owner update" on public.downloads
  for update using (auth.uid() = user_id);

drop policy if exists "downloads owner delete" on public.downloads;
create policy "downloads owner delete" on public.downloads
  for delete using (auth.uid() = user_id);

-- analytics: insert allowed for everyone (anon events); only admins read.
drop policy if exists "analytics insert" on public.analytics;
create policy "analytics insert" on public.analytics
  for insert with check (true);

drop policy if exists "analytics admin read" on public.analytics;
create policy "analytics admin read" on public.analytics
  for select using (public.is_admin());

-- traffic_logs: admin-only read; insert via service role only (no policy).
drop policy if exists "traffic admin read" on public.traffic_logs;
create policy "traffic admin read" on public.traffic_logs
  for select using (public.is_admin());

-- settings: admin read/write only.
drop policy if exists "settings admin all" on public.settings;
create policy "settings admin all" on public.settings
  for all using (public.is_admin()) with check (public.is_admin());

-- platform_stats: public read (for landing counters), admin write.
drop policy if exists "platform_stats public read" on public.platform_stats;
create policy "platform_stats public read" on public.platform_stats
  for select using (true);

drop policy if exists "platform_stats admin write" on public.platform_stats;
create policy "platform_stats admin write" on public.platform_stats
  for all using (public.is_admin()) with check (public.is_admin());
