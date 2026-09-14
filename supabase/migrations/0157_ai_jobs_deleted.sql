-- 0157 · A member can DELETE a finished AI job (Part 7, §20).
--
-- `deleted` is a terminal status of its own — distinct from `expired`, which
-- the retention sweep writes when the files aged out — so the result screen
-- can say "This video has been deleted" rather than "no longer available",
-- and history can leave the row out of every tab while the ROW itself stays:
-- the ledger references it (`ai_product_ledger.job_id`), the audit events
-- reference it, and the financial record must remain auditable (§20).
--
-- Files are removed by the delete route (the result, the poster, the whole
-- source folder); the paths are cleared in the same update, exactly as the
-- retention sweep clears them. Plain DDL, no dollar-quoted body (the 0130
-- lesson) — mirrored in lib/ai/jobs.ts `AiJobStatus`.

alter table public.ai_jobs drop constraint if exists ai_jobs_status_chk;
alter table public.ai_jobs add constraint ai_jobs_status_chk
  check (status in (
    'queued', 'acquiring', 'processing', 'finalizing', 'completed', 'failed', 'cancelled', 'expired', 'deleted'
  ));

comment on constraint ai_jobs_status_chk on public.ai_jobs is
  'Mirrors lib/ai/jobs.ts AiJobStatus. `deleted` (0157) = the member removed the result; files gone, row kept for the ledger.';
