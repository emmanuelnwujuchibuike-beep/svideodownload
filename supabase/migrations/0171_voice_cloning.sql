-- ═══════════════════════════════════════════════════════════════════════════
--  0171 — Voice Cloning as a standalone tool: the Voice Library, the monthly
--         free voice, the consent record, the feature check (2026-09-27)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The owner, 2026-09-27: "next lets build the standalone voice cloning … all
-- ai features pipeline must be standalone to give a cleaner premium result
-- rather than making them all go through same pipeline."
--
-- So: its own feature (`ai_voice_clone`), its own tables, its own two-step
-- flow — and NOT one byte of the video pipeline. A clone is made by the DIRECT
-- ElevenLabs API (2026-09-27: nothing new is built on Replicate or fal.ai),
-- in the request that starts it, with no worker, no prediction and no webhook.
-- The one thing it shares is the money machinery: the same `ai_jobs` row, the
-- same Frenz AI wallet, the same credit ledger, the same reserve → settle.
--
-- ── 1. the Voice Library ────────────────────────────────────────────────────
-- One row per voice the member owns. `provider_voice_id` is the vendor's id —
-- it never leaves the server, and it is what makes the voice usable in Text to
-- Audio and Lip Sync Pro without the browser ever naming a provider voice.
--
-- 🔴 THE CONSENT COLUMNS ARE NOT DECORATION. A cloned voice is somebody's
-- likeness. `consent_at`, `consent_name` and `consent_statement` record that
-- this member declared they own the voice or hold the speaker's permission, in
-- the words they were shown, at a time we can name. A row without them cannot
-- exist: the check enforces it, so no code path can create a clone that has no
-- record of who authorised it.
create table if not exists public.ai_voice_clones (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null,
  job_id             uuid references public.ai_jobs (id) on delete set null,
  name               text not null,
  description        text not null default '',
  provider           text not null default 'elevenlabs',
  provider_voice_id  text not null,
  status             text not null default 'ready',
  sample_count       integer not null default 0,
  sample_bytes       bigint not null default 0,
  sample_seconds     numeric(10, 2),
  /** The first sample, kept in the SOURCE bucket, so the member can hear what they gave us. */
  preview_path       text,
  preview_mime       text,
  language_code      text,
  labels             jsonb not null default '{}'::jsonb,
  consent_at         timestamptz not null,
  consent_name       text not null,
  consent_statement  text not null,
  created_at         timestamptz not null default now(),
  ready_at           timestamptz,
  last_used_at       timestamptz,
  deleted_at         timestamptz,
  constraint ai_voice_clones_status_chk check (status in ('pending', 'ready', 'failed', 'deleted')),
  constraint ai_voice_clones_consent_chk check (length(btrim(consent_name)) > 0 and length(btrim(consent_statement)) > 0)
);
create index if not exists ai_voice_clones_user_idx on public.ai_voice_clones (user_id, created_at desc) where deleted_at is null;
create unique index if not exists ai_voice_clones_job_uidx on public.ai_voice_clones (job_id) where job_id is not null;
-- The vendor's voice id belongs to exactly one live row: two members must never
-- share one clone, and a re-created clone must not leave a second live pointer.
create unique index if not exists ai_voice_clones_provider_uidx on public.ai_voice_clones (provider, provider_voice_id) where deleted_at is null;
alter table public.ai_voice_clones enable row level security;
drop policy if exists ai_voice_clones_select_own on public.ai_voice_clones;
create policy ai_voice_clones_select_own on public.ai_voice_clones for select using (auth.uid() = user_id and deleted_at is null);
revoke all on public.ai_voice_clones from public, anon;
grant select on public.ai_voice_clones to authenticated;
grant all on public.ai_voice_clones to service_role;

-- ── 2. the monthly free voice ───────────────────────────────────────────────
-- The Text to Audio pattern (0170), counting VOICES instead of characters: one
-- counter per member per calendar month in the operator's zone, two functions
-- as its only writers, each atomic under a per-member advisory lock. The
-- allowance is passed in by the caller because it is an admin setting, and a
-- number stored in two places is a number that disagrees with itself.
create table if not exists public.ai_vc_free_usage (
  user_id     uuid not null,
  month_key   text not null,
  used        integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, month_key)
);
alter table public.ai_vc_free_usage enable row level security;
revoke all on public.ai_vc_free_usage from public, anon, authenticated;
grant all on public.ai_vc_free_usage to service_role;

create or replace function public.consume_vc_free_clones(
  p_user_id    uuid,
  p_month_key  text,
  p_clones     integer,
  p_allowance  integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
  v_take integer;
begin
  perform pg_advisory_xact_lock(hashtext('vc_free:' || p_user_id::text));
  insert into public.ai_vc_free_usage (user_id, month_key, used)
    values (p_user_id, p_month_key, 0)
    on conflict (user_id, month_key) do nothing;
  select used into v_used from public.ai_vc_free_usage where user_id = p_user_id and month_key = p_month_key for update;
  v_take := greatest(0, least(p_clones, p_allowance - v_used));
  if v_take > 0 then
    update public.ai_vc_free_usage set used = used + v_take, updated_at = now() where user_id = p_user_id and month_key = p_month_key;
  end if;
  return jsonb_build_object('covered', v_take, 'used', v_used + v_take, 'allowance', p_allowance);
end;
$$;

create or replace function public.release_vc_free_clones(
  p_user_id    uuid,
  p_month_key  text,
  p_clones     integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
begin
  perform pg_advisory_xact_lock(hashtext('vc_free:' || p_user_id::text));
  select used into v_used from public.ai_vc_free_usage where user_id = p_user_id and month_key = p_month_key for update;
  if v_used is null then return 0; end if;
  update public.ai_vc_free_usage set used = greatest(0, used - greatest(0, p_clones)), updated_at = now() where user_id = p_user_id and month_key = p_month_key;
  return greatest(0, v_used - greatest(0, p_clones));
end;
$$;

-- 🔴 Postgres grants EXECUTE on a new function to PUBLIC. A `security definer`
-- function that takes a member id would otherwise let any signed-in browser
-- spend — or hand back — anybody's allowance.
revoke all on function public.consume_vc_free_clones(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.release_vc_free_clones(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.consume_vc_free_clones(uuid, text, integer, integer) to service_role;
grant execute on function public.release_vc_free_clones(uuid, text, integer) to service_role;

-- ── 3. LAST: the feature check on ai_jobs, lock-friendly (the 0167 lesson) ──
alter table public.ai_jobs drop constraint if exists ai_jobs_feature_chk;
alter table public.ai_jobs add constraint ai_jobs_feature_chk check (
  feature in (
    'ai_clean',
    'ai_character_replace',
    'ai_lip_sync',
    'ai_text_to_audio',
    'ai_voice_clone',
    'ai_image_clean',
    'ai_upscale',
    'ai_caption',
    'ai_background_remove',
    'ai_generate'
  )
) not valid;
alter table public.ai_jobs validate constraint ai_jobs_feature_chk;
