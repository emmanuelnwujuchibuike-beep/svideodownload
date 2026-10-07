-- ═══════════════════════════════════════════════════════════════════════════
--  0185 — INCLUDED GENERATIONS PER FEATURE PER MONTH (2026-10-07)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Credit brief §5: each AI feature may carry a "free allowance · Pro
-- allowance · Business allowance". Tiers = Free / AI Pro / AI Max (owner,
-- same day). The operator sets, per feature and tier, how many generations a
-- month cost nothing (`frenzAiPlans.features.<id>.monthlyIncluded`, default 0
-- everywhere — so nothing changes until an operator sets a number).
--
-- The SAME shape as the Text to Audio and Voice Cloning monthly counters
-- (0170, 0171), which have been live since September: one counter row per
-- member, feature and month (the operator's zone decides the key, computed by
-- the server); two SECURITY DEFINER functions are its only writers, each
-- atomic under a per-member advisory lock. A job that used an included
-- generation is funded `free` with `metadata.included_use`, and its undo gives
-- the use back once (lib/ai/credits/included.ts guards it on the row) — no
-- change to `ai_jobs` or its start claim.
--
-- Plain DDL first, functions after, grants in one block at the end (0130).

create table if not exists public.ai_feature_included_usage (
  user_id     uuid not null references auth.users (id) on delete cascade,
  feature     text not null,
  period_key  text not null,
  used        integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, feature, period_key),
  constraint ai_feature_included_usage_used_chk check (used >= 0)
);

comment on table public.ai_feature_included_usage is
  'Generations taken from a feature''s monthly included allowance (0185), per member, feature and month (operator zone). Written only by consume/release_feature_included (service role).';

alter table public.ai_feature_included_usage enable row level security;
revoke all on public.ai_feature_included_usage from public, anon, authenticated;
grant all on public.ai_feature_included_usage to service_role;

-- Take ONE included generation if the month has one left. Answers whether it was taken.
create or replace function public.consume_feature_included(
  p_user_id    uuid,
  p_feature    text,
  p_period_key text,
  p_limit      integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
begin
  if p_limit is null or p_limit <= 0 then
    return jsonb_build_object('taken', false, 'used', 0, 'limit', 0);
  end if;
  perform pg_advisory_xact_lock(hashtext('ai_included:' || p_user_id::text));
  insert into public.ai_feature_included_usage (user_id, feature, period_key, used)
    values (p_user_id, p_feature, p_period_key, 0)
    on conflict (user_id, feature, period_key) do nothing;
  select used into v_used from public.ai_feature_included_usage
   where user_id = p_user_id and feature = p_feature and period_key = p_period_key for update;
  if v_used >= p_limit then
    return jsonb_build_object('taken', false, 'used', v_used, 'limit', p_limit);
  end if;
  update public.ai_feature_included_usage set used = used + 1, updated_at = now()
   where user_id = p_user_id and feature = p_feature and period_key = p_period_key;
  return jsonb_build_object('taken', true, 'used', v_used + 1, 'limit', p_limit);
end;
$$;

-- Give one back (the job never delivered). Never below zero.
create or replace function public.release_feature_included(
  p_user_id    uuid,
  p_feature    text,
  p_period_key text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
begin
  perform pg_advisory_xact_lock(hashtext('ai_included:' || p_user_id::text));
  update public.ai_feature_included_usage set used = greatest(0, used - 1), updated_at = now()
   where user_id = p_user_id and feature = p_feature and period_key = p_period_key
  returning used into v_used;
  return coalesce(v_used, 0);
end;
$$;

do $$
begin
  execute 'revoke all on function public.consume_feature_included(uuid, text, text, integer) from public, anon, authenticated';
  execute 'revoke all on function public.release_feature_included(uuid, text, text) from public, anon, authenticated';
  execute 'grant execute on function public.consume_feature_included(uuid, text, text, integer) to service_role';
  execute 'grant execute on function public.release_feature_included(uuid, text, text) to service_role';
end $$;
