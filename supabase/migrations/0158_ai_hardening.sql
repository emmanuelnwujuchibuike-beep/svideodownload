-- 0158 · Character Replace part 8 — production hardening.
--
--   · `claim_ai_job_start`: the /start claim (queued → acquiring) with the
--     ACTIVE-JOB LIMITS decided inside one advisory lock, so two requests
--     racing the same member's last slot — or the platform's last slot —
--     cannot both win. Before this the create route counted and then wrote,
--     which is the race by definition, and /start checked nothing.
--   · `ai_provider_health`: one row per provider model — the circuit
--     breaker's memory. Serverless instances share nothing, so a failure
--     streak lives HERE, and `ai_provider_health_record` moves it.
--   · an index for the global active count (status alone).
--
-- Plain DDL, functions, then the revokes inside ONE `do $$` block with
-- `execute` at the very end — the 0130 lesson (DDL after a dollar-quoted body
-- can be skipped) and the 0141/0154 pattern, kept on purpose.

create index if not exists ai_jobs_active_feature_idx
  on public.ai_jobs (feature, status)
  where status in ('acquiring', 'processing', 'finalizing');

create table if not exists public.ai_provider_health (
  key            text primary key,
  failures       integer not null default 0,
  successes      integer not null default 0,
  window_started timestamptz not null default now(),
  last_failure   timestamptz,
  last_success   timestamptz,
  last_error     text,
  opened_until   timestamptz,
  opened_count   integer not null default 0,
  updated_at     timestamptz not null default now(),
  constraint ai_provider_health_key_chk check (char_length(key) between 1 and 160)
);

comment on table public.ai_provider_health is
  'Circuit breaker state per provider model (0158). failures/successes count inside the current window; opened_until set = the circuit is OPEN and no new job may be submitted to that model until it passes. Service role only.';

alter table public.ai_provider_health enable row level security;
revoke all on table public.ai_provider_health from anon, authenticated;

-- ── the /start claim, with the limits inside the lock ───────────────────────
-- Returns one word: 'claimed' | 'lost' | 'user_limit' | 'global_limit' | 'daily_limit'.
--   'lost'         = the row is not queued any more (a double press, a cancel).
--   'user_limit'   = the member already runs p_max_user jobs (0 = no cap).
--   'global_limit' = the platform already runs p_max_global jobs of this feature (0 = no cap).
--   'daily_limit'  = the member started p_max_daily jobs in the last 24 h (0 = no cap).
-- Nothing is written unless it says 'claimed'. The write is the same
-- compare-and-set /start always made, with the same fields.
create or replace function public.claim_ai_job_start(
  p_job_id      uuid,
  p_user_id     uuid,
  p_feature     text,
  p_max_user    integer,
  p_max_global  integer,
  p_max_daily   integer,
  p_charged     bigint,
  p_metadata    jsonb
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   text;
  v_active   integer;
  v_global   integer;
  v_daily    integer;
  v_updated  integer;
begin
  -- One lock for all starts of this feature: a few milliseconds, never contended in practice.
  perform pg_advisory_xact_lock(hashtext('ai_jobs:start:' || p_feature));

  select status into v_status from public.ai_jobs where id = p_job_id and user_id = p_user_id;
  if v_status is null or v_status <> 'queued' then
    return 'lost';
  end if;

  if p_max_user > 0 then
    select count(*) into v_active from public.ai_jobs
     where user_id = p_user_id and feature = p_feature and id <> p_job_id
       and status in ('acquiring', 'processing', 'finalizing');
    if v_active >= p_max_user then
      return 'user_limit';
    end if;
  end if;

  if p_max_global > 0 then
    select count(*) into v_global from public.ai_jobs
     where feature = p_feature and status in ('acquiring', 'processing', 'finalizing');
    if v_global >= p_max_global then
      return 'global_limit';
    end if;
  end if;

  if p_max_daily > 0 then
    select count(*) into v_daily from public.ai_jobs
     where user_id = p_user_id and feature = p_feature and id <> p_job_id
       and started_at is not null and started_at >= now() - interval '24 hours';
    if v_daily >= p_max_daily then
      return 'daily_limit';
    end if;
  end if;

  update public.ai_jobs
     set status = 'acquiring',
         funding_source = 'balance',
         charged_cents = p_charged,
         metadata = p_metadata,
         started_at = coalesce(started_at, now())
   where id = p_job_id and user_id = p_user_id and status = 'queued';
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    return 'claimed';
  end if;
  return 'lost';
end;
$$;

-- ── the circuit breaker's one move ──────────────────────────────────────────
-- Records one outcome for p_key and answers the row's state afterwards. A
-- failure inside the window counts; p_threshold failures in p_window_seconds
-- OPEN the circuit for p_cooldown_seconds. A success while closed resets the
-- streak; a success after the cooldown passed closes the circuit (half-open
-- probe succeeded). Never opens on a success, never counts a failure twice.
create or replace function public.ai_provider_health_record(
  p_key             text,
  p_ok              boolean,
  p_threshold       integer,
  p_window_seconds  integer,
  p_cooldown_seconds integer,
  p_detail          text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.ai_provider_health%rowtype;
  v_now timestamptz := now();
begin
  insert into public.ai_provider_health (key) values (p_key)
    on conflict (key) do nothing;
  select * into r from public.ai_provider_health where key = p_key for update;

  -- the window rolled over: start counting again
  if r.window_started < v_now - make_interval(secs => greatest(1, p_window_seconds)) then
    r.failures := 0;
    r.successes := 0;
    r.window_started := v_now;
  end if;

  if p_ok then
    r.successes := r.successes + 1;
    r.last_success := v_now;
    -- a success after the cooldown = the half-open probe passed: close it
    if r.opened_until is not null and r.opened_until <= v_now then
      r.opened_until := null;
      r.failures := 0;
    elsif r.opened_until is null then
      r.failures := 0;
    end if;
  else
    r.failures := r.failures + 1;
    r.last_failure := v_now;
    r.last_error := left(coalesce(p_detail, ''), 300);
    if p_threshold > 0 and r.failures >= p_threshold and (r.opened_until is null or r.opened_until <= v_now) then
      r.opened_until := v_now + make_interval(secs => greatest(1, p_cooldown_seconds));
      r.opened_count := r.opened_count + 1;
    end if;
  end if;

  update public.ai_provider_health h
     set failures = r.failures, successes = r.successes, window_started = r.window_started,
         last_failure = r.last_failure, last_success = r.last_success, last_error = r.last_error,
         opened_until = r.opened_until, opened_count = r.opened_count, updated_at = v_now
   where h.key = p_key;

  return jsonb_build_object(
    'failures', r.failures, 'successes', r.successes, 'opened_until', r.opened_until,
    'opened_count', r.opened_count, 'last_error', r.last_error, 'window_started', r.window_started
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
--  🔴 REVOKE. POSTGRES GRANTS EXECUTE TO PUBLIC BY DEFAULT.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.claim_ai_job_start(uuid, uuid, text, integer, integer, integer, bigint, jsonb)',
    'public.ai_provider_health_record(text, boolean, integer, integer, integer, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
