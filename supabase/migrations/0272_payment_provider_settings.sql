-- 0272 — Flutterwave configured from the admin dashboard, in a PRIVATE table (2026-10-23)
--
-- Owner: "Admin dashboard should be able to configure the Flutterwave webhook, APIs and all just
-- like the paystack does." Paystack's admin-set keys live in `settings` (key 'paystack'), whose RLS
-- policy is "settings admin all" (0001) — any admin's own browser session can read the stored secret
-- straight from the database API (Part 2.1 finding). Flutterwave's must not repeat that, so its
-- configuration lives here instead:
--
--   · RLS ON with NO policy, and every privilege revoked from anon/authenticated: no browser session,
--     admin included, can read or write a row. Only the server (service role) can.
--   · The admin dashboard writes through /api/admin/flutterwave (admin + fresh password re-auth) and
--     reads back only a mask of each secret — never the value.
--
-- One row per provider (today only 'flutterwave'). `value` holds the secret key, the webhook secret
-- hash and the non-secret capability switches (verified currencies, enabled purposes, amount unit).
-- No member data. Run by hand in the Supabase SQL editor; probe after: select provider, updated_at
-- from payment_provider_settings (as the service role) and, signed in as an admin in the browser,
-- confirm a select returns nothing.

create table if not exists public.payment_provider_settings (
  provider    text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  constraint payment_provider_settings_provider_chk check (provider in ('flutterwave'))
);

alter table public.payment_provider_settings enable row level security;
revoke all on public.payment_provider_settings from public, anon, authenticated;
grant all on public.payment_provider_settings to service_role;

comment on table public.payment_provider_settings is
  'Payment-provider configuration set from the admin dashboard (0272): the Flutterwave secret key, webhook secret hash and capability switches. Service role only — RLS on, no policy, no client grants — unlike `settings`, which admins can read. The admin API returns masks only.';
