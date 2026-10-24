-- 0271 — Flutterwave as a payment provider (Part 2 of the Flutterwave integration, 2026-10-23)
--
-- Owner: Flutterwave is the primary rail (USD), Paystack the backup (NGN). No new ledger and no
-- new table: Flutterwave payments use the existing attempt ledger (ai_topup_attempts), the
-- existing webhook log (payment_provider_events), and the existing per-product settlement
-- (credit_product_balance, settle_sub_purchase, ad_payment_settle, the verification grant).
--
-- What this changes, all additive:
--   1. ai_topup_attempts_provider_chk        ('paystack','bachs')            → + 'flutterwave'
--   2. payment_provider_events_provider_chk  ('paystack','bachs')            → + 'flutterwave'
--   3. ad_campaigns_method_chk               ('credits','paystack','bachs')  → + 'flutterwave'
--   4. verification_purchases.provider       new, NOT NULL DEFAULT 'paystack' (every existing row
--                                            was a Paystack checkout), checked like the others.
--
-- 'bachs' stays allowed in every check: its rows are financial history (docs/PAYMENTS.md
-- "Bachs removed") and must remain valid. No row is rewritten; nothing is dropped; RLS and
-- grants are untouched (all four objects stay service-role only / as they were).
--
-- Lock-friendly: each widened check is added NOT VALID and then validated, the pattern of
-- 0168/0178, so the table is not held under an exclusive lock while existing rows are checked.
--
-- Run by hand in the Supabase SQL editor (production migrations are applied manually). Probe
-- after: insert-and-rollback a provider='flutterwave' row in each table, or read
-- pg_get_constraintdef for the three constraints and verification_purchases.provider.

-- ── 1. the attempt ledger ────────────────────────────────────────────────────
alter table public.ai_topup_attempts drop constraint if exists ai_topup_attempts_provider_chk;
alter table public.ai_topup_attempts
  add constraint ai_topup_attempts_provider_chk check (provider in ('paystack', 'flutterwave', 'bachs')) not valid;
alter table public.ai_topup_attempts validate constraint ai_topup_attempts_provider_chk;
comment on column public.ai_topup_attempts.provider is 'Which payment provider took this attempt: paystack | flutterwave (0271) | bachs (removed 2026-10-17, history only).';

-- ── 2. the webhook delivery log ─────────────────────────────────────────────
alter table public.payment_provider_events drop constraint if exists payment_provider_events_provider_chk;
alter table public.payment_provider_events
  add constraint payment_provider_events_provider_chk check (provider in ('paystack', 'flutterwave', 'bachs')) not valid;
alter table public.payment_provider_events validate constraint payment_provider_events_provider_chk;

-- ── 3. how an ad campaign was paid ──────────────────────────────────────────
alter table public.ad_campaigns drop constraint if exists ad_campaigns_method_chk;
alter table public.ad_campaigns
  add constraint ad_campaigns_method_chk check (payment_method is null or payment_method in ('credits', 'paystack', 'flutterwave', 'bachs')) not valid;
alter table public.ad_campaigns validate constraint ad_campaigns_method_chk;

-- ── 4. which provider took a paid-verification checkout ─────────────────────
alter table public.verification_purchases add column if not exists provider text not null default 'paystack';
alter table public.verification_purchases drop constraint if exists verification_purchases_provider_chk;
alter table public.verification_purchases
  add constraint verification_purchases_provider_chk check (provider in ('paystack', 'flutterwave')) not valid;
alter table public.verification_purchases validate constraint verification_purchases_provider_chk;
comment on column public.verification_purchases.provider is 'Which payment provider took this checkout (0271): paystack | flutterwave. Settlement and reversal ask that provider only.';
