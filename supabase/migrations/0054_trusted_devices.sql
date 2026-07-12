-- 0054_trusted_devices.sql
-- Frenzsave · Premium Messaging V2 Part 11a: device naming + "trusted device"
-- concept layered on top of Supabase's own auth.sessions (which we never
-- alter — see 0034's comment on why). current_session_id is a deliberately
-- unconstrained, best-effort pointer (no FK): Supabase owns auth.sessions'
-- lifecycle and an FK here could fail/cascade in ways we don't control.
--
-- Correlated to a physical browser via a long-lived httpOnly `device_key`
-- cookie (minted once, survives sign-out/sign-in) rather than the session
-- id alone, so "trust" a user grants a device survives their next login.

create table if not exists public.trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_key text not null,
  current_session_id uuid,
  label text not null,
  is_trusted boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_user_agent text,
  unique (user_id, device_key)
);

create index if not exists trusted_devices_session_idx
  on public.trusted_devices (user_id, current_session_id);

alter table public.trusted_devices enable row level security;

-- No secrets on this row (label + a boolean) — client-direct access is fine,
-- same idiom as privacy_settings. Only label/is_trusted are ever updated by
-- the client; device_key/current_session_id are server-only writes (the
-- device-check route uses the admin client), enforced by only exposing a
-- narrow PATCH endpoint rather than relying on column-level grants here.
drop policy if exists "trusted_devices_select_own" on public.trusted_devices;
create policy "trusted_devices_select_own" on public.trusted_devices
  for select using (auth.uid() = user_id);

drop policy if exists "trusted_devices_update_own" on public.trusted_devices;
create policy "trusted_devices_update_own" on public.trusted_devices
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "trusted_devices_delete_own" on public.trusted_devices;
create policy "trusted_devices_delete_own" on public.trusted_devices
  for delete using (auth.uid() = user_id);
