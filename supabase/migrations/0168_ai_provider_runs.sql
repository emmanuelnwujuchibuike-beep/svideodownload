-- ═══════════════════════════════════════════════════════════════════════════
--  0168 — fal.ai as a SECOND provider: the provider-run ledger, the wider
--         provider check on ai_jobs (2026-09-21)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The fal.ai brief: Replicate stays exactly as it is; fal.ai (Kling O1 Video
-- Edit for Character Replace, Sync-3 for Lip Sync) is chosen per feature by
-- the operator; ElevenLabs stays the only voice provider. Every job keeps the
-- provider it was started on, for ever.
--
-- ── What this file adds ──────────────────────────────────────────────────────
--
--   ai_provider_runs   ONE row per provider submission — a job's replace
--                      stage, its lip-sync stage, an admin's connection test.
--                      Provider economics (§19: estimate vs actual, never one
--                      shown as the other), the comparison dashboard (§20:
--                      jobs · success · failure · timings · cost per
--                      feature/provider/model), provider health (§26: last
--                      success / last failure / the recent error) all read
--                      from here. The job row keeps what it always kept
--                      (provider, model, model_version, replicate_prediction_id
--                      — the provider's own id whatever the provider — status,
--                      timestamps, error_code); this table is the per-run
--                      record behind it, never a second job system (§25).
--
--   ai_jobs_provider_chk   widened from ('replicate') to ('replicate','fal').
--
-- ── 🔴 ORDER (the 0167 lesson) ───────────────────────────────────────────────
-- The migration runner and an open SQL-editor session took locks on ai_jobs in
-- opposite orders and deadlocked (40P01) on 09-21. So: the NEW table first, and
-- the ai_jobs constraint LAST, added `not valid` (a short lock) and validated
-- in its own statement (a share lock, no rewrite). Nothing here is pasted by
-- hand — the runner applies it on push.

-- ── 1. the provider-run ledger ───────────────────────────────────────────────
create table if not exists public.ai_provider_runs (
  id                     uuid primary key default gen_random_uuid(),
  -- null for an admin connection test (§27), which has no job
  job_id                 uuid references public.ai_jobs (id) on delete set null,
  user_id                uuid,
  feature                text not null,
  mode                   text,
  stage                  text,
  provider               text not null,
  model                  text not null,
  model_version          text,
  -- the provider's own id: a Replicate prediction id, a fal request id
  provider_job_id        text,
  status                 text not null default 'submitted',
  -- an admin test, or a job an admin created in test mode — never a member's spend
  test                   boolean not null default false,
  submitted_at           timestamptz not null default now(),
  started_at             timestamptz,
  completed_at           timestamptz,
  -- how long the SUBMIT round trip took, for the health panel
  latency_ms             integer,
  -- the input the provider was asked to process
  input_duration_ms      integer,
  input_resolution       text,
  -- §19: the operator's estimate at submission, and the actual figure only when a provider reports one
  cost_estimate_usd_cents numeric(12, 4),
  cost_actual_usd_cents   numeric(12, 4),
  cost_currency          text not null default 'USD',
  error_code             text,
  error_detail           text,
  output_ref             text,
  metadata               jsonb not null default '{}'::jsonb,
  constraint ai_provider_runs_provider_chk check (provider in ('replicate', 'fal', 'elevenlabs')),
  constraint ai_provider_runs_status_chk check (status in ('submitted', 'processing', 'succeeded', 'failed', 'cancelled', 'timeout'))
);

create index if not exists ai_provider_runs_provider_feature_idx
  on public.ai_provider_runs (provider, feature, submitted_at desc);
create index if not exists ai_provider_runs_job_idx
  on public.ai_provider_runs (job_id)
  where job_id is not null;
-- one row per provider request: a duplicate webhook or a re-run of the recorder never doubles a run
create unique index if not exists ai_provider_runs_provider_job_uidx
  on public.ai_provider_runs (provider, provider_job_id)
  where provider_job_id is not null;

-- Service role only: this is the operator's ledger (costs, provider ids, error
-- detail). No policy = no browser read, exactly like ai_job_events.
alter table public.ai_provider_runs enable row level security;
revoke all on public.ai_provider_runs from public, anon, authenticated;
grant all on public.ai_provider_runs to service_role;

-- ── 2. LAST: the provider check on ai_jobs, lock-friendly ────────────────────
alter table public.ai_jobs drop constraint if exists ai_jobs_provider_chk;
alter table public.ai_jobs
  add constraint ai_jobs_provider_chk check (provider in ('replicate', 'fal')) not valid;
alter table public.ai_jobs validate constraint ai_jobs_provider_chk;
