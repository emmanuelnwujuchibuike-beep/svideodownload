-- ============================================================================
-- 0147 — Frenz AI: a still frame for every finished video
-- ============================================================================
--
-- Owner, 2026-09-09, with a screenshot of both pages side by side: "This is the
-- Download history page and the AI history page, they look very different, I
-- want the AI history to be like that Download history."
--
-- ── 🔴 THE DIFFERENCE WAS NEVER THE LAYOUT ──────────────────────────────────
--
-- Both pages were already a grid of square, rounded tiles in day sections. What
-- the screenshots actually show is that download tiles are PHOTOGRAPHS and AI
-- tiles were coloured plates: on one page you recognise your video, on the
-- other you read a filename. No amount of restyling a gradient closes that,
-- because the missing thing is an image.
--
-- The reason there was no image was cost, and that reasoning was sound as far
-- as it went: a private result can only be read through a signed URL, and
-- decoding a frame per tile in the browser to draw a poster would warm the
-- phone of somebody who came here to press one button.
--
-- But those are not the only two options. The worker already has the finished
-- file on local disk and an ffmpeg binary in its hand, one step after it has
-- validated it — so a ~25 KB JPEG costs one extra frame decode ONCE, on a
-- machine that has just decoded the whole video, instead of once per tile per
-- visit on a phone. This column is where that frame is kept.
--
-- ── Nullable, and permanently so ────────────────────────────────────────────
--
-- Every row that predates this migration has no poster and never will: the
-- source is deleted within the hour by the retention sweep and the result is
-- gone in three days, so there is nothing to backfill from. The interface has
-- to render a tile without an image anyway — for those rows, for a job still
-- running, and for the poster step failing (which must never fail the job) —
-- so "no poster" is an ordinary state rather than an error, and the gradient
-- plate stays as its fallback.
--
-- ── ORDERING (the law this project learned the hard way) ────────────────────
-- Every plain DDL statement comes FIRST; every dollar-quoted block LAST.
-- Migration 0130 applied PARTIALLY because plain DDL sat after a dollar-quoted
-- block, and Postgres reported success for the half it ran.
-- ============================================================================

alter table public.ai_jobs
  add column if not exists poster_path text;

comment on column public.ai_jobs.poster_path is
  'Object key of the result poster JPEG in the private ai-results bucket. Null when the job has not finished, when the poster step failed (never fatal), or when the row predates migration 0147. Deleted by the retention sweep alongside the result.';
