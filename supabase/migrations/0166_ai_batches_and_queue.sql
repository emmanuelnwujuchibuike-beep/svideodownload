-- 0166 · Multi-video processing: batches, the `waiting` status, the queue.
--
-- Owner, 2026-09-21: "upgrade the existing AI video editing system to support
-- processing MULTIPLE VIDEOS in one user session … If you discover that my
-- existing architecture already has a queue/job system, reuse and extend it."
--
-- It does. Every Character Replace video is already one `ai_jobs` row with its
-- own prediction, its own reservation on the product ledger and its own
-- retries; the per-member concurrency cap is already decided inside one
-- advisory lock at /start (`claim_ai_job_start`, 0158 → 0163). What did not
-- exist is a place for a job to WAIT: a member over their cap was refused.
--
-- This migration adds exactly that and nothing else:
--
--   · `batch_id` / `batch_index` on ai_jobs — a batch is a label over
--     independent jobs, never a row of its own (no second table, no second
--     ledger, no second RLS surface). Progress is an aggregate over the jobs.
--   · the status `waiting` — PAID FOR (or a complimentary use consumed),
--     validated, holding its place until a processing slot is free. Distinct
--     from `queued` (a draft: nothing charged, uploads maybe unfinished — and
--     the sweep that expires abandoned drafts must never touch a waiting job).
--   · `claim_ai_job_start` gains `p_queue`: when the member's or the
--     platform's cap refuses and the queue is on, the row goes queued →
--     waiting with the same fields a claim writes (funding, charge, metadata),
--     instead of being refused. `started_at` stays NULL until admission — it
--     is the moment the provider is engaged, and the admin's "took" column
--     measures processing, not the wait. The daily cap counts waiting rows
--     too, so a queue cannot be used to bank tomorrow's starts.
--   · `admit_ai_waiting_jobs`: under the SAME advisory lock, count what is
--     running for the member and for the platform and move the next waiting
--     rows (created order, then batch order) to `acquiring`, up to the free
--     slots, returning their ids for the caller to hand to the worker. Two
--     jobs finishing in the same instant call this twice; the lock serialises
--     them and the second finds the slots already taken. Race-safe by
--     construction, exactly like the start claim.
--     🔴 Only rows whose reservation is CONFIRMED are admissible: the claim
--     moves the row to `waiting` BEFORE the ledger reservation (the Part 8
--     order — a reservation refunded for a limit would run the next Start
--     free), and /start writes `metadata.queue.reserved_at` once the money
--     has moved. A waiting row without it is a start whose reservation has
--     not finished, or failed; admitting it would run an unpaid job.
--
-- Plain DDL first, the functions, then the revokes in ONE `do $$` block with
-- `execute` at the very end (the 0130 lesson, the 0141/0154/0158 pattern).
-- The old 9-argument claim is DROPPED (not overloaded — 0164's lesson: an
-- overload with defaults makes PostgREST answer PGRST203 "ambiguous").
-- Reversal: drop the two columns and the two functions, recreate 0163's
-- claim, and restore the 0157 status list — no data is transformed here.

-- ── 1 · batch identity ──────────────────────────────────────────────────────
alter table public.ai_jobs add column if not exists batch_id uuid;
alter table public.ai_jobs add column if not exists batch_index integer;

comment on column public.ai_jobs.batch_id is
  'Multi-video session (0166): the batch this job was created in. A label over independent jobs — each row keeps its own prediction, charge, refund and retries. Null for a single video.';
comment on column public.ai_jobs.batch_index is
  'Position inside the batch (1-based), the order the member picked the videos in and the order they are admitted from the queue.';

create index if not exists ai_jobs_batch_idx
  on public.ai_jobs (user_id, batch_id, batch_index)
  where batch_id is not null;

-- ── 2 · the waiting status ──────────────────────────────────────────────────
alter table public.ai_jobs drop constraint if exists ai_jobs_status_chk;
alter table public.ai_jobs add constraint ai_jobs_status_chk
  check (status in (
    'queued', 'waiting', 'acquiring', 'processing', 'finalizing', 'completed', 'failed', 'cancelled', 'expired', 'deleted'
  ));

comment on constraint ai_jobs_status_chk on public.ai_jobs is
  'Mirrors lib/ai/jobs.ts AiJobStatus. `waiting` (0166) = paid for and validated, holding its place until a processing slot is free; `deleted` (0157) = the member removed the result.';

-- The queue's own read: a member's waiting rows in admission order.
create index if not exists ai_jobs_waiting_idx
  on public.ai_jobs (user_id, feature, created_at, batch_index)
  where status = 'waiting';

-- The stall/recovery sweep visits waiting rows too (a 24 h ceiling on the wait).
drop index if exists public.ai_jobs_recovery_idx;
create index if not exists ai_jobs_recovery_idx
  on public.ai_jobs (finalize_next_at, started_at)
  where status in ('waiting', 'processing', 'finalizing');

-- ── 3 · the start claim, with the queue ─────────────────────────────────────
drop function if exists public.claim_ai_job_start(uuid, uuid, text, integer, integer, integer, bigint, jsonb, text);

create or replace function public.claim_ai_job_start(
  p_job_id     uuid,
  p_user_id    uuid,
  p_feature    text,
  p_max_user   integer,
  p_max_global integer,
  p_max_daily  integer,
  p_charged    bigint,
  p_metadata   jsonb,
  p_funding    text,
  p_queue      boolean
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
  v_limited  text := null;
begin
  if p_funding not in ('balance', 'free') then
    raise exception 'unknown funding source: %', p_funding;
  end if;
  perform pg_advisory_xact_lock(hashtext('ai_jobs:start:' || p_feature));

  select status into v_status from public.ai_jobs where id = p_job_id and user_id = p_user_id;
  if v_status is null or v_status <> 'queued' then
    return 'lost';
  end if;

  -- The daily cap is a ceiling on STARTS, so a job that is merely waiting for
  -- a slot already counts: otherwise a member could queue a week of videos in
  -- one evening and have the queue start them one day at a time.
  if p_max_daily > 0 then
    select count(*) into v_daily from public.ai_jobs
     where user_id = p_user_id and feature = p_feature and id <> p_job_id
       and ((started_at is not null and started_at >= now() - interval '24 hours') or status = 'waiting');
    if v_daily >= p_max_daily then
      return 'daily_limit';
    end if;
  end if;

  if p_max_user > 0 then
    select count(*) into v_active from public.ai_jobs
     where user_id = p_user_id and feature = p_feature and id <> p_job_id
       and status in ('acquiring', 'processing', 'finalizing');
    if v_active >= p_max_user then
      v_limited := 'user_limit';
    end if;
  end if;

  if v_limited is null and p_max_global > 0 then
    select count(*) into v_global from public.ai_jobs
     where feature = p_feature and status in ('acquiring', 'processing', 'finalizing');
    if v_global >= p_max_global then
      v_limited := 'global_limit';
    end if;
  end if;

  -- A member already holding a waiting row is behind it: a new start joins the
  -- line rather than jumping it, even when a slot happens to be free now.
  if v_limited is null and p_queue then
    if exists (select 1 from public.ai_jobs where user_id = p_user_id and feature = p_feature and status = 'waiting' and id <> p_job_id) then
      v_limited := 'user_limit';
    end if;
  end if;

  if v_limited is not null then
    if not p_queue then
      return v_limited;
    end if;
    update public.ai_jobs
       set status = 'waiting',
           funding_source = p_funding,
           charged_cents = p_charged,
           metadata = p_metadata || jsonb_build_object('queue', jsonb_build_object('queued_at', to_jsonb(now()), 'reason', v_limited))
     where id = p_job_id and user_id = p_user_id and status = 'queued';
    get diagnostics v_updated = row_count;
    if v_updated = 1 then
      return 'waiting';
    end if;
    return 'lost';
  end if;

  update public.ai_jobs
     set status = 'acquiring',
         funding_source = p_funding,
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

comment on function public.claim_ai_job_start(uuid, uuid, text, integer, integer, integer, bigint, jsonb, text, boolean) is
  'The /start claim (0158 → 0166): one advisory lock per feature; the member''s, the platform''s and the daily caps counted inside it; queued → acquiring when a slot is free, queued → waiting when it is not and p_queue is true (the row keeps the funding and the charge it was claimed with). Verdicts: claimed | waiting | lost | user_limit | global_limit | daily_limit.';

-- ── 4 · admission from the queue ────────────────────────────────────────────
create or replace function public.admit_ai_waiting_jobs(
  p_user_id    uuid,
  p_feature    text,
  p_max_user   integer,
  p_max_global integer,
  p_limit      integer default 10
) returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active integer;
  v_global integer;
  v_slots  integer;
begin
  perform pg_advisory_xact_lock(hashtext('ai_jobs:start:' || p_feature));

  select count(*) into v_active from public.ai_jobs
   where user_id = p_user_id and feature = p_feature
     and status in ('acquiring', 'processing', 'finalizing');
  select count(*) into v_global from public.ai_jobs
   where feature = p_feature and status in ('acquiring', 'processing', 'finalizing');

  -- 0 = no cap of that kind (the same convention as the claim).
  v_slots := greatest(0, least(p_limit,
    case when p_max_user   > 0 then p_max_user   - v_active else p_limit end,
    case when p_max_global > 0 then p_max_global - v_global else p_limit end));
  if v_slots <= 0 then
    return;
  end if;

  return query
  with next_up as (
    select id from public.ai_jobs
     where user_id = p_user_id and feature = p_feature and status = 'waiting'
       and (metadata -> 'queue' ->> 'reserved_at') is not null
     order by created_at asc, batch_index asc nulls last, id asc
     limit v_slots
     for update skip locked
  )
  update public.ai_jobs j
     set status = 'acquiring',
         started_at = coalesce(j.started_at, now()),
         metadata = coalesce(j.metadata, '{}'::jsonb)
                    || jsonb_build_object('queue', coalesce(j.metadata -> 'queue', '{}'::jsonb) || jsonb_build_object('admitted_at', to_jsonb(now())))
    from next_up
   where j.id = next_up.id and j.status = 'waiting'
  returning j.id;
end;
$$;

comment on function public.admit_ai_waiting_jobs(uuid, text, integer, integer, integer) is
  'The queue pump (0166): under the start lock, move the member''s next waiting jobs whose reservation is confirmed (metadata.queue.reserved_at) to acquiring, as many as the member''s and the platform''s free slots allow (0 = no cap), in created/batch order. Returns the admitted ids; the caller hands each to the worker. Idempotent: a second call finds no free slot or no waiting row.';

-- ── 5 · who may call ────────────────────────────────────────────────────────
-- 🔴 REVOKE. POSTGRES GRANTS EXECUTE TO PUBLIC BY DEFAULT.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.claim_ai_job_start(uuid, uuid, text, integer, integer, integer, bigint, jsonb, text, boolean)',
    'public.admit_ai_waiting_jobs(uuid, text, integer, integer, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
