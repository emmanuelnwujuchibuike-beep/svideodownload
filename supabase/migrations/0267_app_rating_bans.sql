-- ═══════════════════════════════════════════════════════════════════════════
--  0267 — who rated the app, and banning them (2026-10-22)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-22: "Make admin to see who and all information of who rated the
-- app, admin can ban anonymous users who rate the app, admin can ban signed in
-- users who rate the app. When they're banned, if they want to fetch a post, they
-- see 'You have been banned from this app, contact support if you think this is a
-- mistake.' Take every detail needed from the anonymous user's browser and device
-- so the banning works for anonymous users too."
--
-- 1. app_ratings learns WHO, for a guest: the network address and browser the
--    rating came from, a device id (a random id kept on the device for abuse
--    protection — not analytics), a fingerprint hashed from stable device traits,
--    and the raw traits for the admin to read.
-- 2. app_bans: one row per ban. A ban carries every identifier the rater was seen
--    with; the fetch route (app/api/metadata) refuses a request matching ANY of
--    device id / fingerprint / signed-in user — and the network address only
--    together with the same browser (many mobile users share one address).
--    Lifting a ban stamps lifted_at; the row stays as the record.
--
-- Both tables are server-only: RLS on, no policy for app_bans (only the service
-- role reads or writes it), and app_ratings keeps its "own row" policy.
-- Purely additive: no row is read, moved or rewritten.

alter table public.app_ratings
  add column if not exists device_id   text,
  add column if not exists fingerprint text,
  add column if not exists ip          text,
  add column if not exists user_agent  text,
  add column if not exists device      jsonb;

alter table public.app_ratings drop constraint if exists app_ratings_device_chk;
alter table public.app_ratings add constraint app_ratings_device_chk check (
  (device_id is null or length(device_id) <= 64)
  and (fingerprint is null or length(fingerprint) <= 128)
  and (ip is null or length(ip) <= 64)
  and (user_agent is null or length(user_agent) <= 512)
  and (device is null or pg_column_size(device) <= 4096)
) not valid;
alter table public.app_ratings validate constraint app_ratings_device_chk;

create table if not exists public.app_bans (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users (id) on delete set null,
  device_id    text check (device_id is null or length(device_id) <= 64),
  fingerprint  text check (fingerprint is null or length(fingerprint) <= 128),
  ip           text check (ip is null or length(ip) <= 64),
  user_agent   text check (user_agent is null or length(user_agent) <= 512),
  rating_id    uuid references public.app_ratings (id) on delete set null,
  reason       text check (reason is null or length(reason) <= 500),
  banned_by    uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  lifted_at    timestamptz,
  lifted_by    uuid references auth.users (id) on delete set null,
  constraint app_bans_identifies_chk check (user_id is not null or device_id is not null or fingerprint is not null or ip is not null)
);

create index if not exists app_bans_active_idx on public.app_bans (created_at desc) where lifted_at is null;
create index if not exists app_bans_rating_idx on public.app_bans (rating_id);

alter table public.app_bans enable row level security;
-- no policy: the service role only (admin routes and the fetch check)
