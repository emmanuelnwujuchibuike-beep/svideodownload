-- 0057_mfa_recovery_codes.sql
-- Frenzsave · Premium Messaging V2 Part 11a: MFA recovery codes. Service-
-- role-only, same lockdown as security_pin — code_hash must never be
-- selectable from the browser (HMAC output isn't secret-strength on its
-- own the way a password hash needs to be, but there's no reason to widen
-- the attack surface either).

create table if not exists public.mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists mfa_recovery_codes_user_idx
  on public.mfa_recovery_codes (user_id) where used_at is null;

alter table public.mfa_recovery_codes enable row level security;
