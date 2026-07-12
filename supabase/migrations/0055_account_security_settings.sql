-- 0055_account_security_settings.sql
-- Frenzsave · Premium Messaging V2 Part 11a: client-readable per-user
-- security preferences, mirrors the privacy_settings self-owned-row idiom.
-- Recovery-code counters live here (a count + timestamp is not a secret —
-- the codes themselves live in mfa_recovery_codes, locked down separately).

create table if not exists public.account_security_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  require_passkey_for_settings boolean not null default false,
  -- Wired but OFF by default this round — forcing a passkey step-up on
  -- every untrusted-device login would make WebAuthn a semi-mandatory
  -- second factor; that's a bigger product decision than this round.
  require_stepup_on_new_device boolean not null default false,
  recovery_codes_generated_at timestamptz,
  recovery_codes_remaining int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.account_security_settings enable row level security;

drop policy if exists "account_security_settings_select_own" on public.account_security_settings;
create policy "account_security_settings_select_own" on public.account_security_settings
  for select using (auth.uid() = user_id);

drop policy if exists "account_security_settings_upsert_own" on public.account_security_settings;
create policy "account_security_settings_upsert_own" on public.account_security_settings
  for insert with check (auth.uid() = user_id);

drop policy if exists "account_security_settings_update_own" on public.account_security_settings;
create policy "account_security_settings_update_own" on public.account_security_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
