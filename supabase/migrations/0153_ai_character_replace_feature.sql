-- 0153 · Character Replace becomes a feature the job system can store.
--
-- Owner, 2026-09-13 (Part 1): AI Clean is removed as a product and Character
-- Replace (Wan 2.2) is the first — and only — Frenz AI tool. Part 1 builds the
-- interface and the configuration boundary; no job is created for it yet.
-- This migration is the one prerequisite Part 2's first insert has: the
-- feature CHECK on `ai_jobs` (0141) names six ids and `ai_character_replace`
-- is not among them, so a row for it would be refused with 23514.
--
-- ⚠️ PLAIN DDL ONLY, no dollar-quoted blocks — DDL after a `do $$` block has
-- been observed to be silently skipped in this project (0130).
--
-- `ai_clean` STAYS in the list. Rows with that feature exist in production and
-- are listed in history until the retention sweep expires them; a constraint
-- that refused the value would refuse every UPDATE the sweep makes to them.
-- Nothing can CREATE one any more: the feature is gone from the registry
-- (lib/ai/jobs.ts) and the create route answers FEATURE_UNAVAILABLE.

alter table public.ai_jobs drop constraint if exists ai_jobs_feature_chk;
alter table public.ai_jobs add constraint ai_jobs_feature_chk check (
  feature in (
    'ai_clean',
    'ai_character_replace',
    'ai_image_clean',
    'ai_upscale',
    'ai_caption',
    'ai_background_remove',
    'ai_generate'
  )
);

comment on constraint ai_jobs_feature_chk on public.ai_jobs is
  'Every feature the job system may store. Mirrors the AiFeature union in lib/ai/jobs.ts; ai_clean is retained for existing rows only (tool removed 2026-09-13), ai_character_replace added the same day.';
