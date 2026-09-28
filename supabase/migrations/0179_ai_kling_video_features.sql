-- ═══════════════════════════════════════════════════════════════════════════
--  0179 — the two NEW Kling video features, as accepted `ai_jobs.feature` values
--         (2026-09-28, the provider migration Part 5)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Part 5 §2/§4: every video feature gets its own Kling pipeline, and the feature
-- registry must make the mapping obvious. Two of those features are NEW products
-- rather than re-pointed ones:
--
--     ai_text_to_video    prompt            → Kling Omni  (verified end to end)
--     ai_image_to_video   a photo, animated → Kling Omni  (verified end to end)
--
-- `ai_lip_sync` is NOT new — it already exists and keeps its value, its history
-- and its wallet entries; Part 5 only changes which provider runs it (Replicate →
-- direct Kling), which is a routing change and needs no schema at all.
--
-- ── 🔴 WHY THIS MIGRATION LANDS BEFORE ANY CODE CAN WRITE THE VALUE ─────────
--
-- The same reason 0178 widened the provider constraint on its own, and the same
-- failure it was written to prevent (Part 1 audit §N risk 1):
--
--     /start reserves the member's money BEFORE the job row is written. A
--     `feature` value the database refuses therefore fails AFTER the charge — a
--     charged member with no job.
--
-- So the constraint is widened first, deployed on its own, and the features are
-- registered in code afterwards.
--
-- ── What deliberately does NOT change ───────────────────────────────────────
--
--   · every existing value stays accepted, including 'ai_clean' and
--     'ai_character_replace'. Part 5 §29/§41 and the standing rule about history:
--     rows that were paid for must stay readable for accounting, refunds, the
--     history page and the retention sweep. Character Replace loses its ENGINE,
--     not its past.
--   · no data is read, written, moved or deleted;
--   · no column is added, dropped or retyped;
--   · no function, index, policy or grant is touched.
--
-- Widening a CHECK is purely permissive: every row satisfying the old predicate
-- satisfies the new one, so nothing is invalidated. Rolling back means narrowing
-- it again, which is safe only while no row carries a new value — true until the
-- code that follows this migration ships.
--
-- ── 🔴 ORDER (the 0167 lesson, repeated by 0168 and 0178) ───────────────────
-- ai_jobs is the big table and takes its lock LAST; the constraint is added
-- `not valid` (a short lock) and validated in its own statement (a share lock, no
-- rewrite). Nothing here is pasted by hand — the runner applies it on push.

alter table public.ai_jobs drop constraint if exists ai_jobs_feature_chk;
alter table public.ai_jobs add constraint ai_jobs_feature_chk check (
  feature in (
    -- retired, but historical rows must stay readable
    'ai_clean',
    -- retired as a product in Part 5 (no direct-Kling capability); history preserved
    'ai_character_replace',
    -- re-pointed to the direct Kling Lip Sync endpoint in Part 5; same value
    'ai_lip_sync',
    -- the direct ElevenLabs tools, untouched by this migration (§12)
    'ai_text_to_audio',
    'ai_voice_clone',
    -- 🔴 NEW in Part 5: the two Kling video features verified end to end
    'ai_text_to_video',
    'ai_image_to_video',
    -- never built; kept because the type has always carried them
    'ai_image_clean',
    'ai_upscale',
    'ai_caption',
    'ai_background_remove',
    'ai_generate'
  )
) not valid;
alter table public.ai_jobs validate constraint ai_jobs_feature_chk;
