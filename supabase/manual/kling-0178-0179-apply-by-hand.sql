-- ═══════════════════════════════════════════════════════════════════════════
--  0178 + 0179 BY HAND — paste into Supabase → SQL editor → Run (once)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 2026-10-04. The Supabase GitHub migration runner has applied NOTHING since
-- 0177. Probed against production, not read off a file:
--
--     insert ai_jobs(provider = 'kling')            → 23514 ai_jobs_provider_chk
--     insert ai_jobs(provider = 'elevenlabs')       → 23514 ai_jobs_provider_chk
--     insert ai_jobs(feature  = 'ai_text_to_video') → 23514 ai_jobs_feature_chk
--     insert ai_jobs(feature  = 'ai_image_to_video')→ 23514 ai_jobs_feature_chk
--     insert ai_jobs(provider = 'replicate')        → passes both (reaches
--                                                     ai_jobs_subject_chk)
--
-- 0178 was pushed 2026-09-28 07:09 PDT (c15fe03) and 0179 the same afternoon
-- (61a1a45). Both are still unapplied six days later. Everything up to 0177 IS
-- live (`track_events`, `track_download_state` answer; `track_ingest_diag` is
-- gone, which is 0175 having run) — so the runner stopped exactly at 0178, the
-- same way it stopped at 0161 on 2026-09-20.
--
-- ── What this breaks in the product, right now ─────────────────────────────
--
-- Every Kling video generation — Text to Video, Image to Video, Lip Sync —
-- fails. `createKlingVideoJob` writes the job row BEFORE it submits, so the
-- insert is refused by the CHECK and the member sees
-- "Something went wrong. Nothing was charged — try again in a moment."
-- (INTERNAL_ERROR). Nothing IS charged: the row is written before the
-- reservation, so no money moves. The failure is total and silent in the UI.
--
-- ── Safety ────────────────────────────────────────────────────────────────
--
-- Purely permissive. Widening a CHECK cannot invalidate an existing row, no
-- data is read, written, moved or deleted, no column is added, dropped or
-- retyped, and no function, index, policy or grant is touched. Running this
-- after the integration recovers is harmless — every statement is idempotent
-- (`drop constraint if exists` then `add`), and the last block records both
-- versions in the migration ledger so the runner does not try them again.
--
-- Order is the 0167 lesson, kept: `ai_provider_runs` first, `ai_jobs` LAST,
-- each constraint added `not valid` (a short lock) and validated in its own
-- statement (a share lock, no table rewrite).


-- ─────────────────────────────── 0178_ai_kling_provider ───────────────────────────────
-- Kling as an accepted `provider` value. Without this, `stampJobProvider(job,
-- 'kling', …)` is refused and no Kling job can be submitted.

alter table public.ai_provider_runs drop constraint if exists ai_provider_runs_provider_chk;
alter table public.ai_provider_runs
  add constraint ai_provider_runs_provider_chk check (provider in ('replicate', 'fal', 'elevenlabs', 'kling')) not valid;
alter table public.ai_provider_runs validate constraint ai_provider_runs_provider_chk;

alter table public.ai_jobs drop constraint if exists ai_jobs_provider_chk;
alter table public.ai_jobs
  add constraint ai_jobs_provider_chk check (provider in ('replicate', 'fal', 'kling')) not valid;
alter table public.ai_jobs validate constraint ai_jobs_provider_chk;


-- ─────────────────────────────── 0179_ai_kling_video_features ───────────────────────────────
-- `elevenlabs` on ai_jobs too (Text to Audio and Voice Cloning now declare their
-- real vendor), then the feature list. This re-states the provider constraint
-- deliberately: 0179 widens what 0178 set, and running the two in order is what
-- the runner would have done.

alter table public.ai_jobs drop constraint if exists ai_jobs_provider_chk;
alter table public.ai_jobs
  add constraint ai_jobs_provider_chk check (provider in ('replicate', 'fal', 'kling', 'elevenlabs')) not valid;
alter table public.ai_jobs validate constraint ai_jobs_provider_chk;

-- LAST: the feature check on ai_jobs. Every existing value stays accepted,
-- including 'ai_clean' and 'ai_character_replace' — those rows were paid for and
-- must stay readable for accounting, refunds, the history page and the retention
-- sweep. Character Replace lost its ENGINE, not its past.
alter table public.ai_jobs drop constraint if exists ai_jobs_feature_chk;
alter table public.ai_jobs add constraint ai_jobs_feature_chk check (
  feature in (
    'ai_clean',
    'ai_character_replace',
    'ai_lip_sync',
    'ai_text_to_audio',
    'ai_voice_clone',
    -- 🔴 the two NEW Kling video features
    'ai_text_to_video',
    'ai_image_to_video',
    'ai_image_clean',
    'ai_upscale',
    'ai_caption',
    'ai_background_remove',
    'ai_generate'
  )
) not valid;
alter table public.ai_jobs validate constraint ai_jobs_feature_chk;


-- ─────────────────────────────── the ledger + the cache ───────────────────────────────
do $$
begin
  insert into supabase_migrations.schema_migrations (version, name)
  values ('0178', 'ai_kling_provider'), ('0179', 'ai_kling_video_features')
  on conflict (version) do nothing;
exception when others then
  raise notice 'migration ledger not updated (%): the runner may re-apply 0178-0179, which is harmless', sqlerrm;
end $$;

notify pgrst, 'reload schema';
