-- 0154 · A PRODUCT wallet — Character Replace's own balance and ledger.
--
-- Owner, 2026-09-13 (Part 3): "Character Replace MUST have its own balance…
-- The existing AI Clean Balance must remain independent. Do NOT silently
-- combine the two."
--
-- The existing wallet (0149: ai_balances, ai_balance_ledger) is keyed by
-- MEMBER alone — one balance per person, no product column, and its three
-- functions take no product. Extending it in place would mean changing the
-- signatures every existing caller uses (the Paystack webhook, verify, the
-- admin credit route, the AI Clean funding path), which the same brief
-- forbids: "Do NOT modify the existing AI Clean pricing/recharge system."
--
-- So this is a SECOND, isolated structure with a `product` dimension, built to
-- the same rules the first one was verified against on 2026-09-07/09-13:
--
--   · every write goes through a SECURITY DEFINER function, revoked from
--     anon and authenticated (a security definer with a p_user_id argument is
--     "anyone spends anyone's balance" until revoked);
--   · a credit's idempotency IS the ledger insert — unique on
--     (user, product, kind, reference), inserted BEFORE the balance moves;
--   · a charge's authorisation IS the deduction — one UPDATE with
--     `balance_cents >= amount` in its WHERE, so two concurrent requests
--     cannot both be told they can afford the last naira;
--   · a refund happens at most once per charge, by the same unique index.
--
-- What is NEW here, for the reservation architecture (§16/§27):
--
--   · `status` on a ledger row: a processing charge is written `reserved`,
--     becomes `settled` when the job completes, `refunded` when it fails.
--     The balance moves at reservation (the money is not available to a
--     second job) and moves back only through `refund_product_charge`.
--   · `snapshot` (jsonb): the immutable pricing snapshot the charge was made
--     under — rates, version, total — so a price change tomorrow never
--     rewrites what was charged today (§15).
--   · `adjust_product_balance`: the audited manual credit/debit (§18).
--
-- Plain DDL, functions, then the revokes inside ONE `do $$` block with
-- `execute` at the very end — the 0130 lesson (DDL after a dollar-quoted body
-- can be skipped) and the 0141 pattern, kept on purpose.

create table if not exists public.ai_product_balances (
  user_id       uuid not null references auth.users (id) on delete cascade,
  product       text not null,
  balance_cents bigint not null default 0,
  currency      text not null default 'NGN',
  updated_at    timestamptz not null default now(),
  primary key (user_id, product),
  constraint ai_product_balances_non_negative check (balance_cents >= 0),
  constraint ai_product_balances_product_chk check (product in ('character_replace'))
);

create table if not exists public.ai_product_ledger (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  product             text not null,
  kind                text not null,
  status              text not null default 'settled',
  delta_cents         bigint not null,
  balance_after_cents bigint not null,
  currency            text not null default 'NGN',
  job_id              uuid references public.ai_jobs (id) on delete set null,
  reference           text,
  snapshot            jsonb,
  note                text,
  actor_admin_id      uuid references auth.users (id) on delete set null,
  metadata            jsonb,
  -- The once-only claim for a deposit announcement (push + receipt), the same
  -- shape as ai_balance_ledger.notified_at (0151).
  notified_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint ai_product_ledger_product_chk check (product in ('character_replace')),
  constraint ai_product_ledger_kind_chk
    check (kind in ('recharge', 'processing_charge', 'refund', 'adjustment', 'reversal')),
  constraint ai_product_ledger_status_chk
    check (status in ('settled', 'reserved', 'refunded', 'reversed')),
  -- A recharge and a refund add; a charge and a reversal subtract; an
  -- adjustment is signed by the admin who made it.
  constraint ai_product_ledger_sign_chk check (
    (kind in ('recharge', 'refund') and delta_cents > 0)
    or (kind in ('processing_charge', 'reversal') and delta_cents < 0)
    or (kind = 'adjustment' and delta_cents <> 0)
  )
);

create unique index if not exists ai_product_ledger_reference_uniq
  on public.ai_product_ledger (user_id, product, kind, reference)
  where reference is not null;

create index if not exists ai_product_ledger_user_idx
  on public.ai_product_ledger (user_id, product, created_at desc);

create index if not exists ai_product_ledger_job_idx
  on public.ai_product_ledger (job_id)
  where job_id is not null;

alter table public.ai_product_balances enable row level security;
alter table public.ai_product_ledger enable row level security;

comment on table public.ai_product_balances is
  'One prepaid balance per member PER PRODUCT (Character Replace first). Members may SELECT their own row and write none; every movement is a service-role function call that also appends to ai_product_ledger.';
comment on table public.ai_product_ledger is
  'Every movement of a product balance. `status` carries the reservation lifecycle of a processing charge (reserved → settled | refunded); `snapshot` is the immutable pricing snapshot it was charged under.';

-- Members read their own rows; nobody writes through the API.
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ai_product_balances' and policyname = 'ai_product_balances_select_own') then
    create policy ai_product_balances_select_own on public.ai_product_balances
      for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ai_product_ledger' and policyname = 'ai_product_ledger_select_own') then
    create policy ai_product_ledger_select_own on public.ai_product_ledger
      for select using (auth.uid() = user_id);
  end if;
end $$;

-- ── credit: recharge / refund-by-reference / anything positive with a reference ──
create or replace function public.credit_product_balance(
  p_user_id   uuid,
  p_product   text,
  p_amount    bigint,
  p_kind      text,
  p_reference text,
  p_currency  text default 'NGN',
  p_note      text default null,
  p_admin_id  uuid default null,
  p_metadata  jsonb default null
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
  if p_kind not in ('recharge', 'refund') then
    raise exception 'not a credit kind: %', p_kind;
  end if;
  if p_reference is null or length(p_reference) = 0 then
    raise exception 'a credit needs a reference';
  end if;
  -- The idempotency check IS the insert, and it comes first (see 0149).
  insert into public.ai_product_ledger
    (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, actor_admin_id, metadata)
  values (p_user_id, p_product, p_kind, 'settled', p_amount, 0, p_currency, p_reference, p_note, p_admin_id, p_metadata)
  on conflict (user_id, product, kind, reference) where reference is not null do nothing;
  if not found then
    select balance_cents into v_balance from public.ai_product_balances where user_id = p_user_id and product = p_product;
    return coalesce(v_balance, 0);
  end if;
  insert into public.ai_product_balances (user_id, product, balance_cents, currency, updated_at)
  values (p_user_id, p_product, p_amount, p_currency, now())
  on conflict (user_id, product) do update
    set balance_cents = public.ai_product_balances.balance_cents + excluded.balance_cents,
        updated_at = now()
  returning balance_cents into v_balance;
  update public.ai_product_ledger
     set balance_after_cents = v_balance, updated_at = now()
   where user_id = p_user_id and product = p_product and kind = p_kind and reference = p_reference;
  return v_balance;
end;
$$;

-- ── reserve: the processing charge, deducted at reservation ──────────────────
create or replace function public.reserve_product_charge(
  p_user_id  uuid,
  p_product  text,
  p_job_id   uuid,
  p_amount   bigint,
  p_currency text default 'NGN',
  p_snapshot jsonb default null
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
  -- Idempotent on the job: a retried /start finds the reservation it made.
  if exists (
    select 1 from public.ai_product_ledger
     where user_id = p_user_id and product = p_product and kind = 'processing_charge' and reference = p_job_id::text
  ) then
    select balance_cents into v_balance from public.ai_product_balances where user_id = p_user_id and product = p_product;
    return coalesce(v_balance, 0);
  end if;
  if p_amount = 0 then
    select balance_cents into v_balance from public.ai_product_balances where user_id = p_user_id and product = p_product;
    return coalesce(v_balance, 0);
  end if;
  -- 🔴 The deduction IS the authorisation: one statement, non-negative in its WHERE.
  update public.ai_product_balances
     set balance_cents = balance_cents - p_amount, updated_at = now()
   where user_id = p_user_id and product = p_product and balance_cents >= p_amount
  returning balance_cents into v_balance;
  if v_balance is null then
    raise exception 'insufficient product balance';
  end if;
  insert into public.ai_product_ledger
    (user_id, product, kind, status, delta_cents, balance_after_cents, currency, job_id, reference, snapshot)
  values (p_user_id, p_product, 'processing_charge', 'reserved', -p_amount, v_balance, p_currency, p_job_id, p_job_id::text, p_snapshot);
  return v_balance;
end;
$$;

-- ── settle: the job completed; the reservation becomes the final charge ──────
create or replace function public.settle_product_charge(
  p_user_id uuid,
  p_product text,
  p_job_id  uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.ai_product_ledger
     set status = 'settled', updated_at = now()
   where user_id = p_user_id and product = p_product and kind = 'processing_charge'
     and reference = p_job_id::text and status = 'reserved';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- ── refund: exactly once per charge, whatever calls it and however often ─────
create or replace function public.refund_product_charge(
  p_user_id uuid,
  p_product text,
  p_job_id  uuid,
  p_note    text default null
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charged  bigint;
  v_currency text;
  v_balance  bigint;
begin
  select -delta_cents, currency into v_charged, v_currency
    from public.ai_product_ledger
   where user_id = p_user_id and product = p_product and kind = 'processing_charge'
     and reference = p_job_id::text and status in ('reserved', 'settled');
  if v_charged is null or v_charged <= 0 then
    select balance_cents into v_balance from public.ai_product_balances where user_id = p_user_id and product = p_product;
    return coalesce(v_balance, 0);
  end if;
  -- The refund row's uniqueness is the "never twice": a second call hits the
  -- index and writes nothing, and the balance does not move again.
  insert into public.ai_product_ledger
    (user_id, product, kind, status, delta_cents, balance_after_cents, currency, job_id, reference, note)
  values (p_user_id, p_product, 'refund', 'settled', v_charged, 0, coalesce(v_currency, 'NGN'), p_job_id, p_job_id::text, p_note)
  on conflict (user_id, product, kind, reference) where reference is not null do nothing;
  if not found then
    select balance_cents into v_balance from public.ai_product_balances where user_id = p_user_id and product = p_product;
    return coalesce(v_balance, 0);
  end if;
  update public.ai_product_balances
     set balance_cents = balance_cents + v_charged, updated_at = now()
   where user_id = p_user_id and product = p_product
  returning balance_cents into v_balance;
  update public.ai_product_ledger
     set balance_after_cents = coalesce(v_balance, v_charged), updated_at = now()
   where user_id = p_user_id and product = p_product and kind = 'refund' and reference = p_job_id::text;
  update public.ai_product_ledger
     set status = 'refunded', updated_at = now()
   where user_id = p_user_id and product = p_product and kind = 'processing_charge' and reference = p_job_id::text;
  return coalesce(v_balance, 0);
end;
$$;

-- ── adjust: an operator's manual credit or debit, always with a note and an actor ──
create or replace function public.adjust_product_balance(
  p_user_id   uuid,
  p_product   text,
  p_delta     bigint,
  p_reference text,
  p_note      text,
  p_admin_id  uuid,
  p_currency  text default 'NGN'
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'an adjustment must move something';
  end if;
  if p_admin_id is null then
    raise exception 'an adjustment needs an actor';
  end if;
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'an adjustment needs a reason';
  end if;
  if p_reference is null or length(p_reference) = 0 then
    raise exception 'an adjustment needs a reference';
  end if;
  insert into public.ai_product_ledger
    (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, actor_admin_id)
  values (p_user_id, p_product, 'adjustment', 'settled', p_delta, 0, p_currency, p_reference, p_note, p_admin_id)
  on conflict (user_id, product, kind, reference) where reference is not null do nothing;
  if not found then
    select balance_cents into v_balance from public.ai_product_balances where user_id = p_user_id and product = p_product;
    return coalesce(v_balance, 0);
  end if;
  if p_delta > 0 then
    insert into public.ai_product_balances (user_id, product, balance_cents, currency, updated_at)
    values (p_user_id, p_product, p_delta, p_currency, now())
    on conflict (user_id, product) do update
      set balance_cents = public.ai_product_balances.balance_cents + excluded.balance_cents,
          updated_at = now()
    returning balance_cents into v_balance;
  else
    update public.ai_product_balances
       set balance_cents = balance_cents + p_delta, updated_at = now()
     where user_id = p_user_id and product = p_product and balance_cents >= -p_delta
    returning balance_cents into v_balance;
    if v_balance is null then
      -- Undo the audit row: a debit that could not happen is not a movement.
      delete from public.ai_product_ledger
       where user_id = p_user_id and product = p_product and kind = 'adjustment' and reference = p_reference;
      raise exception 'insufficient product balance for debit';
    end if;
  end if;
  update public.ai_product_ledger
     set balance_after_cents = v_balance, updated_at = now()
   where user_id = p_user_id and product = p_product and kind = 'adjustment' and reference = p_reference;
  return v_balance;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
--  🔴 REVOKE. POSTGRES GRANTS EXECUTE TO PUBLIC BY DEFAULT.
-- ═══════════════════════════════════════════════════════════════════════════
-- Issued with `execute` inside one block so they cannot be the DDL that is
-- silently skipped after a dollar-quoted body. Service role only.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.credit_product_balance(uuid, text, bigint, text, text, text, text, uuid, jsonb)',
    'public.reserve_product_charge(uuid, text, uuid, bigint, text, jsonb)',
    'public.settle_product_charge(uuid, text, uuid)',
    'public.refund_product_charge(uuid, text, uuid, text)',
    'public.adjust_product_balance(uuid, text, bigint, text, text, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
