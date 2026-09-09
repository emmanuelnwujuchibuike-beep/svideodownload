-- ============================================================================
-- 0149 — Frenz AI: prepaid balance, and a ledger that explains it
-- ============================================================================
--
-- Owner, 2026-09-09, as a permanent architectural rule: "Free daily + free
-- weekly allowance → prepaid AI balance… Every balance change must have a
-- record. The ledger should make it possible to audit exactly how the user's
-- balance changed."
--
-- ── 🔴 EVERY AMOUNT IS AN INTEGER NUMBER OF CENTS ───────────────────────────
--
-- `bigint`, never `numeric` and never a float. Money in floating point drifts:
-- 0.1 + 0.2 is not 0.3, and a balance that is wrong by a fraction of a cent per
-- transaction is a ledger that stops reconciling — which is the single thing a
-- ledger exists to do. Dollars appear once, in the interface, on the way to a
-- screen.
--
-- ── 🔴 THE BALANCE IS A CACHE. THE LEDGER IS THE TRUTH ──────────────────────
--
-- `ai_balances.balance_cents` exists so a dashboard can read one row instead of
-- summing a member's whole history on every page load. It is only ever written
-- INSIDE the functions below, in the same statement that appends the ledger
-- row, so the two cannot disagree — and `ai_balance_ledger.balance_after_cents`
-- records what the cache became, so a drift would be visible rather than
-- silent.
--
-- Nothing outside these functions may UPDATE the balance. That is enforced by
-- the grants at the bottom: the table is not writable by anon or authenticated
-- at all.
--
-- ── 🔴 IDEMPOTENCY IS A UNIQUE INDEX, NOT A CHECK-THEN-WRITE ────────────────
--
-- "Never deduct money twice because of retries… A user must not be able to
-- replay an API request… to receive multiple AI generations while only paying
-- once."
--
-- Both directions are protected by a UNIQUE INDEX on the ledger, and both
-- functions rely on the insert failing rather than on having looked first:
--
--   · a top-up carries the Paystack reference, so a webhook delivered twice
--     inserts once;
--   · a job charge carries the job id and the entry kind, so a retried start
--     charges once.
--
-- A read-then-write would leave a window in which two concurrent requests both
-- see "not yet charged" and both charge. There is no such window here.
--
-- ── ORDERING (the law this project learned the hard way) ────────────────────
-- Every plain DDL statement comes FIRST; every dollar-quoted block LAST.
-- Migration 0130 applied PARTIALLY because plain DDL sat after a dollar-quoted
-- block, and Postgres reported success for the half it ran.
-- ============================================================================

create table if not exists public.ai_balances (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  balance_cents bigint not null default 0,
  updated_at    timestamptz not null default now(),
  -- 🔴 A balance can never go negative. If a deduction would take it below
  -- zero the function refuses; this constraint is the backstop that turns a
  -- future bug into a failed transaction instead of a member owing us money.
  constraint ai_balances_non_negative check (balance_cents >= 0)
);

create table if not exists public.ai_balance_ledger (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  -- Positive for a credit, negative for a charge. Signed so the ledger sums to
  -- the balance, which is what makes an audit a `sum()` rather than a case
  -- statement over `kind`.
  delta_cents         bigint not null,
  balance_after_cents bigint not null,
  -- topup | admin_credit | job_charge | job_refund
  kind                text not null,
  -- The job this entry belongs to, when it belongs to one.
  job_id              uuid references public.ai_jobs (id) on delete set null,
  -- 🔴 The idempotency key. A Paystack reference for a top-up; the job id for a
  -- charge or refund. Unique per (user, kind) — see the index below.
  reference           text,
  -- Free text for an admin credit: why it was given. Never shown to the member.
  note                text,
  -- Which admin issued a manual credit. Null for everything else.
  actor_admin_id      uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint ai_balance_ledger_kind_chk
    check (kind in ('topup', 'admin_credit', 'job_charge', 'job_refund')),
  -- A credit must credit and a charge must charge. This is the constraint that
  -- would catch a sign error before it reached a balance.
  constraint ai_balance_ledger_sign_chk check (
    (kind in ('topup', 'admin_credit', 'job_refund') and delta_cents > 0)
    or (kind = 'job_charge' and delta_cents < 0)
  )
);

-- 🔴 THE IDEMPOTENCY GUARANTEE. One entry per (user, kind, reference), so a
-- replayed webhook or a retried start collides instead of double-counting.
-- Partial, because `reference` is null for nothing today but must not become a
-- single-row bottleneck if a future entry kind has no natural key.
create unique index if not exists ai_balance_ledger_reference_uniq
  on public.ai_balance_ledger (user_id, kind, reference)
  where reference is not null;

-- The member's own history, newest first — the query the usage page runs.
create index if not exists ai_balance_ledger_user_idx
  on public.ai_balance_ledger (user_id, created_at desc);

alter table public.ai_balances enable row level security;
alter table public.ai_balance_ledger enable row level security;

-- ============================================================================
--  Dollar-quoted blocks LAST. Nothing but functions and policies below.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ai_balances' and policyname = 'ai_balances_select_own') then
    -- Read-only, and only your own. Every write goes through a function.
    create policy ai_balances_select_own on public.ai_balances
      for select using (auth.uid() = user_id);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'ai_balance_ledger' and policyname = 'ai_balance_ledger_select_own') then
    create policy ai_balance_ledger_select_own on public.ai_balance_ledger
      for select using (auth.uid() = user_id);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
--  credit_ai_balance — a top-up or an admin credit, applied exactly once
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.credit_ai_balance(
  p_user_id   uuid,
  p_amount    bigint,
  p_kind      text,
  p_reference text,
  p_note      text default null,
  p_admin_id  uuid default null
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'credit must be positive';
  end if;
  if p_kind not in ('topup', 'admin_credit', 'job_refund') then
    raise exception 'not a credit kind: %', p_kind;
  end if;

  /*
    🔴 THE IDEMPOTENCY CHECK IS THE INSERT, and it comes FIRST.

    Appending the ledger row before touching the balance means a duplicate
    reference raises a unique violation BEFORE any money moves. Doing it the
    other way round — credit, then try to record it — would leave the balance
    raised and the audit trail missing on exactly the delivery that was already
    counted.

    The `on conflict do nothing` + `not found` pair is what turns "this webhook
    arrived twice" into a no-op that still returns the correct current balance,
    rather than an error the caller has to interpret.
  */
  insert into public.ai_balance_ledger
    (user_id, delta_cents, balance_after_cents, kind, reference, note, actor_admin_id)
  values (p_user_id, p_amount, 0, p_kind, p_reference, p_note, p_admin_id)
  on conflict (user_id, kind, reference) where reference is not null do nothing;

  if not found then
    -- Already applied. Return what they have; change nothing.
    select balance_cents into v_balance from public.ai_balances where user_id = p_user_id;
    return coalesce(v_balance, 0);
  end if;

  insert into public.ai_balances (user_id, balance_cents, updated_at)
  values (p_user_id, p_amount, now())
  on conflict (user_id) do update
    set balance_cents = public.ai_balances.balance_cents + excluded.balance_cents,
        updated_at = now()
  returning balance_cents into v_balance;

  -- Record what the balance became, so a drift between cache and ledger is
  -- visible rather than silent.
  update public.ai_balance_ledger
     set balance_after_cents = v_balance
   where user_id = p_user_id and kind = p_kind and reference = p_reference;

  return v_balance;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
--  charge_ai_balance — reserve the price of one job, atomically
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.charge_ai_balance(
  p_user_id uuid,
  p_job_id  uuid,
  p_amount  bigint
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'charge cannot be negative';
  end if;

  -- A retried start for a job that has already paid must not pay twice.
  if exists (
    select 1 from public.ai_balance_ledger
     where user_id = p_user_id and kind = 'job_charge' and reference = p_job_id::text
  ) then
    select balance_cents into v_balance from public.ai_balances where user_id = p_user_id;
    return coalesce(v_balance, 0);
  end if;

  if p_amount = 0 then
    select balance_cents into v_balance from public.ai_balances where user_id = p_user_id;
    return coalesce(v_balance, 0);
  end if;

  /*
    🔴 THE DEDUCTION IS THE AUTHORISATION. One statement decrements the balance
    and requires it to stay non-negative; if the member cannot afford it, ZERO
    ROWS match and the function raises. There is no "check then deduct" window
    for two concurrent requests to both pass.
  */
  update public.ai_balances
     set balance_cents = balance_cents - p_amount,
         updated_at = now()
   where user_id = p_user_id
     and balance_cents >= p_amount
  returning balance_cents into v_balance;

  if v_balance is null then
    raise exception 'insufficient ai balance';
  end if;

  insert into public.ai_balance_ledger
    (user_id, delta_cents, balance_after_cents, kind, job_id, reference)
  values (p_user_id, -p_amount, v_balance, 'job_charge', p_job_id, p_job_id::text);

  return v_balance;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
--  refund_ai_charge — give it back when a paid job fails on our side
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.refund_ai_charge(
  p_user_id uuid,
  p_job_id  uuid
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charged bigint;
  v_balance bigint;
begin
  -- What was actually taken for this job, if anything.
  select -delta_cents into v_charged
    from public.ai_balance_ledger
   where user_id = p_user_id and kind = 'job_charge' and reference = p_job_id::text;

  -- A free job has nothing to refund, and that is not an error.
  if v_charged is null or v_charged <= 0 then
    select balance_cents into v_balance from public.ai_balances where user_id = p_user_id;
    return coalesce(v_balance, 0);
  end if;

  -- 🔴 Refunded at most once. The unique index on (user, kind, reference) is
  -- what enforces it; this is the same insert-first discipline as the credit.
  insert into public.ai_balance_ledger
    (user_id, delta_cents, balance_after_cents, kind, job_id, reference)
  values (p_user_id, v_charged, 0, 'job_refund', p_job_id, p_job_id::text)
  on conflict (user_id, kind, reference) where reference is not null do nothing;

  if not found then
    select balance_cents into v_balance from public.ai_balances where user_id = p_user_id;
    return coalesce(v_balance, 0);
  end if;

  update public.ai_balances
     set balance_cents = balance_cents + v_charged,
         updated_at = now()
   where user_id = p_user_id
  returning balance_cents into v_balance;

  update public.ai_balance_ledger
     set balance_after_cents = coalesce(v_balance, v_charged)
   where user_id = p_user_id and kind = 'job_refund' and reference = p_job_id::text;

  return coalesce(v_balance, 0);
end;
$$;

/*
  ═══════════════════════════════════════════════════════════════════════════
   🔴 REVOKE. POSTGRES GRANTS EXECUTE TO PUBLIC BY DEFAULT.
  ═══════════════════════════════════════════════════════════════════════════

  This project has already been bitten by exactly this: a `security definer`
  function taking a `p_user_id` argument, executable by `anon`, is a function
  any visitor can call with somebody else's id. Here that would mean crediting
  your own balance for free — `credit_ai_balance(me, 100000, 'admin_credit', …)`
  from a browser console.

  These three run ONLY as the service role, from server code that has already
  established who is asking.
*/
revoke all on function public.credit_ai_balance(uuid, bigint, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.charge_ai_balance(uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.refund_ai_charge(uuid, uuid) from public, anon, authenticated;
