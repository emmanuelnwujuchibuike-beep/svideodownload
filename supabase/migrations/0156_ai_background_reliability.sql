-- ═══════════════════════════════════════════════════════════════════════════
--  0156 — BACKGROUND RELIABILITY: a finalization that can be retried, and an
--          audit trail of everything that happens to a job while nobody watches
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Character Replace, Part 5 (owner, 2026-09-14): "Processing must not depend on
-- the browser… If storage upload fails after provider success: do NOT tell the
-- user the video is complete; keep provider success info; retry finalization;
-- only notify success after the result is safely stored… Never overwrite
-- history."
--
-- ── 1 · The finalization lease ──────────────────────────────────────────────
-- Before this, the finalizer claimed `processing → finalizing` once, and any
-- failure after that — a storage hiccup, a worker restart — ended the job and
-- refunded it, even though the provider's output was sitting there, paid for.
-- Three columns make the stage re-runnable WITHOUT a second queue:
--
--   finalize_attempts     how many times a finalizer has claimed this job
--   finalize_lease_until  while in the future, one finalizer owns the job; a
--                         retry may only claim once it has passed (a crashed
--                         worker releases its job by doing nothing)
--   finalize_next_at      the earliest a retry may run (exponential backoff)
--   finalize_error        the last transient failure, operator-facing
--
-- The claim is a compare-and-set UPDATE in lib/ai/job-store.ts
-- (`claimFinalization`): `status in (processing, finalizing)` AND the lease
-- has expired AND attempts equals the value just read. Two workers racing for
-- one job: one row matches, the other matches nothing. No advisory lock, no
-- SQL function — the same discipline as `transitionJob`.
--
-- ── 2 · The audit log ───────────────────────────────────────────────────────
-- `ai_job_events` is append-only: one row per background event — a webhook
-- received (or ignored), a finalization started / retried / given up, a push
-- sent / handed off / left pending, a refund, a reconciliation, an operator's
-- recovery action. It answers "what happened to this job while nobody was
-- looking" without anyone reading Vercel logs, and it is what the admin
-- monitor shows under a job. Service role only: no member policy, because the
-- detail column carries provider ids and operator ids that are not the
-- member's to read; the member's own record is the job row.
--
-- ── ORDERING ────────────────────────────────────────────────────────────────
-- Plain DDL only. No dollar-quoted block anywhere in this file (0130 applied
-- partially because DDL sat after one).

alter table public.ai_jobs
  add column if not exists finalize_attempts integer not null default 0;
alter table public.ai_jobs
  add column if not exists finalize_lease_until timestamptz;
alter table public.ai_jobs
  add column if not exists finalize_next_at timestamptz;
alter table public.ai_jobs
  add column if not exists finalize_error text;

comment on column public.ai_jobs.finalize_attempts is
  'How many times a finalizer has claimed this job (0156). Bounded by the finalizer: past the ceiling the job fails and refunds instead of retrying.';
comment on column public.ai_jobs.finalize_lease_until is
  'While in the future, exactly one finalizer owns this job. A retry may claim only once it has passed, so a crashed worker releases its job by doing nothing (0156).';
comment on column public.ai_jobs.finalize_next_at is
  'The earliest a finalization retry may run — exponential backoff after a transient failure (0156). Null when no retry is scheduled.';
comment on column public.ai_jobs.finalize_error is
  'The last TRANSIENT finalization failure (storage, download), operator-facing. Cleared on success; the terminal error lives in error_code/error_message (0156).';

-- The reconciliation sweep reads exactly the rows that may need a hand:
-- provider-side work (processing) and retryable finalizations. Partial, so it
-- stays the size of the live backlog rather than the table.
create index if not exists ai_jobs_recovery_idx
  on public.ai_jobs (finalize_next_at, started_at)
  where status in ('processing', 'finalizing');

create table if not exists public.ai_job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.ai_jobs (id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  actor text not null default 'system',
  detail jsonb not null default '{}'::jsonb,
  constraint ai_job_events_kind_chk check (char_length(kind) between 1 and 64),
  constraint ai_job_events_actor_chk check (char_length(actor) between 1 and 80)
);

comment on table public.ai_job_events is
  'Append-only audit trail of background events on an AI job (0156): webhooks, finalization attempts, notifications, refunds, reconciliation, operator recovery actions. Service role only; the member''s own record is the ai_jobs row.';

create index if not exists ai_job_events_job_at_idx
  on public.ai_job_events (job_id, at desc);

alter table public.ai_job_events enable row level security;
-- No policies on purpose: nothing but the service role reads or writes it.
revoke all on table public.ai_job_events from anon, authenticated;
