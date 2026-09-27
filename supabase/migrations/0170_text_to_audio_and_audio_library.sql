-- ═══════════════════════════════════════════════════════════════════════════
--  0170 — Text to Audio as a standalone tool: the Audio Library, the monthly
--         free characters, the feature check (2026-09-21)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The owner's brief: "Text-to-Audio must be a first-class standalone tool —
-- text → ElevenLabs v3 → audio → preview → save/download — with its own
-- billing, an Audio Library a member can reuse in Lip Sync Pro without paying
-- for the audio again, and 500 free characters a month for free and every
-- plan." The same job rows (`ai_jobs`, feature `ai_text_to_audio`), the same
-- one Frenz AI wallet, the same credits. Two small tables and two functions.
--
-- ── 1. the Audio Library ────────────────────────────────────────────────────
-- One row per saved generation: the object in the RESULTS bucket, its facts,
-- the name the member gave it. Members read their own rows (RLS); writes go
-- through the service role only.
create table if not exists public.ai_audio_assets (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  job_id         uuid references public.ai_jobs (id) on delete set null,
  name           text not null,
  path           text not null,
  mime           text not null default 'audio/mpeg',
  bytes          bigint not null default 0,
  duration_ms    integer,
  provider       text,
  model          text,
  voice_id       text,
  language_code  text,
  characters     integer not null default 0,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists ai_audio_assets_user_idx on public.ai_audio_assets (user_id, created_at desc) where deleted_at is null;
create unique index if not exists ai_audio_assets_job_uidx on public.ai_audio_assets (job_id) where job_id is not null;
alter table public.ai_audio_assets enable row level security;
drop policy if exists ai_audio_assets_select_own on public.ai_audio_assets;
create policy ai_audio_assets_select_own on public.ai_audio_assets for select using (auth.uid() = user_id and deleted_at is null);
revoke all on public.ai_audio_assets from public, anon;
grant select on public.ai_audio_assets to authenticated;
grant all on public.ai_audio_assets to service_role;

-- ── 2. the monthly free characters ──────────────────────────────────────────
-- A counter per member per calendar month (the operator's zone decides the
-- month key, computed by the server like the credit day/week keys). The two
-- functions are the only writers; both are atomic per member.
create table if not exists public.ai_tta_free_usage (
  user_id     uuid not null,
  month_key   text not null,
  used        integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, month_key)
);
alter table public.ai_tta_free_usage enable row level security;
revoke all on public.ai_tta_free_usage from public, anon, authenticated;
grant all on public.ai_tta_free_usage to service_role;

-- Take up to p_characters of the month's allowance; answers how many were
-- covered (0..p_characters). Idempotency is the caller's: it is called once
-- per job at Start, and `release_tta_free_characters` gives the same count
-- back when the job never delivers.
create or replace function public.consume_tta_free_characters(
  p_user_id    uuid,
  p_month_key  text,
  p_characters integer,
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
  perform pg_advisory_xact_lock(hashtext('tta_free:' || p_user_id::text));
  insert into public.ai_tta_free_usage (user_id, month_key, used)
    values (p_user_id, p_month_key, 0)
    on conflict (user_id, month_key) do nothing;
  select used into v_used from public.ai_tta_free_usage where user_id = p_user_id and month_key = p_month_key for update;
  v_take := greatest(0, least(p_characters, p_allowance - v_used));
  if v_take > 0 then
    update public.ai_tta_free_usage set used = used + v_take, updated_at = now() where user_id = p_user_id and month_key = p_month_key;
  end if;
  return jsonb_build_object('covered', v_take, 'used', v_used + v_take, 'allowance', p_allowance);
end;
$$;

create or replace function public.release_tta_free_characters(
  p_user_id    uuid,
  p_month_key  text,
  p_characters integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
begin
  perform pg_advisory_xact_lock(hashtext('tta_free:' || p_user_id::text));
  select used into v_used from public.ai_tta_free_usage where user_id = p_user_id and month_key = p_month_key for update;
  if v_used is null then return 0; end if;
  update public.ai_tta_free_usage set used = greatest(0, used - greatest(0, p_characters)), updated_at = now() where user_id = p_user_id and month_key = p_month_key;
  return greatest(0, v_used - greatest(0, p_characters));
end;
$$;

revoke all on function public.consume_tta_free_characters(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.release_tta_free_characters(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.consume_tta_free_characters(uuid, text, integer, integer) to service_role;
grant execute on function public.release_tta_free_characters(uuid, text, integer) to service_role;

-- ── 3. LAST: the feature check on ai_jobs, lock-friendly (the 0167 lesson) ──
alter table public.ai_jobs drop constraint if exists ai_jobs_feature_chk;
alter table public.ai_jobs add constraint ai_jobs_feature_chk check (
  feature in (
    'ai_clean',
    'ai_character_replace',
    'ai_lip_sync',
    'ai_text_to_audio',
    'ai_image_clean',
    'ai_upscale',
    'ai_caption',
    'ai_background_remove',
    'ai_generate'
  )
) not valid;
alter table public.ai_jobs validate constraint ai_jobs_feature_chk;
