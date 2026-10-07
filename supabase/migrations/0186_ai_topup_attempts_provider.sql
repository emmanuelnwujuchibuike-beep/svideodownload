-- ═══════════════════════════════════════════════════════════════════════════
--  0186 — A TOP-UP REMEMBERS WHO TOOK IT AND WHAT IT BOUGHT (2026-10-07)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-07: add Bachs (bachs.io) beside Paystack; the admin picks
-- which takes top-ups. A Bachs checkout session can only be created with our
-- SECRET key, so the attempt row written when we create it is the authority
-- for what the payment buys: the provider, the provider's own checkout id
-- (for verify-on-return), the pack or plan and its size. The signed webhook
-- proves it was paid; this row says what it was for.
--
-- It is now the one PAYMENT-ATTEMPT ledger for both rails and both purposes
-- (a credit pack, an AI plan): `purpose` says which.
--
-- Additive and nullable: every existing (Paystack) row stays as it is.

alter table public.ai_topup_attempts add column if not exists provider text not null default 'paystack';
alter table public.ai_topup_attempts add column if not exists external_id text;
alter table public.ai_topup_attempts add column if not exists purpose text not null default 'wallet_topup';
-- what was bought: a credit pack id (pack_100) or an AI plan id (ai_pro / ai_max)
alter table public.ai_topup_attempts add column if not exists item_id text;
alter table public.ai_topup_attempts add column if not exists credits integer;

alter table public.ai_topup_attempts drop constraint if exists ai_topup_attempts_purpose_chk;
alter table public.ai_topup_attempts add constraint ai_topup_attempts_purpose_chk check (purpose in ('wallet_topup', 'ai_subscription'));

alter table public.ai_topup_attempts drop constraint if exists ai_topup_attempts_provider_chk;
alter table public.ai_topup_attempts add constraint ai_topup_attempts_provider_chk check (provider in ('paystack', 'bachs'));

create index if not exists ai_topup_attempts_external_idx on public.ai_topup_attempts (provider, external_id) where external_id is not null;

comment on column public.ai_topup_attempts.amount_cents is 'What the member was asked to pay, in the list currency (USD cents since 0184).';
comment on column public.ai_topup_attempts.provider is 'Which payment provider took this top-up (0186): paystack | bachs.';
comment on column public.ai_topup_attempts.external_id is 'The provider''s own id for the checkout (Bachs: chk_…), for verify-on-return.';
comment on column public.ai_topup_attempts.credits is 'The credits this top-up was priced for (0184); what is credited is still derived from the verified amount.';
comment on column public.ai_topup_attempts.purpose is 'What the payment is for (0186): wallet_topup (a credit pack) | ai_subscription (an AI plan).';

-- ── every provider webhook delivery, once (credit/payment brief Phase 9) ───────
-- Bachs delivers at least once. The business operations are already
-- idempotent (a credit per reference, a subscription per last_reference); this
-- is the record that a delivery arrived, was verified and was processed — and
-- the place a redelivery is recognised and acknowledged without work.
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
comment on table public.payment_provider_events is 'One row per verified payment-provider webhook delivery (0186): provider + event id unique. Service role only; holds ids and outcomes, never card data.';
