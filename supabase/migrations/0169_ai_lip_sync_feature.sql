-- 0169 · Lip Sync Pro becomes a feature the job system can store (2026-09-21).
--
-- The owner's brief: a dedicated Lip Sync Pro tool — a source video and ONE
-- speech source (typed text, or an uploaded audio file) — on the existing AI
-- job architecture, the same credit/subscription/wallet/admin systems. It
-- reuses every table there is: `ai_jobs` (feature `ai_lip_sync`, the same
-- statuses, the same pipeline metadata), the one Frenz AI product wallet
-- (`ai_product_*`, product `character_replace` — ONE balance, 0155), the
-- credit ledger (feature column), the complimentary creations, the run
-- ledger (0168). No new table.
--
-- The only schema fact to widen is the feature CHECK on `ai_jobs` — added
-- the lock-friendly way (the 0167 lesson): `not valid` first, validated in
-- its own statement. `ai_clean` stays for the rows that exist.
alter table public.ai_jobs drop constraint if exists ai_jobs_feature_chk;
alter table public.ai_jobs add constraint ai_jobs_feature_chk check (
  feature in (
    'ai_clean',
    'ai_character_replace',
    'ai_lip_sync',
    'ai_image_clean',
    'ai_upscale',
    'ai_caption',
    'ai_background_remove',
    'ai_generate'
  )
) not valid;
alter table public.ai_jobs validate constraint ai_jobs_feature_chk;

comment on constraint ai_jobs_feature_chk on public.ai_jobs is
  'Every feature the job system may store. Mirrors the AiFeature union in lib/ai/jobs.ts; ai_clean is retained for existing rows only (tool removed 2026-09-13); ai_character_replace added 2026-09-13; ai_lip_sync (Lip Sync Pro) added 2026-09-21.';
