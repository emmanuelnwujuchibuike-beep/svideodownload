-- ============================================================================
-- 0142 — Frenz AI Part 4: finalization (the audio goes back on)
-- ============================================================================
--
-- Owner, 2026-09-07: the AI model returns video WITHOUT the original audio, so
-- a cleaned clip has to be muxed back together with the sound from the source
-- before it is anything a person would want. That is a second processing stage,
-- and this migration is the smallest schema that can describe it honestly.
--
-- Four changes, each earning its place:
--
--   1. `finalizing` joins the status vocabulary. It is a real, distinct state —
--      the provider is done and our own worker is running — and it is what lets
--      the interface say "restoring your audio" instead of leaving somebody on
--      "removing text" for a minute after the AI has finished.
--   2. `audio_restored` records whether sound actually made it onto the result.
--      A source with no audio track is a legitimate success, so "no audio" and
--      "audio failed" must not look the same afterwards.
--   3. `result_duration` — measured off the FINAL file. The one number that
--      proves the mux produced something whole rather than a truncated stream.
--   4. `result_mime_type` — what was actually stored, for the download.
--
-- Deliberately NOT added: `finalized_at`. `completed_at` is already written at
-- exactly that moment, and a second timestamp meaning the same thing is a
-- future disagreement waiting to happen.
--
-- 🔴 ORDERING: plain DDL only in this file, so the 0130 partial-apply trap
-- (plain DDL after a dollar-quoted block silently not running) cannot arise.
--
-- Idempotent throughout.

-- ---------------------------------------------------------------------
-- 1 · The status vocabulary gains one state
--
-- Dropping and re-adding is the only way to widen a CHECK; both halves are
-- guarded so a re-run is a no-op. Every existing row keeps a status that is
-- still in the list, so nothing is invalidated by this.
-- ---------------------------------------------------------------------
alter table public.ai_jobs drop constraint if exists ai_jobs_status_chk;
alter table public.ai_jobs add constraint ai_jobs_status_chk
  check (status in ('queued', 'processing', 'finalizing', 'completed', 'failed', 'cancelled', 'expired'));

-- ---------------------------------------------------------------------
-- 2 · What finalization produced
-- ---------------------------------------------------------------------
alter table public.ai_jobs add column if not exists audio_restored   boolean;
alter table public.ai_jobs add column if not exists result_duration  numeric(10, 3);
alter table public.ai_jobs add column if not exists result_mime_type text;

comment on column public.ai_jobs.audio_restored is
  'Did the original audio end up on the final file? NULL = not finalized yet. FALSE with a completed job means the source genuinely had no audio track — which is a success, not a failure.';
comment on column public.ai_jobs.result_duration is
  'Seconds, measured off the FINAL file with ffprobe. Compared against the source to prove the mux produced a whole video rather than a truncated one.';
comment on column public.ai_jobs.result_mime_type is
  'What was actually stored. Written by the finalizer, never by a client.';

-- ---------------------------------------------------------------------
-- 3 · Finding work that stalled
--
-- A finalization that dies mid-run (a worker restart, an OOM) leaves a row in
-- `finalizing` with nothing coming to move it. This is the index the recovery
-- sweep reads: partial, so it stays the size of the backlog — which is almost
-- always zero — rather than the size of the table.
-- ---------------------------------------------------------------------
create index if not exists ai_jobs_finalizing_idx
  on public.ai_jobs (started_at)
  where status = 'finalizing';
