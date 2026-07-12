-- 0056_security_pin.sql
-- Frenzsave · Premium Messaging V2 Part 11a: app-level quick-lock PIN.
-- Deliberately NOT a client-readable self-owned-row table like
-- privacy_settings/account_security_settings — pin_hash must never be
-- selectable from the browser. RLS is enabled with ZERO policies for
-- authenticated/anon, so only the service-role admin client (used
-- exclusively by /api/v1/app/security/pin* routes) can touch this table.
-- Do not "fix" this to match the self-owned-row idiom.

create table if not exists public.security_pin (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash bytea not null,
  pin_salt bytea not null,
  -- scrypt hashing doesn't preserve length, and PINs are 4-8 digits — stored
  -- so the unlock UI knows when to auto-submit instead of guessing at 4.
  pin_length int not null default 4,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  auto_lock_minutes int not null default 5,
  updated_at timestamptz not null default now()
);

alter table public.security_pin enable row level security;
