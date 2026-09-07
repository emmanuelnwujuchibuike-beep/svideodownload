-- ============================================================================
-- 0141 — Frenz AI Part 2: the job system and its allowance
-- ============================================================================
--
-- Owner, 2026-09-07: the secure backend foundation for Frenz AI. Part 1 built
-- the AI Clean interface; this is the architecture that will later carry it.
-- No provider runs yet — nothing in this file processes anything.
--
-- Two tables, three functions, and one rule that matters more than the rest:
-- a member may READ their own jobs and may write NOTHING. Every insert and
-- every status change goes through the service role in an API route, because
-- the alternative is a browser that can mark its own job `completed`, hand
-- itself a `result_path`, or reset its own daily count.
--
-- ── 🔴 ORDERING (the law this project learned the hard way) ─────────────────
-- Every plain DDL statement comes FIRST; every dollar-quoted block — policies,
-- functions, grants, storage — comes LAST. Migration 0130 applied PARTIALLY
-- because plain DDL sat after a dollar-quoted block and silently did not run,
-- with no error anywhere. The grants below are therefore issued through
-- `execute` inside a DO block rather than as plain statements after the
-- functions they apply to. Do not interleave them.
--
-- Idempotent throughout.

-- ---------------------------------------------------------------------
-- 1 · ai_jobs — one row per unit of AI work, for every feature and provider
--
-- ── Why one table and not one per tool ───────────────────────────────────
-- `feature` is a column, not a table name. AI Clean is the first tool; image
-- clean, upscale, caption, background-remove and generate are all the same
-- lifecycle with a different worker on the end of it. A table per tool would
-- mean a new migration, a new RLS policy, a new set of indexes and a new
-- history query for each — and five chances to get the ownership rule wrong.
--
-- ── What `provider` records, and what `model_version` records ────────────
-- `provider` is who WILL run the job: decided by the server's feature registry
-- at creation (lib/ai/jobs.ts), never sent by the browser. `model` and
-- `model_version` are what ACTUALLY ran it, so they stay NULL until a provider
-- claims the job and pins its version. That distinction is the whole point of
-- storing the version at all: a provider that changes its default model must
-- not be able to rewrite the history of jobs it already ran.
-- ---------------------------------------------------------------------
create table if not exists public.ai_jobs (
  id                      uuid primary key default uuid_generate_v4(),
  user_id                 uuid not null references auth.users (id) on delete cascade,
  feature                 text not null,
  provider                text not null,
  model                   text,
  model_version           text,
  status                  text not null default 'queued',
  -- Idempotency. Supplied by the client, unique per member — see the index
  -- below and the note in app/api/ai/jobs/route.ts.
  client_request_id       text,
  -- Storage keys inside a PRIVATE bucket. Never a URL, never public, never
  -- accepted from the browser. Nothing writes these in Part 2.
  source_path             text,
  result_path             text,
  source_size             bigint,
  result_size             bigint,
  -- Seconds, with millisecond precision. Measured by the client from the file
  -- it chose, so it is a claim about the input, not a billing figure.
  source_duration         numeric(10, 3),
  source_mime_type        text,
  replicate_prediction_id text,
  -- A stable machine code from lib/ai/errors.ts, plus the operator-facing
  -- detail. The detail is never returned to the browser.
  error_code              text,
  error_message           text,
  created_at              timestamptz not null default now(),
  started_at              timestamptz,
  completed_at            timestamptz,
  -- When this job's files may be deleted. A later part's cleanup worker reads
  -- exactly this; nothing deletes anything today.
  expires_at              timestamptz,
  metadata                jsonb not null default '{}'::jsonb,

  -- A closed vocabulary, enforced by the database rather than by the code that
  -- happens to write it. `expired` is a terminal state a cleanup pass sets once
  -- the files are gone, distinct from `cancelled` (the member stopped it) and
  -- from `failed` (it ran and did not work).
  constraint ai_jobs_status_chk check (
    status in ('queued', 'processing', 'completed', 'failed', 'cancelled', 'expired')
  ),
  -- Declared here as well as in lib/ai/jobs.ts, deliberately: the registry
  -- decides what is OFFERED, this decides what can be STORED, and a bug in the
  -- first must not be able to write a feature nothing can read back.
  constraint ai_jobs_feature_chk check (
    feature in ('ai_clean', 'ai_image_clean', 'ai_upscale', 'ai_caption', 'ai_background_remove', 'ai_generate')
  ),
  constraint ai_jobs_provider_chk check (provider in ('replicate')),
  constraint ai_jobs_sizes_chk check (
    (source_size is null or source_size >= 0) and (result_size is null or result_size >= 0)
  ),
  constraint ai_jobs_client_request_id_chk check (
    client_request_id is null or char_length(client_request_id) between 8 and 100
  )
);

-- ---------------------------------------------------------------------
-- 2 · ai_usage_daily — the allowance, counted where it cannot be forged
--
-- ── Three counters, because a refund has to be auditable ─────────────────
-- `reserved_jobs` is what the CAP is measured against: it goes up when a job is
-- admitted and down only when a reservation is genuinely given back.
-- `successful_jobs` is how many actually finished — the number worth reporting.
-- `released_jobs` is how many were refunded, and it never goes down, which is
-- what makes an abusive reserve/release loop visible and stoppable (see
-- release_ai_usage's cap below).
--
-- The unique constraint is not decoration: it is the lock the atomic reserve
-- depends on. Two simultaneous requests for the last slot contend on this
-- index, one waits, and the second re-reads the row the first committed.
-- ---------------------------------------------------------------------
create table if not exists public.ai_usage_daily (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  -- UTC calendar day, matching the Redis download counter (lib/rate-limit.ts).
  -- One clock for every allowance in the product beats a per-feature timezone.
  usage_date      date not null,
  feature         text not null,
  reserved_jobs   integer not null default 0,
  successful_jobs integer not null default 0,
  released_jobs   integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ai_usage_daily_unique unique (user_id, usage_date, feature),
  constraint ai_usage_daily_counts_chk check (
    reserved_jobs >= 0 and successful_jobs >= 0 and released_jobs >= 0
  )
);

-- ---------------------------------------------------------------------
-- 3 · Indexes — one per query this system actually makes
-- ---------------------------------------------------------------------

-- The history page: this member's jobs, newest first, paged by created_at.
create index if not exists ai_jobs_user_created_idx
  on public.ai_jobs (user_id, created_at desc);

-- "Do I already have something running?" — the JOB_ALREADY_PROCESSING guard.
create index if not exists ai_jobs_user_status_idx
  on public.ai_jobs (user_id, status);

-- 🔴 UNIQUE, not a plain index. A provider webhook arrives carrying only its
-- own prediction id, and it must resolve to exactly ONE job: two rows sharing
-- one prediction id would let a single callback complete somebody else's work.
create unique index if not exists ai_jobs_prediction_idx
  on public.ai_jobs (replicate_prediction_id)
  where replicate_prediction_id is not null;

-- Idempotency, scoped to the member so one person's request id can never
-- collide with — or return — another person's job.
create unique index if not exists ai_jobs_idempotency_idx
  on public.ai_jobs (user_id, client_request_id)
  where client_request_id is not null;

-- The cleanup sweep a later part will run: due rows only, so the index stays
-- the size of the backlog rather than the size of the table.
create index if not exists ai_jobs_expires_idx
  on public.ai_jobs (expires_at)
  where expires_at is not null and status <> 'expired';

-- ai_usage_daily's read path is exactly its unique constraint, which already
-- provides the index. No second one.

-- ---------------------------------------------------------------------
-- 4 · Column documentation — read by anyone opening the table in a console
-- ---------------------------------------------------------------------
comment on table public.ai_jobs is
  'One row per unit of Frenz AI work. Members may SELECT their own rows and write none: every insert and status change is service-role only.';
comment on column public.ai_jobs.provider is
  'Who will run this job. Chosen by the server feature registry (lib/ai/jobs.ts), never accepted from the client.';
comment on column public.ai_jobs.model_version is
  'The pinned provider version that actually ran this job. NULL until a provider claims it, so history stays true when a provider changes its default.';
comment on column public.ai_jobs.source_path is
  'Key inside a PRIVATE bucket. Never a public URL, never accepted from the browser; reads go through a short-lived signed URL.';
comment on column public.ai_jobs.error_message is
  'Operator-facing detail. Never returned to a client — the client gets error_code and a written sentence.';
comment on column public.ai_jobs.expires_at is
  'When these job files may be deleted. A later part cleanup worker reads this; nothing deletes anything yet.';
comment on table public.ai_usage_daily is
  'Per-member, per-day, per-feature allowance. Written only by the reserve/consume/release functions, which are service-role only.';
comment on column public.ai_usage_daily.reserved_jobs is
  'What the daily cap is measured against. Raised when a job is admitted, lowered only by a genuine release.';
comment on column public.ai_usage_daily.released_jobs is
  'Refunds granted today. Never decreases — it is what makes an abusive reserve/release loop visible.';

-- ---------------------------------------------------------------------
-- 5 · Row Level Security
--
-- ai_jobs:        SELECT your own rows. No insert, update or delete policy
--                 exists for anyone, so a browser holding a valid session
--                 still cannot create a job, change a status, set a
--                 result_path or pick a provider. The API route does that with
--                 the service role after it has decided the caller may.
-- ai_usage_daily: NO policies at all — the same posture as `batch_sessions`
--                 and `reward_sessions`. A member must not be able to read or
--                 write their own allowance row; what is left of their
--                 allowance is returned by the API, which is a different thing
--                 from letting them at the counter.
-- ---------------------------------------------------------------------
alter table public.ai_jobs enable row level security;
alter table public.ai_usage_daily enable row level security;

-- =====================================================================
-- ⛔ EVERYTHING BELOW THIS LINE IS DOLLAR-QUOTED. Nothing plain may follow.
-- =====================================================================

do $$ begin
  create policy ai_jobs_select_own on public.ai_jobs
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- reserve_ai_usage — the atomic admission decision
--
-- 🔴 THE WHOLE FEATURE'S INTEGRITY IS THIS ONE STATEMENT.
--
-- The obvious implementation — read the count, compare it to the limit, then
-- increment — is wrong in a way that only shows up under load: two requests
-- both read "2 used", both decide there is room, and both write "3". The
-- member gets a fourth job for free, and the owner gets a fourth provider bill.
--
-- `insert … on conflict do update … where` cannot do that. The unique index
-- serializes the two statements: the second waits for the first to commit,
-- then re-evaluates its WHERE against the row the first left behind. When the
-- WHERE fails, the statement touches no rows and RETURNING yields nothing —
-- which is how a refusal is detected here, with no second read to race against.
--
-- The limit is passed in rather than read from a table on purpose: it comes
-- from the plan (lib/ai/entitlement.ts), which already resolves promos, admin
-- overrides and subscription state. One authority for what a plan is worth.
-- ---------------------------------------------------------------------
create or replace function public.reserve_ai_usage(
  p_user_id uuid,
  p_feature text,
  p_limit   integer
)
returns table (allowed boolean, used integer, remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_used  integer;
begin
  if p_user_id is null or p_feature is null then
    raise exception 'reserve_ai_usage requires a user and a feature';
  end if;

  -- A zero or negative limit means "this plan may not run this feature at all".
  -- Refuse without writing a row: an allowance of nothing is not a usage record.
  if p_limit <= 0 then
    return query select false, 0, 0;
    return;
  end if;

  insert into public.ai_usage_daily as u (user_id, usage_date, feature, reserved_jobs)
  values (p_user_id, v_today, p_feature, 1)
  on conflict (user_id, usage_date, feature) do update
     set reserved_jobs = u.reserved_jobs + 1,
         updated_at    = now()
   where u.reserved_jobs < p_limit
  returning u.reserved_jobs into v_used;

  if v_used is null then
    -- Refused. Report the true current figure rather than the limit, so an
    -- interface can say what was actually spent.
    select ud.reserved_jobs into v_used
      from public.ai_usage_daily ud
     where ud.user_id = p_user_id and ud.usage_date = v_today and ud.feature = p_feature;
    return query select false, coalesce(v_used, 0), 0;
    return;
  end if;

  return query select true, v_used, greatest(0, p_limit - v_used);
end $$;

-- ---------------------------------------------------------------------
-- consume_ai_usage — a reservation turned into a finished job
--
-- Deliberately does NOT touch `reserved_jobs`: the slot was already spent at
-- reservation time and the cap has been holding it ever since. Consuming only
-- records that the work actually landed, which is the number worth reporting
-- and the one a refund must never be able to inflate.
-- ---------------------------------------------------------------------
create or replace function public.consume_ai_usage(
  p_user_id uuid,
  p_feature text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  update public.ai_usage_daily
     set successful_jobs = successful_jobs + 1,
         updated_at      = now()
   where user_id = p_user_id
     and usage_date = (now() at time zone 'utc')::date
     and feature = p_feature;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

-- ---------------------------------------------------------------------
-- release_ai_usage — giving a slot back, but only so many times
--
-- A job that failed because OUR infrastructure or the provider fell over must
-- not cost a member one of three daily runs. That is the whole reason this
-- exists.
--
-- 🔴 And it is exactly the function an abuser would want. Start a job, make it
-- fail, get the slot back, repeat: unlimited provider spend from a free
-- account. So refunds are capped per day (`p_max_releases`), and the release is
-- ALWAYS recorded even when it is not granted — the counter that stops the loop
-- is also the evidence that someone tried it.
--
-- A day the member spends entirely inside the cap never comes near this.
-- ---------------------------------------------------------------------
create or replace function public.release_ai_usage(
  p_user_id       uuid,
  p_feature       text,
  p_max_releases  integer
)
returns table (released boolean, reserved integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reserved integer;
  v_granted  boolean;
begin
  update public.ai_usage_daily as u
     set reserved_jobs = case
           when u.released_jobs < p_max_releases then greatest(0, u.reserved_jobs - 1)
           else u.reserved_jobs
         end,
         -- Recorded either way. See the note above.
         released_jobs = u.released_jobs + 1,
         updated_at    = now()
   where u.user_id = p_user_id
     and u.usage_date = (now() at time zone 'utc')::date
     and u.feature = p_feature
  returning (u.released_jobs <= p_max_releases), u.reserved_jobs
       into v_granted, v_reserved;

  if v_reserved is null then
    -- Nothing to give back: no row for today. Not an error — a job created
    -- before midnight and released after it lands here, and inventing a
    -- negative count would be worse than declining the refund.
    return query select false, 0;
    return;
  end if;

  return query select coalesce(v_granted, false), v_reserved;
end $$;

-- ---------------------------------------------------------------------
-- 🔴 GRANTS — the step that is easy to forget and expensive to skip
--
-- Postgres grants EXECUTE on a new function to PUBLIC by default. Left alone,
-- any browser holding an anon or authenticated key could call these through
-- PostgREST — and every one of them takes `p_user_id` as an argument. That is
-- "burn a stranger's allowance" and "refund my own, forever" in one line of
-- JavaScript. SECURITY DEFINER makes it worse, not better: the function would
-- run with the owner's rights.
--
-- Issued through `execute` inside this block rather than as plain statements
-- because plain DDL may not follow a dollar-quoted block in this project — see
-- the ordering law at the top of the file.
-- ---------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.reserve_ai_usage(uuid, text, integer)',
    'public.consume_ai_usage(uuid, text)',
    'public.release_ai_usage(uuid, text, integer)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    begin
      execute format('revoke all on function %s from anon, authenticated', fn);
    exception when undefined_object then null; -- roles absent outside Supabase
    end;
    begin
      execute format('grant execute on function %s to service_role', fn);
    exception when undefined_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Private storage for AI material
--
-- Two buckets, both PRIVATE, and neither has a single RLS policy on
-- storage.objects — so a member cannot list, read or write them with their own
-- key at all. Access will be one short-lived signed URL per file, minted by a
-- route that has already checked the job belongs to the caller.
--
-- Kept separate from `post-media` (public, CDN-served) on purpose: that bucket
-- exists to be fetched by anyone with the link, which is the exact opposite of
-- what someone's unpublished video needs.
--
-- Wrapped so a permissions difference between environments cannot abort the
-- migration — the tables above matter more than the buckets, and a bucket is
-- one dashboard click to add. `raise notice` leaves a trace when it is skipped.
-- ---------------------------------------------------------------------
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('frenz-ai-source', 'frenz-ai-source', false)
  on conflict (id) do nothing;

  insert into storage.buckets (id, name, public)
  values ('frenz-ai-results', 'frenz-ai-results', false)
  on conflict (id) do nothing;
exception when others then
  raise notice 'Frenz AI storage buckets not created (%). Create them privately by hand.', sqlerrm;
end $$;
