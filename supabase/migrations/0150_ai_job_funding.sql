-- ============================================================================
-- 0150 — Frenz AI: how each job was paid for
-- ============================================================================
--
-- Owner, 2026-09-09, standing rule §11/§12: "If free allowance remains: consume
-- one free AI usage… If the free allowance has been exhausted: check AI
-- balance… Release/refund the reservation if the job fails according to the
-- defined failure policy."
--
-- ── 🔴 WHY THIS COLUMN EXISTS AT ALL ────────────────────────────────────────
--
-- A job is funded one of two ways, and UNDOING it is different for each:
--
--   free    → `release_ai_usage` gives back the daily slot
--   balance → `refund_ai_charge` gives back the money
--
-- Four places undo a job — the start route's own failure paths, the finalizer,
-- the reconcile sweep and the stall sweep — and none of them was there when the
-- decision was made. Without this column each would have to GUESS, and both
-- guesses are expensive:
--
--   · calling `release_ai_usage` on a job that was PAID hands back a free daily
--     slot the member never spent. `reserved_jobs` is decremented bounded by
--     `greatest(0, …)`, so on a member with other jobs running today it takes a
--     slot off one of THOSE — a free video, silently created, on every paid
--     failure.
--   · calling `refund_ai_charge` on a FREE job is harmless (it finds no charge
--     and no-ops), which is why the money side is the safe one to call blindly
--     and the usage side is not.
--
-- So the decision is recorded once, by the route that made it, and every later
-- undo reads it instead of inferring it.
--
-- ── `charged_cents` is the audit trail, not the source of truth ─────────────
--
-- The authoritative record of money is `ai_balance_ledger`. This column is what
-- the job row itself can show — the admin's AI overview, the member's usage
-- history — without joining. Null for a free job, which is how "this cost
-- nothing" is stated rather than a 0 that could be mistaken for a bug.
--
-- ── ORDERING (the law this project learned the hard way) ────────────────────
-- Every plain DDL statement comes FIRST; every dollar-quoted block LAST.
-- Migration 0130 applied PARTIALLY because plain DDL sat after a dollar-quoted
-- block, and Postgres reported success for the half it ran.
-- ============================================================================

alter table public.ai_jobs
  add column if not exists funding_source text,
  add column if not exists charged_cents bigint;

-- 🔴 A CHECK rather than an enum: adding a value to a Postgres enum cannot be
-- done inside a transaction with other DDL, which is exactly the shape of
-- migration this project has already had apply halfway.
alter table public.ai_jobs
  drop constraint if exists ai_jobs_funding_source_chk;

alter table public.ai_jobs
  add constraint ai_jobs_funding_source_chk
  check (funding_source is null or funding_source in ('free', 'balance'));

comment on column public.ai_jobs.funding_source is
  'How this job was paid for: ''free'' consumed a daily allowance slot, ''balance'' deducted from ai_balances. Null on rows that predate migration 0150 and on jobs that never started. Read by every failure path to decide whether to release a usage slot or refund money — the two are not interchangeable.';

comment on column public.ai_jobs.charged_cents is
  'What was deducted, in minor units, for display on the job row. Null for a free job. The authoritative money record is ai_balance_ledger.';

-- The admin overview counts paid jobs per day; without this it is a full scan.
create index if not exists ai_jobs_funding_idx
  on public.ai_jobs (funding_source, created_at desc)
  where funding_source is not null;
