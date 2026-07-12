-- 0058_webauthn_credentials.sql
-- Frenzsave · Premium Messaging V2 Part 11a: WebAuthn passkeys used as a
-- step-up verification gate (NOT a primary-login replacement — Supabase
-- Auth has no native WebAuthn factor type, and minting a session from a
-- custom-verified WebAuthn assertion would need a risky bespoke
-- session-issuance path). public_key/counter must never be exposed to the
-- client — routes select an explicit column list, never `select *`.

create table if not exists public.webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  credential_id text not null unique,
  public_key bytea not null,
  counter bigint not null default 0,
  device_type text,
  backed_up boolean not null default false,
  transports text[],
  label text not null default 'Passkey',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.webauthn_credentials enable row level security;

-- Own-row select is fine for label/metadata display, but application code
-- must select an explicit column list (id, label, device_type, backed_up,
-- created_at, last_used_at) — never public_key/counter — when rendering to
-- the client, since RLS alone doesn't hide individual columns.
drop policy if exists "webauthn_credentials_select_own" on public.webauthn_credentials;
create policy "webauthn_credentials_select_own" on public.webauthn_credentials
  for select using (auth.uid() = user_id);

drop policy if exists "webauthn_credentials_update_own" on public.webauthn_credentials;
create policy "webauthn_credentials_update_own" on public.webauthn_credentials
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "webauthn_credentials_delete_own" on public.webauthn_credentials;
create policy "webauthn_credentials_delete_own" on public.webauthn_credentials
  for delete using (auth.uid() = user_id);

-- Ephemeral, server-only challenge store for registration + step-up
-- ceremonies. Zero authenticated policies — only the admin client (used
-- exclusively by the passkey API routes) reads/writes this table.
create table if not exists public.webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge text not null,
  purpose text not null check (purpose in ('registration', 'stepup')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 minutes')
);

alter table public.webauthn_challenges enable row level security;
