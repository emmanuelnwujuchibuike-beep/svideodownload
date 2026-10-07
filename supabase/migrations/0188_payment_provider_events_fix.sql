-- ═══════════════════════════════════════════════════════════════════════════
--  0188 — the part of 0186 that never ran (2026-10-07)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Probed on production after the push: 0186's columns on ai_topup_attempts
-- exist, its `payment_provider_events` table does not. 0186 has no
-- dollar-quoted block, but one of its COMMENT strings contains a semicolon
-- ("… (0184); what is credited …"), and everything after that statement was
-- skipped — the runner evidently splits on ";" without regard to quotes. The
-- 0130 lesson in another form: a statement boundary the runner disagrees with.
--
-- This restates the skipped tail. Every string here is free of semicolons.
-- Idempotent (if not exists / drop if exists), so it is safe whatever 0186 did.

comment on column public.ai_topup_attempts.credits is 'The credits this top-up was priced for (0184) - what is credited is still derived from the verified amount.';
comment on column public.ai_topup_attempts.purpose is 'What the payment is for (0186): wallet_topup (a credit pack) or ai_subscription (an AI plan).';

create table if not exists public.payment_provider_events (
  provider      text not null,
  event_id      text not null,
  event_type    text not null,
  reference     text,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  outcome       text,
  primary key (provider, event_id),
  constraint payment_provider_events_provider_chk check (provider in ('paystack', 'bachs'))
);
create index if not exists payment_provider_events_reference_idx on public.payment_provider_events (reference) where reference is not null;
alter table public.payment_provider_events enable row level security;
revoke all on public.payment_provider_events from public, anon, authenticated;
grant all on public.payment_provider_events to service_role;
comment on table public.payment_provider_events is 'One row per verified payment-provider webhook delivery (0186/0188): provider + event id unique. Service role only. Holds ids and outcomes, never card data.';
