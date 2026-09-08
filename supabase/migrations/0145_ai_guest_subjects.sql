-- ============================================================================
-- 0145 — AI Clean for people who have not signed in
-- ============================================================================
--
-- Owner, 2026-09-08 (the Video Text Remover access brief):
--
--   "The 2/day guest allowance must work without requiring account creation or
--    login… Do not force users to sign up before they can try the AI."
--
-- Everything Part 2 built assumed a `user_id`. This makes the same machinery
-- work for a subject that has no account, WITHOUT forking it: the reservation
-- is still one atomic statement, the cap is still measured in one column, and
-- there is still exactly one function that decides whether a job may start.
--
-- ── 🔴 A SECOND CODE PATH WOULD HAVE BEEN THE BUG ───────────────────────────
--
-- The obvious shape is `reserve_guest_usage` beside `reserve_ai_usage`. It is
-- also how the guest path silently stops being exercised, and how the two
-- drift until one of them forgets a cap. So the existing functions gain a
-- guest argument by OVERLOAD — same name, same body, one more parameter —
-- which also means the deploy is safe in either order: the old 3-argument
-- signature keeps working for already-running code until the new build lands.
--
-- ── ORDERING (the law this project learned the hard way) ────────────────────
-- Every plain DDL statement comes FIRST; every dollar-quoted block LAST.
-- Migration 0130 applied PARTIALLY because plain DDL sat after a dollar-quoted
-- block and silently did not run, with no error anywhere.
--
-- Idempotent throughout.

-- ---------------------------------------------------------------------
-- 1 · ai_usage_daily learns about subjects that are not users
--
-- `user_id` becomes nullable and `guest_id` appears beside it. Exactly one is
-- ever set, enforced by a CHECK rather than by the code that happens to write
-- the row.
--
-- 🔴 NULLs are DISTINCT in a unique constraint, so the existing
-- `ai_usage_daily_unique (user_id, usage_date, feature)` stops constraining
-- guest rows entirely the moment user_id can be null — every guest row would
-- look unique to it. That is why the partial index below is not optional: it
-- is the lock the atomic guest reservation depends on, exactly as the original
-- constraint is for members.
-- ---------------------------------------------------------------------
alter table public.ai_usage_daily alter column user_id drop not null;
alter table public.ai_usage_daily add column if not exists guest_id text;

-- Set when a day-scoped reward has unlocked this feature for this subject
-- today. See `unlock_ai_day` — this is what lets ONE ad cover a paid member's
-- whole day instead of one ad per generation.
alter table public.ai_usage_daily add column if not exists reward_unlocked_at timestamptz;

alter table public.ai_usage_daily drop constraint if exists ai_usage_daily_subject_chk;
alter table public.ai_usage_daily add constraint ai_usage_daily_subject_chk check (
  (user_id is not null and guest_id is null) or (user_id is null and guest_id is not null)
);

-- A guest identifier is 22 base64url characters, or an `ip:` ceiling key of the
-- same shape. Bounded so a hostile cookie cannot become a wide index entry.
alter table public.ai_usage_daily drop constraint if exists ai_usage_daily_guest_id_chk;
alter table public.ai_usage_daily add constraint ai_usage_daily_guest_id_chk check (
  guest_id is null or char_length(guest_id) between 8 and 64
);

create unique index if not exists ai_usage_daily_guest_uq
  on public.ai_usage_daily (guest_id, usage_date, feature)
  where guest_id is not null;

comment on column public.ai_usage_daily.guest_id is
  'Server-minted, HMAC-signed identifier for a signed-out visitor, or an ip: ceiling key. Never accepted from a browser — see lib/ai/subject.ts.';
comment on column public.ai_usage_daily.reward_unlocked_at is
  'When a DAY-scoped rewarded ad unlocked this feature for this subject today. Paid plans watch one ad per day, not one per generation.';

-- ---------------------------------------------------------------------
-- 2 · ai_jobs learns the same thing
-- ---------------------------------------------------------------------
alter table public.ai_jobs alter column user_id drop not null;
alter table public.ai_jobs add column if not exists guest_id text;

alter table public.ai_jobs drop constraint if exists ai_jobs_subject_chk;
alter table public.ai_jobs add constraint ai_jobs_subject_chk check (
  (user_id is not null and guest_id is null) or (user_id is null and guest_id is not null)
);

alter table public.ai_jobs drop constraint if exists ai_jobs_guest_id_chk;
alter table public.ai_jobs add constraint ai_jobs_guest_id_chk check (
  guest_id is null or char_length(guest_id) between 8 and 64
);

-- The guest equivalents of the two member indexes from 0141: "my jobs, newest
-- first" and "do I already have one running".
create index if not exists ai_jobs_guest_created_idx
  on public.ai_jobs (guest_id, created_at desc) where guest_id is not null;
create index if not exists ai_jobs_guest_status_idx
  on public.ai_jobs (guest_id, status) where guest_id is not null;

-- Idempotency, scoped to the guest exactly as it is to the member.
create unique index if not exists ai_jobs_guest_idempotency_idx
  on public.ai_jobs (guest_id, client_request_id)
  where guest_id is not null and client_request_id is not null;

comment on column public.ai_jobs.guest_id is
  'Owner of this job when nobody was signed in. Exactly one of user_id/guest_id is set.';

-- ---------------------------------------------------------------------
-- 3 · ai_guest_links — a guest identity, once it has an account
--
-- 🔴 THIS IS WHAT CLOSES THE SIGN-UP BYPASS.
--
--   "A guest uses 1/2, then signs up… Do NOT accidentally give them another
--    fresh 2 generations. Likewise, if a signed-in Free user logs out, they
--    should not receive another fresh guest allowance for the same day."
--
-- Both halves are the same fact stated twice, so they get ONE mechanism: the
-- guest identifier is permanently bound to the account that claimed it. From
-- then on it RESOLVES to that account — signed in or not, this browser spends
-- the member's allowance, because it is the member's browser.
--
-- Primary key on guest_id, so a second sign-in with the same cookie is a no-op
-- rather than a re-merge; `link_ai_guest` folds the day's counts across exactly
-- once, on the insert that actually happened.
-- ---------------------------------------------------------------------
create table if not exists public.ai_guest_links (
  guest_id   text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  linked_at  timestamptz not null default now(),
  -- Whether the day's guest counters were folded into the member's row. Only
  -- ever true for the day of the link; a guest who signed up yesterday brings
  -- nothing across today, because yesterday's allowance is not today's.
  merged     boolean not null default false,
  constraint ai_guest_links_guest_id_chk check (char_length(guest_id) between 8 and 64)
);

create index if not exists ai_guest_links_user_idx on public.ai_guest_links (user_id);

comment on table public.ai_guest_links is
  'Binds a signed-out browser identity to the account that claimed it, so signing up (or back out) never grants a second daily allowance.';

-- ---------------------------------------------------------------------
-- 3b · reward_sessions learns about guests too
--
-- 0117 already made `user_id` nullable with an `ip_hash` beside it for
-- signed-out download rewards. AI Clean needs something stronger than an
-- address: a guest's allowance is keyed by their signed identifier, so their
-- REWARD must be bound to the same thing, or two people behind one NAT could
-- spend each other's ads.
--
-- `ip_hash` is left exactly as it is — the download reward flow still uses it
-- and nothing here touches that path.
-- ---------------------------------------------------------------------
alter table public.reward_sessions add column if not exists guest_id text;

alter table public.reward_sessions drop constraint if exists reward_sessions_guest_id_chk;
alter table public.reward_sessions add constraint reward_sessions_guest_id_chk check (
  guest_id is null or char_length(guest_id) between 8 and 64
);

create index if not exists reward_sessions_guest_open_idx
  on public.reward_sessions (guest_id, status, expires_at)
  where type = 'ai_clean' and guest_id is not null and consumed_at is null;

comment on column public.reward_sessions.guest_id is
  'Signed-out owner of an AI reward, matching ai_usage_daily.guest_id. Stronger than ip_hash: two visitors behind one NAT cannot spend each other''s rewards.';

-- ---------------------------------------------------------------------
-- 4 · RLS
--
-- ai_guest_links: NO policies at all — the same posture as ai_usage_daily and
-- reward_sessions. A browser must never be able to read which account a guest
-- identifier belongs to, or write a link that would let it spend somebody
-- else's allowance. Every access is service-role, from a route that has already
-- decided the caller may.
--
-- ai_jobs keeps its existing `select own` policy for members. Guest rows are
-- NOT readable under RLS by anyone — a guest holds no Supabase session, so
-- their reads necessarily go through the API with the service role, where the
-- route matches the signed cookie itself.
-- ---------------------------------------------------------------------
alter table public.ai_guest_links enable row level security;

-- ---------------------------------------------------------------------
-- 5 · The functions. Everything below is dollar-quoted — nothing plain follows.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- reserve_ai_usage (4-arg overload) — one atomic admission, two ceilings
--
-- The 3-argument version from 0141 is untouched and still works. This one adds
-- a guest subject and a per-IP ceiling.
--
-- 🔴 WHY THE IP CEILING LIVES INSIDE THIS FUNCTION.
--
-- It has to be the same transaction. Two statements from the route — "take an
-- IP slot", then "take a subject slot" — can interleave with another request
-- between them, and a compensating decrement issued after a crash never runs
-- at all. Inside one function both increments commit together or neither does,
-- and the compensating update below is against a row this transaction already
-- holds a lock on.
--
-- ⚠️ The ceiling is deliberately generous (see AI_GUEST_IP_DAILY_CEILING).
-- Carrier-grade NAT means thousands of unrelated people share one address in
-- this product's biggest markets; metering them as one visitor would break the
-- feature for a whole network to stop one script.
-- ---------------------------------------------------------------------
create or replace function public.reserve_ai_usage(
  p_user_id  uuid,
  p_guest_id text,
  p_feature  text,
  p_limit    integer,
  p_ip_key   text default null,
  p_ip_limit integer default 0
)
returns table (allowed boolean, used integer, remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today   date := (now() at time zone 'utc')::date;
  v_used    integer;
  v_ip_used integer;
begin
  if p_feature is null then
    raise exception 'reserve_ai_usage requires a feature';
  end if;
  -- Exactly one subject. Both or neither is a caller bug and must not silently
  -- meter the wrong thing.
  if (p_user_id is null) = (p_guest_id is null) then
    raise exception 'reserve_ai_usage requires exactly one of user_id/guest_id';
  end if;

  -- A zero or negative limit means "not offered". Refuse without writing a
  -- row: an allowance of nothing is not a usage record.
  if p_limit <= 0 then
    return query select false, 0, 0;
    return;
  end if;

  -- ── the subject's own allowance ──────────────────────────────────────────
  if p_user_id is not null then
    insert into public.ai_usage_daily as u (user_id, usage_date, feature, reserved_jobs)
    values (p_user_id, v_today, p_feature, 1)
    on conflict (user_id, usage_date, feature) do update
       set reserved_jobs = u.reserved_jobs + 1,
           updated_at    = now()
     where u.reserved_jobs < p_limit
    returning u.reserved_jobs into v_used;

    if v_used is null then
      select ud.reserved_jobs into v_used
        from public.ai_usage_daily ud
       where ud.user_id = p_user_id and ud.usage_date = v_today and ud.feature = p_feature;
      return query select false, coalesce(v_used, 0), 0;
      return;
    end if;
  else
    insert into public.ai_usage_daily as u (guest_id, usage_date, feature, reserved_jobs)
    values (p_guest_id, v_today, p_feature, 1)
    on conflict (guest_id, usage_date, feature) where guest_id is not null do update
       set reserved_jobs = u.reserved_jobs + 1,
           updated_at    = now()
     where u.reserved_jobs < p_limit
    returning u.reserved_jobs into v_used;

    if v_used is null then
      select ud.reserved_jobs into v_used
        from public.ai_usage_daily ud
       where ud.guest_id = p_guest_id and ud.usage_date = v_today and ud.feature = p_feature;
      return query select false, coalesce(v_used, 0), 0;
      return;
    end if;
  end if;

  -- ── the address ceiling, in the SAME transaction ─────────────────────────
  if p_ip_key is not null and p_ip_limit > 0 then
    insert into public.ai_usage_daily as u (guest_id, usage_date, feature, reserved_jobs)
    values (p_ip_key, v_today, p_feature, 1)
    on conflict (guest_id, usage_date, feature) where guest_id is not null do update
       set reserved_jobs = u.reserved_jobs + 1,
           updated_at    = now()
     where u.reserved_jobs < p_ip_limit
    returning u.reserved_jobs into v_ip_used;

    if v_ip_used is null then
      -- Over the ceiling. Hand the subject's slot back — this row is already
      -- locked by the statement above, so nothing can have read the increment.
      if p_user_id is not null then
        update public.ai_usage_daily
           set reserved_jobs = greatest(0, reserved_jobs - 1), updated_at = now()
         where user_id = p_user_id and usage_date = v_today and feature = p_feature;
      else
        update public.ai_usage_daily
           set reserved_jobs = greatest(0, reserved_jobs - 1), updated_at = now()
         where guest_id = p_guest_id and usage_date = v_today and feature = p_feature;
      end if;
      return query select false, greatest(0, v_used - 1), 0;
      return;
    end if;
  end if;

  return query select true, v_used, greatest(0, p_limit - v_used);
end $$;

-- ---------------------------------------------------------------------
-- consume_ai_usage / release_ai_usage — the guest overloads
--
-- Same bodies as 0141, one more branch for which column identifies the row.
--
-- 🔴 A REFUND DOES NOT GIVE THE ADDRESS CEILING BACK, DELIBERATELY.
--
-- The subject's allowance measures what a person GOT, so a failure that was
-- ours must return it. The `ip:` ceiling measures how many attempts came from
-- one address, which is a different question, and attempts are exactly what an
-- abuse ceiling is counting. Refunding it would also hand an attacker the
-- reset: fail a job on purpose, get the ceiling back, repeat — the loop that
-- `p_max_releases` exists to stop, reopened at the level below it.
-- ---------------------------------------------------------------------
create or replace function public.consume_ai_usage(
  p_user_id  uuid,
  p_guest_id text,
  p_feature  text
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
   where usage_date = (now() at time zone 'utc')::date
     and feature = p_feature
     and ((p_user_id is not null and user_id = p_user_id)
       or (p_user_id is null and guest_id = p_guest_id));
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

create or replace function public.release_ai_usage(
  p_user_id      uuid,
  p_guest_id     text,
  p_feature      text,
  p_max_releases integer
)
returns table (released boolean, reserved integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today    date := (now() at time zone 'utc')::date;
  v_released integer;
  v_reserved integer;
begin
  -- 🔴 The release is ALWAYS recorded, granted or not. The counter that stops
  -- a deliberate fail-and-retry loop is also the evidence that somebody tried
  -- it — see the note on this function in 0141.
  update public.ai_usage_daily
     set released_jobs = released_jobs + 1,
         reserved_jobs = case when released_jobs < p_max_releases
                              then greatest(0, reserved_jobs - 1)
                              else reserved_jobs end,
         updated_at    = now()
   where usage_date = v_today
     and feature = p_feature
     and ((p_user_id is not null and user_id = p_user_id)
       or (p_user_id is null and guest_id = p_guest_id))
  returning released_jobs, reserved_jobs into v_released, v_reserved;

  if v_released is null then
    return query select false, 0;
    return;
  end if;
  return query select v_released <= p_max_releases, v_reserved;
end $$;

-- ---------------------------------------------------------------------
-- unlock_ai_day — ONE rewarded ad covers the rest of today
--
--   "Pro / Business / Max AI: one reward ad should unlock the applicable
--    daily/session allowance… Do not show an ad after the generation has
--    already been unlocked."
--
-- 🔴 It grants NO allowance. It only records that the ad was watched, so the
-- cap is still the cap and a replayed unlock cannot buy a sixth generation —
-- it can only re-state a permission that is already true. That is why this is
-- safe to make idempotent, and why `coalesce` leaves the FIRST timestamp
-- standing: the interface asks "was today unlocked", never "when".
--
-- Creates the row if today has none, so an unlock can precede the first job.
-- ---------------------------------------------------------------------
create or replace function public.unlock_ai_day(
  p_user_id  uuid,
  p_guest_id text,
  p_feature  text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
begin
  if (p_user_id is null) = (p_guest_id is null) then
    raise exception 'unlock_ai_day requires exactly one of user_id/guest_id';
  end if;

  if p_user_id is not null then
    insert into public.ai_usage_daily as u (user_id, usage_date, feature, reward_unlocked_at)
    values (p_user_id, v_today, p_feature, now())
    on conflict (user_id, usage_date, feature) do update
       set reward_unlocked_at = coalesce(u.reward_unlocked_at, now()),
           updated_at         = now();
  else
    insert into public.ai_usage_daily as u (guest_id, usage_date, feature, reward_unlocked_at)
    values (p_guest_id, v_today, p_feature, now())
    on conflict (guest_id, usage_date, feature) where guest_id is not null do update
       set reward_unlocked_at = coalesce(u.reward_unlocked_at, now()),
           updated_at         = now();
  end if;
  return true;
end $$;

-- ---------------------------------------------------------------------
-- link_ai_guest — the browser now belongs to an account
--
-- Called the first time an authenticated AI request arrives carrying a guest
-- cookie. Two things happen, once, atomically:
--
--   1. the identifier is bound to the account, permanently. From then on this
--      browser resolves to the member EVEN WHEN SIGNED OUT, which is what
--      stops "log out for a fresh two";
--   2. today's guest usage is folded into the member's row, which is what
--      stops "sign up for a fresh two".
--
-- 🔴 The fold takes the MAXIMUM, not the sum. A guest who used 1 and a member
-- who used 2 is one person who has used 2 today, not 3 — charging them for
-- both sides of their own sign-up would be punishing the exact action we asked
-- them to take. Taking the max closes the bypass without ever inventing usage.
--
-- `merged` guards the fold, and the primary key guards the link, so a second
-- call with the same pair does nothing at all.
-- ---------------------------------------------------------------------
create or replace function public.link_ai_guest(
  p_user_id  uuid,
  p_guest_id text,
  p_feature  text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today      date := (now() at time zone 'utc')::date;
  v_rows       integer := 0;
  v_guest_used integer;
  v_guest_unlock timestamptz;
begin
  if p_user_id is null or p_guest_id is null then
    return false;
  end if;

  insert into public.ai_guest_links (guest_id, user_id)
  values (p_guest_id, p_user_id)
  on conflict (guest_id) do nothing;

  -- `row_count` is an INTEGER. Assigning it to a boolean is a runtime error in
  -- plpgsql, not a compile one, so it would have failed on the first real
  -- sign-in rather than at deploy.
  get diagnostics v_rows = row_count;
  -- Already linked — to this account or (much more rarely) a shared device's
  -- previous one. Either way there is nothing to fold: the day's counts moved
  -- across when the link was made.
  if v_rows = 0 then
    return false;
  end if;

  select reserved_jobs, reward_unlocked_at into v_guest_used, v_guest_unlock
    from public.ai_usage_daily
   where guest_id = p_guest_id and usage_date = v_today and feature = p_feature;

  if coalesce(v_guest_used, 0) > 0 or v_guest_unlock is not null then
    insert into public.ai_usage_daily as u (user_id, usage_date, feature, reserved_jobs, reward_unlocked_at)
    values (p_user_id, v_today, p_feature, coalesce(v_guest_used, 0), v_guest_unlock)
    on conflict (user_id, usage_date, feature) do update
       set reserved_jobs      = greatest(u.reserved_jobs, coalesce(v_guest_used, 0)),
           reward_unlocked_at = coalesce(u.reward_unlocked_at, v_guest_unlock),
           updated_at         = now();
  end if;

  update public.ai_guest_links set merged = true where guest_id = p_guest_id;
  return true;
end $$;

-- ---------------------------------------------------------------------
-- claim_ai_reward (4-arg overload) — a guest spends their ad
--
-- Same compare-and-set as 0143: every condition lives INSIDE the UPDATE, so
-- two tabs claiming one reward do not race a check — the second UPDATE simply
-- matches no row. The only addition is which column identifies the owner.
--
-- 🔴 The subject match is not a formality. Without `guest_id = p_guest_id` in
-- the WHERE, any visitor holding a session id could spend a reward earned by
-- somebody else — and session ids travel through a browser.
-- ---------------------------------------------------------------------
create or replace function public.claim_ai_reward(
  p_session_id uuid,
  p_user_id    uuid,
  p_guest_id   text,
  p_feature    text
)
returns table (claimed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  update public.reward_sessions
     set consumed_at = now()
   where id = p_session_id
     and type = p_feature
     and status = 'granted'
     and consumed_at is null
     and expires_at > now()
     and ((p_user_id is not null and user_id = p_user_id)
       or (p_user_id is null and guest_id is not null and guest_id = p_guest_id));

  get diagnostics v_updated = row_count;

  if v_updated = 1 then
    return query select true, 'claimed'::text;
    return;
  end if;

  -- Worked out only for the LOG. The caller answers with one sentence either
  -- way, because telling somebody which check they failed tells an attacker.
  return query
    select false,
           case
             when not exists (select 1 from public.reward_sessions where id = p_session_id) then 'no-such-session'
             when exists (select 1 from public.reward_sessions
                           where id = p_session_id and consumed_at is not null) then 'already-consumed'
             when exists (select 1 from public.reward_sessions
                           where id = p_session_id and expires_at <= now()) then 'expired'
             when exists (select 1 from public.reward_sessions
                           where id = p_session_id and status <> 'granted') then 'not-granted'
             when exists (select 1 from public.reward_sessions
                           where id = p_session_id and type is distinct from p_feature) then 'wrong-feature'
             else 'wrong-user'
           end::text;
end $$;

-- ---------------------------------------------------------------------
-- 6 · Grants
--
-- 🔴 POSTGRES GRANTS EXECUTE ON A NEW FUNCTION TO PUBLIC BY DEFAULT.
--
-- Every one of these is `security definer` and takes a subject as an argument,
-- so a browser able to call one could spend anybody's allowance, unlock
-- anybody's day, or bind its own cookie to somebody else's account. Revoked
-- from every role a browser can hold, granted only to service_role.
--
-- Issued through `execute` inside a DO block rather than as plain statements,
-- because plain DDL after a dollar-quoted block is the 0130 partial-apply trap.
-- ---------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.reserve_ai_usage(uuid, text, text, integer, text, integer)',
    'public.consume_ai_usage(uuid, text, text)',
    'public.release_ai_usage(uuid, text, text, integer)',
    'public.unlock_ai_day(uuid, text, text)',
    'public.link_ai_guest(uuid, text, text)',
    'public.claim_ai_reward(uuid, uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
