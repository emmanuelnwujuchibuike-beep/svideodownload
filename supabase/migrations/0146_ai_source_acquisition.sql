-- ============================================================================
-- 0146 — Frenz AI Part 6: the server fetches the video
-- ============================================================================
--
-- Owner, 2026-09-09: "Part 6 — Secure Video URL Processing / server-side
-- acquisition."
--
-- Until now the ONLY way a video reached AI Clean was the member's browser
-- PUTting a file to a signed storage ticket. A pasted link ended at an honest
-- "links aren't fetched yet" panel, because fetching an address a visitor chose
-- is a request made from inside our network and needed its own design (see
-- lib/ai/source-url.ts for the allow-list that decides).
--
-- ── 🔴 THE STATUS VOCABULARY GAINS ONE STATE, AND IT IS NOT COSMETIC ────────
--
-- `acquiring` = our worker is fetching and storing the member's video; the
-- provider has not been asked for anything yet.
--
-- The alternative was to reuse `processing` and let the interface guess from
-- metadata. That would make the progress screen say "Removing text" during a
-- yt-dlp download, which is a sentence about work that is not happening — and
-- this feature has a standing rule against exactly that (Part 3: "Analyzing
-- video and Finalizing are NOT observable, so they are never rendered as the
-- current step"). It also matters for money: a job in `processing` has been
-- submitted to a provider and is billable, and a job in `acquiring` has not.
-- Two facts that different should never share one value.
--
-- ── ORDERING (the law this project learned the hard way) ────────────────────
-- Every plain DDL statement comes FIRST; every dollar-quoted block LAST.
-- Migration 0130 applied PARTIALLY because plain DDL sat after a dollar-quoted
-- block and silently did not run, with no error anywhere.
--
-- Idempotent throughout.

-- ---------------------------------------------------------------------
-- 1 · The status CHECK widens
--
-- Dropping and re-adding is the only way to widen a CHECK; both halves are
-- guarded so a re-run is a no-op. Every existing row keeps a status that is
-- still in the list, so nothing is invalidated.
--
-- 🔴 This must be deployed BEFORE any build that can write 'acquiring'. A
-- deploy and a migration are two events and either can land first (0141's
-- lesson) — a build that writes the new value against the old constraint gets
-- a check violation on every URL job, which is why the code treats a URL
-- source as unavailable until it can prove the column accepts it.
-- ---------------------------------------------------------------------
alter table public.ai_jobs drop constraint if exists ai_jobs_status_chk;
alter table public.ai_jobs add constraint ai_jobs_status_chk
  check (status in (
    'queued', 'acquiring', 'processing', 'finalizing', 'completed', 'failed', 'cancelled', 'expired'
  ));

-- ---------------------------------------------------------------------
-- 2 · Where the video came from
--
-- `source_kind` records how the bytes arrived, because from `source_path`
-- alone the two are indistinguishable afterwards — and they fail in completely
-- different ways. An upload that produced nothing is a member whose connection
-- died; an acquisition that produced nothing is a link we could not resolve,
-- which is an operational signal about a platform.
--
-- Defaulted to 'upload' so every one of the existing rows is described
-- correctly rather than left null and guessed at later.
-- ---------------------------------------------------------------------
alter table public.ai_jobs add column if not exists source_kind text not null default 'upload';

alter table public.ai_jobs drop constraint if exists ai_jobs_source_kind_chk;
alter table public.ai_jobs add constraint ai_jobs_source_kind_chk
  check (source_kind in ('upload', 'url'));

comment on column public.ai_jobs.source_kind is
  'How the source video reached us: ''upload'' (the browser PUT it to a signed ticket) or ''url'' (our worker fetched it from a supported platform). Written by the server at creation, never by a client.';

-- ---------------------------------------------------------------------
-- 3 · The link itself
--
-- 🔴 Stored NORMALISED and only ever after `validateAiSourceUrl` accepted it,
-- so this column can never hold an address the worker would refuse to fetch.
-- It is kept for three reasons: the worker re-reads it instead of being sent a
-- URL in a request body (there is no field for one), a retry does not need the
-- member to paste it again, and "which platform is failing today" is otherwise
-- unanswerable.
--
-- Not exposed by `jobToView` — see the allow-list there.
-- ---------------------------------------------------------------------
alter table public.ai_jobs add column if not exists source_url text;

comment on column public.ai_jobs.source_url is
  'The normalised, allow-listed page URL a ''url'' job was created from. NULL for uploads. Never sent to a client and never accepted from one.';

-- ---------------------------------------------------------------------
-- 4 · Finding acquisitions that died
--
-- The same shape as 0142''s stall index. A worker that is killed mid-download
-- leaves a row in `acquiring` with nothing coming, and this is what makes
-- finding those cheap.
-- ---------------------------------------------------------------------
create index if not exists ai_jobs_acquiring_idx
  on public.ai_jobs (created_at)
  where status = 'acquiring';
