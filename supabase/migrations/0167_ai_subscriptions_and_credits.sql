-- 0167 · AI Pro / AI Max: the AI subscription and the credit ledger.
--
-- Owner, 2026-09-21: "Create a dedicated AI subscription system separate from
-- the normal FrenzSave Pro/Business subscription … 1 credit DOES NOT equal 1
-- video … Reserve credits atomically … Both daily and weekly limits must be
-- enforced … Every credit transaction should be auditable."
--
-- What exists and is REUSED: `subscriptions` (the site plan — untouched),
-- Paystack (the same webhook, a new purpose), `ai_jobs` (one row per unit of
-- work, `funding_source` says how it was paid for), the product wallet and the
-- complimentary creations (untouched — credits sit BETWEEN them in the funding
-- order: complimentary → included credits → the wallet).
--
-- What this adds:
--
--   · `ai_subscriptions` — one row per member: which AI plan (ai_pro | ai_max),
--     its status and period, the provider references. NOT a column on
--     `subscriptions`: a member may hold Pro + AI Pro, Business + AI Max, and the
--     two lifecycles are independent (§ "NORMAL PRO/BUSINESS VS AI PRO/MAX").
--   · `ai_credit_ledger` — one row per job funded by credits: reserved at start,
--     settled when the result is ours, released when the job ended without one.
--     The row carries the DAY and WEEK keys it counted against (server-computed
--     in the operator's reset zone), the plan, the limits and the configuration
--     version that applied, and the calculator's breakdown — so a later change
--     to the allowance never rewrites what a past generation cost.
--   · `reserve_ai_credits` — the atomic gate: an advisory lock per member, the
--     member's day and week usage summed INSIDE the lock, both limits checked,
--     the row inserted — or the refusal named. Idempotent per job (a replay
--     answers the row it already made). `settle_ai_credits` / `release_ai_credits`
--     move a reserved row exactly once; a settled row is never released (a
--     completed job is not refunded).
--   · `funding_source = 'credits'` on ai_jobs, and the start claim accepts it.
--
-- ── 🔴 LOCK ORDER (a deadlock the owner hit on 2026-09-21) ──────────────────
-- The first draft swapped the `ai_jobs` funding check in the MIDDLE of the file:
-- `alter table … add constraint` takes an AccessExclusiveLock on ai_jobs — the
-- busiest table, polled by every open job — and held it while the later
-- statements took more locks; a live reader holding a share lock and waiting
-- on us made a cycle (40P01). Now: the new tables, their policies and every
-- function come FIRST (no contention — nothing else touches them yet), and the
-- ai_jobs constraint comes LAST, added `not valid` (a brief lock, no scan) and
-- then `validate`d (ShareUpdateExclusive — reads and writes continue). The
-- same shape works pasted by hand or applied by the runner.
--
-- Plain DDL first, functions, then the revokes in ONE `do $` block with
-- `execute` at the very end (the 0130 lesson). Reversal: drop the two tables
-- and the four functions, restore the 0150 funding check and the 0166 claim.

-- ── 1 · the AI subscription ────────────────────────────────────────────────
create table if not exists public.ai_subscriptions (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  plan                 text not null,
  status               text not null default 'active',
  provider             text not null default 'paystack',
  plan_code            text,
  customer_ref         text,
  subscription_ref     text,
  email_token          text,
  last_reference       text,
  current_period_start timestamptz,
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  activated_at         timestamptz,
  canceled_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint ai_subscriptions_plan_chk   check (plan in ('ai_pro', 'ai_max')),
  constraint ai_subscriptions_status_chk check (status in ('active', 'trialing', 'past_due', 'canceled', 'expired'))
);

comment on table public.ai_subscriptions is
  'The AI plan (0167): AI Pro / AI Max, separate from the site subscription. Written only by the Paystack webhook, the verify-on-return route and administrators (service role); read by the member (own row).';

create unique index if not exists ai_subscriptions_subscription_ref_idx on public.ai_subscriptions (subscription_ref) where subscription_ref is not null;
create index if not exists ai_subscriptions_status_idx on public.ai_subscriptions (status, current_period_end);
create index if not exists ai_subscriptions_last_reference_idx on public.ai_subscriptions (last_reference) where last_reference is not null;

alter table public.ai_subscriptions enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_subscriptions' and policyname = 'ai_subscriptions_select_own') then
    create policy ai_subscriptions_select_own on public.ai_subscriptions for select using (auth.uid() = user_id);
  end if;
end $$;
revoke insert, update, delete on table public.ai_subscriptions from anon, authenticated;

-- ── 2 · the credit ledger ─────────────────────────────────────────────────
create table if not exists public.ai_credit_ledger (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references auth.users (id) on delete cascade,
  job_id           uuid not null unique references public.ai_jobs (id) on delete cascade,
  feature          text not null,
  plan             text not null,
  credits_reserved integer not null,
  credits_consumed integer not null default 0,
  credits_refunded integer not null default 0,
  status           text not null default 'reserved',
  day_key          text not null,
  week_key         text not null,
  limits_snapshot  jsonb not null default '{}'::jsonb,
  breakdown        jsonb not null default '{}'::jsonb,
  reason           text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ai_credit_ledger_status_chk  check (status in ('reserved', 'settled', 'released')),
  constraint ai_credit_ledger_amounts_chk check (credits_reserved >= 0 and credits_consumed >= 0 and credits_refunded >= 0)
);

comment on table public.ai_credit_ledger is
  'One row per AI job paid with included plan credits (0167): reserved at start (counted against the day and week keys it carries), settled when the result is ours, released when the job ended without one. The limits and configuration version that applied ride on the row; history is never recomputed.';

create index if not exists ai_credit_ledger_user_day_idx  on public.ai_credit_ledger (user_id, day_key)  where status <> 'released';
create index if not exists ai_credit_ledger_user_week_idx on public.ai_credit_ledger (user_id, week_key) where status <> 'released';
create index if not exists ai_credit_ledger_created_idx   on public.ai_credit_ledger (created_at desc);

alter table public.ai_credit_ledger enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_credit_ledger' and policyname = 'ai_credit_ledger_select_own') then
    create policy ai_credit_ledger_select_own on public.ai_credit_ledger for select using (auth.uid() = user_id);
  end if;
end $$;
revoke insert, update, delete on table public.ai_credit_ledger from anon, authenticated;

-- ── 3 · the atomic gate ────────────────────────────────────────────────────
create or replace function public.ai_credit_usage(
  p_user_id  uuid,
  p_day_key  text,
  p_week_key text
) returns table (day_used integer, week_used integer)
language sql
security definer
set search_path = public
stable
as $$
  select
    coalesce(sum(case when l.day_key  = p_day_key  then (case l.status when 'settled' then l.credits_consumed when 'reserved' then l.credits_reserved else 0 end) else 0 end), 0)::integer,
    coalesce(sum(case when l.week_key = p_week_key then (case l.status when 'settled' then l.credits_consumed when 'reserved' then l.credits_reserved else 0 end) else 0 end), 0)::integer
  from public.ai_credit_ledger l
  where l.user_id = p_user_id and l.status <> 'released' and (l.day_key = p_day_key or l.week_key = p_week_key);
$$;

create or replace function public.reserve_ai_credits(
  p_user_id      uuid,
  p_job_id       uuid,
  p_feature      text,
  p_plan         text,
  p_credits      integer,
  p_daily_limit  integer,
  p_weekly_limit integer,
  p_day_key      text,
  p_week_key     text,
  p_snapshot     jsonb,
  p_breakdown    jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.ai_credit_ledger%rowtype;
  v_day      integer;
  v_week     integer;
begin
  if p_credits < 0 then
    raise exception 'credits must not be negative';
  end if;
  perform pg_advisory_xact_lock(hashtext('ai_credits:' || p_user_id::text));

  -- Idempotent per job: a replay (a double press, a retried request) answers what it already did.
  select * into v_existing from public.ai_credit_ledger where job_id = p_job_id;
  if found then
    select day_used, week_used into v_day, v_week from public.ai_credit_usage(p_user_id, p_day_key, p_week_key);
    return jsonb_build_object('ok', true, 'idempotent', true, 'credits', v_existing.credits_reserved, 'status', v_existing.status, 'day_used', v_day, 'week_used', v_week);
  end if;

  select day_used, week_used into v_day, v_week from public.ai_credit_usage(p_user_id, p_day_key, p_week_key);
  if p_daily_limit >= 0 and v_day + p_credits > p_daily_limit then
    return jsonb_build_object('ok', false, 'reason', 'daily', 'day_used', v_day, 'week_used', v_week);
  end if;
  if p_weekly_limit >= 0 and v_week + p_credits > p_weekly_limit then
    return jsonb_build_object('ok', false, 'reason', 'weekly', 'day_used', v_day, 'week_used', v_week);
  end if;

  insert into public.ai_credit_ledger (user_id, job_id, feature, plan, credits_reserved, status, day_key, week_key, limits_snapshot, breakdown)
  values (p_user_id, p_job_id, p_feature, p_plan, p_credits, 'reserved', p_day_key, p_week_key, coalesce(p_snapshot, '{}'::jsonb), coalesce(p_breakdown, '{}'::jsonb));

  return jsonb_build_object('ok', true, 'idempotent', false, 'credits', p_credits, 'status', 'reserved', 'day_used', v_day + p_credits, 'week_used', v_week + p_credits);
end;
$$;

create or replace function public.settle_ai_credits(p_job_id uuid) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.ai_credit_ledger
     set status = 'settled', credits_consumed = credits_reserved, updated_at = now()
   where job_id = p_job_id and status = 'reserved';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.release_ai_credits(p_job_id uuid, p_reason text default null) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  -- Only a RESERVED row comes back: a settled job delivered its result and is not refunded here (an operator adjustment is a different path).
  update public.ai_credit_ledger
     set status = 'released', credits_refunded = credits_reserved, reason = coalesce(p_reason, reason), updated_at = now()
   where job_id = p_job_id and status = 'reserved';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

-- ── 4 · the start claim accepts the third funding source ───────────────────
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
  if p_funding not in ('balance', 'free', 'credits') then
    raise exception 'unknown funding source: %', p_funding;
  end if;
  perform pg_advisory_xact_lock(hashtext('ai_jobs:start:' || p_feature));

  select status into v_status from public.ai_jobs where id = p_job_id and user_id = p_user_id;
  if v_status is null or v_status <> 'queued' then
    return 'lost';
  end if;

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

-- ── 5 · who may call ────────────────────────────────────────────────────────
-- 🔴 REVOKE. POSTGRES GRANTS EXECUTE TO PUBLIC BY DEFAULT.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.ai_credit_usage(uuid, text, text)',
    'public.reserve_ai_credits(uuid, uuid, text, text, integer, integer, integer, text, text, jsonb, jsonb)',
    'public.settle_ai_credits(uuid)',
    'public.release_ai_credits(uuid, text)',
    'public.claim_ai_job_start(uuid, uuid, text, integer, integer, integer, bigint, jsonb, text, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- ── 6 · the complimentary count is the OPERATOR'S NOW, not the number frozen at grant ──
--
-- Found by the owner on 2026-09-21: the admin set 1 complimentary creation, a
-- member who had been granted 2 earlier used 1, and the pill still said
-- "1 remaining" — `granted` was written once at grant time and the consume
-- checked against it. The read and the consume now take the CURRENT count
-- (per site plan, from the AI Plans configuration, falling back to the
-- Character Replace setting): lowering it applies at once, raising it applies
-- at once, the row keeps counting uses. The 9-argument consume is dropped,
-- not overloaded (the 0164 lesson).
drop function if exists public.consume_free_use(uuid, text, uuid, text, text, integer, bigint, text, jsonb);

create or replace function public.consume_free_use(
  p_user_id       uuid,
  p_product       text,
  p_job_id        uuid,
  p_mode          text,
  p_quality       text,
  p_duration_ms   integer,
  p_normal_price  bigint,
  p_currency      text,
  p_snapshot      jsonb,
  p_granted       integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      public.ai_free_entitlements%rowtype;
  v_existing public.ai_free_uses%rowtype;
  v_cap      integer;
begin
  select * into v_row from public.ai_free_entitlements where user_id = p_user_id and product = p_product for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'none', 'remaining', 0);
  end if;
  -- the operator's current count when given; the granted number otherwise (an older caller)
  v_cap := coalesce(p_granted, v_row.granted);
  -- Idempotent per job: a retried /start finds the use it already made.
  select * into v_existing from public.ai_free_uses where job_id = p_job_id;
  if found then
    if v_existing.status = 'restored' then
      return jsonb_build_object('ok', false, 'reason', 'restored', 'remaining', greatest(0, v_cap - v_row.used));
    end if;
    return jsonb_build_object('ok', true, 'use_number', v_existing.use_number, 'remaining', greatest(0, v_cap - v_row.used), 'already', true);
  end if;
  if v_row.eligibility <> 'eligible' or v_row.used >= v_cap then
    return jsonb_build_object('ok', false, 'reason', 'exhausted', 'remaining', greatest(0, v_cap - v_row.used));
  end if;
  update public.ai_free_entitlements
     set used = used + 1, granted = greatest(granted, v_cap), consumed_at = now(), updated_at = now()
   where user_id = p_user_id and product = p_product
   returning * into v_row;
  insert into public.ai_free_uses (user_id, product, job_id, use_number, status, mode, quality, duration_ms, normal_price_cents, currency, pricing_snapshot)
  values (p_user_id, p_product, p_job_id, v_row.used, 'consumed', p_mode, p_quality, p_duration_ms, coalesce(p_normal_price, 0), coalesce(p_currency, 'USD'), p_snapshot);
  return jsonb_build_object('ok', true, 'use_number', v_row.used, 'remaining', greatest(0, v_cap - v_row.used));
end;
$$;

do $$
begin
  execute 'revoke all on function public.consume_free_use(uuid, text, uuid, text, text, integer, bigint, text, jsonb, integer) from public, anon, authenticated';
  execute 'grant execute on function public.consume_free_use(uuid, text, uuid, text, text, integer, bigint, text, jsonb, integer) to service_role';
end $$;

-- ── 7 · LAST: credits are a third way to pay for a job ─────────────────────
-- Added `not valid` (an instant lock, no table scan while it is held) and then
-- validated (ShareUpdateExclusive — live reads and writes carry on). Every
-- existing row is 'free', 'balance' or null, so validation cannot fail.
alter table public.ai_jobs drop constraint if exists ai_jobs_funding_source_chk;
alter table public.ai_jobs add constraint ai_jobs_funding_source_chk
  check (funding_source is null or funding_source in ('free', 'balance', 'credits')) not valid;
alter table public.ai_jobs validate constraint ai_jobs_funding_source_chk;

comment on column public.ai_jobs.funding_source is
  'How the job was paid for: free = a complimentary creation (Part 11), balance = the product wallet, credits = included AI-plan credits (0167). Read by every undo to choose the right release.';
