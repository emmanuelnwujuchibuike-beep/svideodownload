-- ============================================================================
-- 0148 — Frenz AI: a job is announced exactly once
-- ============================================================================
--
-- Owner, 2026-09-09: "Implement notification deduplication. A single AI job
-- should normally produce at most 1 completion notification OR 1 failure
-- notification. Never repeatedly notify because… the webhook was delivered more
-- than once."
--
-- ── 🔴 FOUR PLACES CAN ANNOUNCE ONE JOB ─────────────────────────────────────
--
--   server/services/ai-finalize-service.ts  → finished, and failed
--   lib/ai/reconcile.ts                     → failed
--   lib/ai/stall-server.ts                  → failed
--
-- Those are not alternatives, they are overlapping safety nets, and that is the
-- point of them: a job the webhook never reported is caught by reconcile, and
-- one that stalled mid-flight is caught by the deadline sweep. Each is correct
-- on its own. Together they can announce the same dead job twice — the stall
-- guard writes `failed` and pushes, and the next reconcile pass finds the same
-- row and pushes again.
--
-- Nothing about the STATE transition allows that twice; `transitionJob` is a
-- compare-and-set and the second caller matches nothing. But the notification
-- is sent BESIDE that transition, by callers that each believe they are the one
-- reporting it. So the claim has to be on a column of its own.
--
-- ── Why a timestamp rather than a boolean ───────────────────────────────────
--
-- `notified_at is null` is exactly as good a claim predicate as `notified =
-- false`, and the timestamp additionally answers "when did the member hear
-- about this?" — which is the question asked when somebody says the push
-- arrived late, or never. A boolean can only ever say that it happened.
--
-- ── Nullable, and null means "not yet" ──────────────────────────────────────
--
-- Every existing row has already been announced or never will be. Backfilling
-- them to `now()` would claim we notified somebody at the moment of a migration,
-- which is false; leaving them null risks re-announcing a job that is already
-- terminal. Neither matters: the notifiers only run on a transition they
-- themselves just made, and no sweep looks at rows this old.
--
-- ── ORDERING (the law this project learned the hard way) ────────────────────
-- Every plain DDL statement comes FIRST; every dollar-quoted block LAST.
-- Migration 0130 applied PARTIALLY because plain DDL sat after a dollar-quoted
-- block, and Postgres reported success for the half it ran.
-- ============================================================================

alter table public.ai_jobs
  add column if not exists notified_at timestamptz;

comment on column public.ai_jobs.notified_at is
  'When this job''s single completion/failure notification was claimed. Null means not yet announced. Claimed with a conditional UPDATE (see claimAiNotification in lib/ai/job-store.ts) so duplicate webhook deliveries and overlapping safety-net sweeps cannot announce one job twice.';
