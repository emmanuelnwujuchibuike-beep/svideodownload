-- ═══════════════════════════════════════════════════════════════════════════
--  0178 — Kling as a provider VALUE: the two CHECK constraints, widened
--         (2026-09-28, the provider migration Part 2)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The owner's Part 2 brief: build the direct Kling 3.0 Omni seam alongside
-- Replicate and fal.ai, route no feature to it yet, and prepare the database
-- BEFORE any code path can create a Kling row.
--
-- ── 🔴 WHY THIS MIGRATION COMES FIRST, AND ALONE ────────────────────────────
--
-- The Part 1 audit (docs/AI_PROVIDER_MIGRATION_PART1_AUDIT.md, §N risk 1)
-- found the failure this file exists to prevent:
--
--     /start reserves the member's money (reserve_product_charge) BEFORE the
--     provider is stamped on the row. A provider value the database refuses
--     therefore fails AFTER the charge — a charged member with no job.
--
-- So the constraint is widened in its own migration, deployed on its own, and
-- nothing in Part 2 writes `provider = 'kling'` at all: the adapter's
-- `supports()` answers false for every feature, so no submission can reach a
-- provider stamp. The database is ready first and stays ready; Part 3 turns
-- the first feature on against a schema that has already accepted the value
-- in production for a release.
--
-- ── What changes ────────────────────────────────────────────────────────────
--
--   ai_provider_runs_provider_chk   ('replicate','fal','elevenlabs')
--                                 → ('replicate','fal','elevenlabs','kling')
--   ai_jobs_provider_chk            ('replicate','fal')
--                                 → ('replicate','fal','kling')
--
-- ── What deliberately does NOT change ───────────────────────────────────────
--
--   · `ai_jobs.replicate_prediction_id` keeps its name, its type and its
--     UNIQUE index. The Part 1 audit found it is MISNAMED but provider-
--     NEUTRAL — the fal adapter already stores its request id there, and that
--     unique index is the shared idempotency key that stops a duplicate
--     callback double-charging, double-refunding or re-announcing a job.
--     Kling's task id goes in the same column for the same reason. A rename
--     is a separate, dedicated migration with its own code sweep; doing it
--     here would put the migration that protects money in the same deploy as
--     a rename that touches every provider path. Not worth it, not now.
--   · no data is read, written, moved or deleted;
--   · no column is added, dropped or retyped;
--   · no function, index, policy or grant is touched.
--
-- Widening a CHECK is purely permissive: every existing row satisfying the old
-- predicate satisfies the new one, so 'replicate', 'fal' and 'elevenlabs' rows
-- stay valid and no history is invalidated. Rolling back means narrowing the
-- predicate again, which is safe only while no 'kling' row exists — true for
-- the whole of Part 2 by construction.
--
-- ── 🔴 ORDER (the 0167 lesson, repeated by 0168) ────────────────────────────
-- The migration runner and an open SQL-editor session once took locks on
-- ai_jobs in opposite orders and deadlocked (40P01). So: the SMALLER table
-- first, ai_jobs LAST, each constraint added `not valid` (a short lock) and
-- validated in its own statement (a share lock, no table rewrite). Nothing
-- here is pasted by hand — the runner applies it on push.

-- ── 1. the provider-run ledger (0168) ───────────────────────────────────────
alter table public.ai_provider_runs drop constraint if exists ai_provider_runs_provider_chk;
alter table public.ai_provider_runs
  add constraint ai_provider_runs_provider_chk check (provider in ('replicate', 'fal', 'elevenlabs', 'kling')) not valid;
alter table public.ai_provider_runs validate constraint ai_provider_runs_provider_chk;

-- ── 2. LAST: the provider check on ai_jobs, lock-friendly ───────────────────
alter table public.ai_jobs drop constraint if exists ai_jobs_provider_chk;
alter table public.ai_jobs
  add constraint ai_jobs_provider_chk check (provider in ('replicate', 'fal', 'kling')) not valid;
alter table public.ai_jobs validate constraint ai_jobs_provider_chk;
