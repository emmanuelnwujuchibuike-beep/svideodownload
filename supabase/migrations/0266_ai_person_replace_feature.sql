-- ═══════════════════════════════════════════════════════════════════════════
--  0266 — `ai_person_replace` as an accepted ai_jobs.feature value
--         (2026-10-19, Character Replace on the direct Kling Omni endpoint)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Character Replace returns as a Kling 3.0 Omni edit: the member's video as
-- `base_video`, one photo per chosen person as `refer_image`, a server-written
-- instruction (lib/ai/kling/pipelines/person-replace.ts). It gets a NEW value
-- rather than reviving 'ai_character_replace', which still names the retired
-- Replicate/fal tool's rows, routes and finalizer branches.
--
-- 🔴 WHY THIS MUST BE LIVE BEFORE THE CODE IS USED (the 0179 reason, again):
-- the job row is written AFTER the price is decided and BEFORE the money is
-- reserved — a value the database refuses fails the create cleanly today, but
-- the order has changed before, and a refused value after a reservation is a
-- charged member with no job. The tool also ships with its pricing tiers OFF,
-- so nothing can create a row until the operator prices it — apply this first.
--
-- Purely permissive: every existing value stays accepted, no row is read,
-- written or moved, no column, function, index, policy or grant is touched.
-- `not valid` (a short lock) and validated in its own statement (a share lock,
-- no rewrite), as 0167 / 0168 / 0178 / 0179 did.

alter table public.ai_jobs drop constraint if exists ai_jobs_feature_chk;
alter table public.ai_jobs add constraint ai_jobs_feature_chk check (
  feature in (
    'ai_clean',
    'ai_character_replace',
    'ai_lip_sync',
    'ai_text_to_audio',
    'ai_voice_clone',
    'ai_text_to_video',
    'ai_image_to_video',
    'ai_person_replace',
    'ai_image_clean',
    'ai_upscale',
    'ai_caption',
    'ai_background_remove',
    'ai_generate'
  )
) not valid;
alter table public.ai_jobs validate constraint ai_jobs_feature_chk;
