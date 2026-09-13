-- ============================================================================
-- 0151 — Frenz AI: every deposit attempt, and the one notification it earns
-- ============================================================================
--
-- Owner, 2026-09-13: "Let users' balance update in a premium fast count
-- animation the way they make a deposit, and they should receive a push
-- notification and an email notification of the successful or failed deposit,
-- with an invoice."
--
-- ── 🔴 TWO FACTS THIS SCHEMA DID NOT HOLD ───────────────────────────────────
--
--   1. A FAILED deposit left no row anywhere. `credit_ai_balance` only runs on
--      success, so a card that was declined on the Paystack page was invisible
--      to us — nothing to notify from, nothing for an invoice to describe.
--      `ai_topup_attempts` records the attempt at initialisation, before the
--      member ever reaches Paystack, and the verify-on-return path writes the
--      outcome onto it.
--
--   2. A SUCCESSFUL deposit is credited by TWO callers — the webhook and the
--      verify-on-return — and the credit is idempotent on the reference, so
--      both callers see "credited". Both would have sent the email. The
--      ledger row exists exactly once per success, so it carries the claim:
--      `notified_at` is set with a conditional UPDATE (`… and notified_at is
--      null`), the same pattern as ai_jobs.notified_at (0148), and only the
--      caller whose UPDATE returned a row sends anything.
--
-- ── Plain DDL only ──────────────────────────────────────────────────────────
--
-- No function, no DO block, no dollar-quote: this project has had a migration
-- apply PARTIALLY when plain DDL followed a dollar-quoted body (0130, fixed in
-- 0131). Everything here is a table, a column, an index and a comment, and
-- every statement is idempotent.
--
-- ── No policies, on purpose ─────────────────────────────────────────────────
--
-- RLS is enabled and no policy is created, so the anon and authenticated roles
-- can neither read nor write these rows; only the service role — the webhook,
-- the verify route and the top-up initialiser — touches them. A member reads
-- their own outcomes through /api/ai/balance, which is already scoped.

alter table public.ai_balance_ledger
  add column if not exists notified_at timestamptz;

comment on column public.ai_balance_ledger.notified_at is
  'When this credit''s single deposit notification (push + email invoice) was claimed. Null means not yet announced. Claimed with a conditional UPDATE (see claimTopupSuccessNotification in lib/ai/topup-attempts.ts) so the webhook and the verify-on-return cannot both announce one deposit.';

create table if not exists public.ai_topup_attempts (
  reference        text primary key,
  user_id          uuid not null references auth.users (id) on delete cascade,
  amount_cents     bigint not null,
  currency         text not null,
  status           text not null default 'pending',
  gateway_response text,
  channel          text,
  paid_at          timestamptz,
  notified_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ai_topup_attempts_amount_chk check (amount_cents > 0),
  constraint ai_topup_attempts_status_chk
    check (status in ('pending', 'success', 'failed', 'abandoned'))
);

create index if not exists ai_topup_attempts_user_created_idx
  on public.ai_topup_attempts (user_id, created_at desc);

alter table public.ai_topup_attempts enable row level security;

comment on table public.ai_topup_attempts is
  'One row per Frenz AI deposit attempt, written at checkout initialisation and updated with the outcome by the verify-on-return. Holds our reference, the amount and currency asked for, the provider''s customer-facing status line (gateway_response) and channel — never a card number, never anything Paystack alone should hold. notified_at is the once-only claim for the FAILED notification; a successful deposit''s claim lives on its ledger row.';
