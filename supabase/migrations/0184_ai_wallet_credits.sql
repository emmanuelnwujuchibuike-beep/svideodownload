-- ═══════════════════════════════════════════════════════════════════════════
--  0184 — THE FRENZ AI WALLET HOLDS CREDITS, NOT DOLLARS (2026-10-07)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-07: "convert the currency to credits and not USD but billed
-- in USD / currencies supported by the provider." Decisions the same day:
-- 1 credit = $0.10 (the AI-plan rate already live: frenzAiPlans.credits.
-- centsPerCredit = 10), the wallet and the AI-plan allowance count the SAME
-- credit, packs are bought in USD (Paystack converts to NGN as before).
--
-- The wallet structure is the one built in 0154 and kept since — this changes
-- its UNIT, not its shape. `balance_cents` / `delta_cents` keep their names
-- (every caller reads them); on a row whose `currency` is 'CREDIT' they hold
-- whole credits. The unit rides on each row, exactly as 0159 kept naira rows
-- readable after the dollar switch.
--
--   1. ledger kinds `bonus` (a pack's extra credits) and `grant` (credits the
--      product gives — a promotion, a goodwill grant) beside the five that exist;
--   2. 🔴 A CURRENCY GUARD ON EVERY WRITER. 0160 guarded the refund only. A
--      recharge, an adjustment or a reservation written in a unit that is not
--      the wallet's now RAISES — so code from before this migration (dollars)
--      and code from after it (credits) can never move the wrong number during
--      the deploy window. A refused reservation fails the job before the
--      provider is called; nothing is charged.
--   3. every existing balance converted ONCE at the live credit value, rounded
--      UP (in the member's favour), with an out-row and an in-row per member;
--      every in-flight USD reservation converted the same way so its refund
--      (0160 guard) still lands.
--
-- Live state when written (read 2026-10-07): 2 non-zero wallets, both USD,
-- $518.65 in total; 0 reserved rows; 0 real recharges ever.
--
-- Order: plain DDL first, then the functions, then ONE do-block for the
-- conversion and the grants (the 0130 lesson). Reversal: the in/out rows are
-- tagged `migration: 0184` in metadata.

-- ── 1 · two more kinds ───────────────────────────────────────────────────────
alter table public.ai_product_ledger drop constraint if exists ai_product_ledger_kind_chk;
alter table public.ai_product_ledger add constraint ai_product_ledger_kind_chk
  check (kind in ('recharge', 'processing_charge', 'refund', 'adjustment', 'reversal', 'bonus', 'grant'));

alter table public.ai_product_ledger drop constraint if exists ai_product_ledger_sign_chk;
alter table public.ai_product_ledger add constraint ai_product_ledger_sign_chk check (
  (kind in ('recharge', 'refund', 'bonus', 'grant') and delta_cents > 0)
  or (kind in ('processing_charge', 'reversal') and delta_cents < 0)
  or (kind = 'adjustment' and delta_cents <> 0)
);

comment on column public.ai_product_ledger.currency is
  'The unit of delta_cents / balance_after_cents on THIS row: CREDIT (whole credits, from 0184), USD (cents), NGN (kobo, before 0159).';
comment on column public.ai_product_balances.currency is
  'The unit of balance_cents: CREDIT = whole Frenz AI credits (0184). Every writer refuses a different unit.';

-- ── 2 · the writers, each refusing a unit that is not the wallet's ───────────
create or replace function public.credit_product_balance(
  p_user_id   uuid,
  p_product   text,
  p_amount    bigint,
  p_kind      text,
  p_reference text,
  p_currency  text default 'CREDIT',
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
  v_wallet  text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'credit must be positive';
  end if;
  if p_kind not in ('recharge', 'refund', 'bonus', 'grant') then
    raise exception 'not a credit kind: %', p_kind;
  end if;
  if p_reference is null or length(p_reference) = 0 then
    raise exception 'a credit needs a reference';
  end if;
  select currency into v_wallet from public.ai_product_balances where user_id = p_user_id and product = p_product;
  if v_wallet is not null and v_wallet <> p_currency then
    raise exception 'wallet unit mismatch: wallet is %, credit is %', v_wallet, p_currency;
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

create or replace function public.reserve_product_charge(
  p_user_id  uuid,
  p_product  text,
  p_job_id   uuid,
  p_amount   bigint,
  p_currency text default 'CREDIT',
  p_snapshot jsonb default null
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
  v_wallet  text;
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
  -- 🔴 0184: a charge in another unit is refused BEFORE anything moves (it could never be refunded — 0160).
  select currency into v_wallet from public.ai_product_balances where user_id = p_user_id and product = p_product;
  if v_wallet is not null and v_wallet <> coalesce(p_currency, '') then
    raise exception 'wallet unit mismatch: wallet is %, charge is %', v_wallet, p_currency;
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

create or replace function public.adjust_product_balance(
  p_user_id   uuid,
  p_product   text,
  p_delta     bigint,
  p_reference text,
  p_note      text,
  p_admin_id  uuid,
  p_currency  text default 'CREDIT'
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
  v_wallet  text;
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
  select currency into v_wallet from public.ai_product_balances where user_id = p_user_id and product = p_product;
  if v_wallet is not null and v_wallet <> p_currency then
    raise exception 'wallet unit mismatch: wallet is %, adjustment is %', v_wallet, p_currency;
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

-- ── 3 · the conversion (once) and the grants ─────────────────────────────────
do $$
declare
  v_cents_per_credit numeric;
  v_now   timestamptz := now();
  v_note  text;
  r       record;
  v_new   bigint;
  fn      text;
begin
  select coalesce(nullif((value -> 'frenzAiPlans' -> 'credits' ->> 'centsPerCredit'), '')::numeric, 10)
    into v_cents_per_credit
    from public.settings where key = 'landing';
  if v_cents_per_credit is null or v_cents_per_credit <= 0 then v_cents_per_credit := 10; end if;
  v_note := format('Balance moved to Frenz AI credits at %s¢ per credit', v_cents_per_credit);

  -- in-flight dollar reservations first: their refund must land in the credit wallet
  update public.ai_product_ledger
     set delta_cents = -ceil((-delta_cents)::numeric / v_cents_per_credit)::bigint,
         balance_after_cents = ceil(greatest(balance_after_cents, 0)::numeric / v_cents_per_credit)::bigint,
         currency = 'CREDIT',
         snapshot = coalesce(snapshot, '{}'::jsonb) || jsonb_build_object('convertedFromUsdCents', -delta_cents, 'migration', '0184'),
         updated_at = v_now
   where kind = 'processing_charge' and status = 'reserved' and currency = 'USD';

  for r in select user_id, product, balance_cents from public.ai_product_balances where currency = 'USD' order by user_id loop
    v_new := ceil(r.balance_cents::numeric / v_cents_per_credit)::bigint;
    if r.balance_cents > 0 then
      insert into public.ai_product_ledger
        (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, metadata, created_at, updated_at)
      values
        (r.user_id, r.product, 'adjustment', 'settled', -r.balance_cents, 0, 'USD', 'credits-switch-out:' || r.user_id::text,
         v_note, jsonb_build_object('migration', '0184', 'centsPerCredit', v_cents_per_credit, 'credits', v_new), v_now, v_now)
      on conflict do nothing;
      insert into public.ai_product_ledger
        (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, metadata, created_at, updated_at)
      values
        (r.user_id, r.product, 'adjustment', 'settled', v_new, v_new, 'CREDIT', 'credits-switch-in:' || r.user_id::text,
         v_note, jsonb_build_object('migration', '0184', 'centsPerCredit', v_cents_per_credit, 'fromUsdCents', r.balance_cents), v_now + interval '1 millisecond', v_now)
      on conflict do nothing;
    end if;
    update public.ai_product_balances
       set balance_cents = v_new, currency = 'CREDIT', updated_at = v_now
     where user_id = r.user_id and product = r.product;
  end loop;

  -- 🔴 REVOKE. POSTGRES GRANTS EXECUTE TO PUBLIC BY DEFAULT.
  foreach fn in array array[
    'public.credit_product_balance(uuid, text, bigint, text, text, text, text, uuid, jsonb)',
    'public.reserve_product_charge(uuid, text, uuid, bigint, text, jsonb)',
    'public.adjust_product_balance(uuid, text, bigint, text, text, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
