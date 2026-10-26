-- ═══════════════════════════════════════════════════════════════════════════
--  0284 — Frenz Coin: the deposit hold is the admin's to set, 1 hour by default (2026-10-25)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-25: "I don't want deposit to get that long hold, deposit hold should be like 1hr or configurable by
-- admin." 0280 made 72 hours the FLOOR in three places. This lowers the floor to 0 hours (the admin may choose) with
-- 1 hour as the default when a checkout carries no hold. The ceiling stays 2160 hours (90 days).
--
--   coin_deposits_hold_chk    hold_hours between 0 and 2160 (was 72 and 2160), release_at still >= settled_at + hold
--   coin_deposit_rules_ok     accepts holdHours 0 to 2160 (restated, only that bound changed)
--   settle_coin_deposit       clamps the checkout's holdHours to 0..2160, 1 when missing (restated, only that line
--                             changed). The hold is still fixed per deposit when it settles, by the database clock.
--
-- Deposits already settled keep the release time they were given (none exist in production - Frenz Coin is off).
-- Order matters for the migration runner: plain DDL first, the dollar-quoted functions last. No semicolon inside any
-- quoted string.

alter table public.coin_deposits drop constraint if exists coin_deposits_hold_chk;
alter table public.coin_deposits add constraint coin_deposits_hold_chk check (hold_hours between 0 and 2160 and release_at >= settled_at + make_interval(hours => hold_hours));
comment on table public.coin_deposits is 'Frenz Coin deposits (0280, 0284): one row per settled deposit, when it was settled and the earliest time it may be released (database clock, the admin-set hold, 1 hour by default). Written by settle_coin_deposit, moved only by the coin release and reversal functions. Service role only. No foreign key to auth.users (history outlives an account, 0278).';

-- The deposit rules a checkout is opened under. NULL / missing / out of bounds = refused. holdHours: 0 to 2160 (0284).
create or replace function public.coin_deposit_rules_ok(p_rules jsonb) returns boolean
language plpgsql immutable as $$
declare
  k text;
  v jsonb;
begin
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' or jsonb_typeof(p_rules -> 'enabled') <> 'boolean' then return false; end if;
  foreach k in array array['holdHours', 'minCents', 'maxCents'] loop
    v := p_rules -> k;
    if v is null or jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{1,12}$' then return false; end if;
  end loop;
  if (p_rules ->> 'holdHours')::bigint < 0 or (p_rules ->> 'holdHours')::bigint > 2160 then return false; end if;
  if (p_rules ->> 'minCents')::bigint < 1 or (p_rules ->> 'maxCents')::bigint < (p_rules ->> 'minCents')::bigint or (p_rules ->> 'maxCents')::bigint > 100000000 then return false; end if;
  return true;
end;
$$;

-- Settle a verified deposit (0280), the hold now 0 to 2160 hours, 1 when the checkout carried none (0284).
create or replace function public.settle_coin_deposit(p_reference text, p_charge_id text, p_paid_minor bigint, p_paid_currency text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_a       public.ai_topup_attempts%rowtype;
  v_d       public.coin_deposits%rowtype;
  v_hold    integer;
  v_release timestamptz;
  v_after   bigint;
  v_id      uuid;
begin
  if coalesce(p_reference, '') = '' or p_paid_minor is null or p_paid_minor <= 0 or coalesce(p_paid_currency, '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- the attempt row is the lock every settlement of this reference queues on (webhook, return page, sweep)
  select * into v_a from public.ai_topup_attempts where reference = p_reference for update;
  if v_a.reference is null or v_a.purpose <> 'coin_deposit' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into v_d from public.coin_deposits where reference = p_reference;
  if v_d.reference is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'amount', v_d.amount_cents, 'release_at', v_d.release_at, 'status', v_d.status);
  end if;
  -- a held review, a refund or a chargeback is never settled by code
  if v_a.status in ('mismatch', 'refunded', 'partially_refunded', 'chargeback') then
    return jsonb_build_object('ok', false, 'reason', 'not_settleable', 'status', v_a.status);
  end if;
  if p_paid_minor <> v_a.provider_amount or upper(p_paid_currency) <> upper(v_a.provider_currency) then
    update public.ai_topup_attempts set status = 'mismatch', status_reason = 'coin deposit paid amount or currency differs', paid_amount = p_paid_minor,
           paid_currency = upper(p_paid_currency), charge_id = p_charge_id, updated_at = now()
     where reference = p_reference;
    insert into public.financial_audit_log (action, target_type, target_id, reference, details)
    values ('coin_deposit_mismatch', 'coin_deposit', v_a.user_id::text, p_reference,
            jsonb_build_object('expected_minor', v_a.provider_amount, 'expected_currency', v_a.provider_currency, 'paid_minor', p_paid_minor, 'paid_currency', upper(p_paid_currency)));
    return jsonb_build_object('ok', false, 'reason', 'mismatch');
  end if;
  v_hold := greatest(0, least(2160, coalesce((v_a.metadata -> 'coin' ->> 'holdHours')::int, 1)));
  v_release := now() + make_interval(hours => v_hold);

  perform public.ensure_coin_wallet(v_a.user_id);
  perform 1 from public.ai_product_balances where user_id = v_a.user_id and product = 'frenz_coin' for update;
  perform set_config('frenz.coin_writer', 'on', true);
  update public.ai_product_balances set balance_cents = balance_cents + v_a.amount_cents, pending_cents = pending_cents + v_a.amount_cents, updated_at = now()
   where user_id = v_a.user_id and product = 'frenz_coin' returning balance_cents into v_after;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, withdrawable_part, metadata)
  values (v_a.user_id, 'frenz_coin', 'deposit', 'reserved', v_a.amount_cents, v_after, 'USD', 'coin-deposit:' || p_reference, 'Deposit (on hold)', 0,
          jsonb_build_object('deposit_reference', p_reference, 'provider', v_a.provider, 'hold_hours', v_hold, 'release_at', v_release))
  returning id into v_id;
  perform set_config('frenz.coin_writer', 'off', true);
  insert into public.coin_deposits (reference, user_id, amount_cents, provider, charge_id, paid_minor, paid_currency, hold_hours, release_at, ledger_id, rules_snapshot)
  values (p_reference, v_a.user_id, v_a.amount_cents, v_a.provider, p_charge_id, p_paid_minor, upper(p_paid_currency), v_hold, v_release, v_id, v_a.metadata -> 'coin' -> 'rules');
  update public.ai_topup_attempts set status = 'success', paid_amount = p_paid_minor, paid_currency = upper(p_paid_currency), charge_id = p_charge_id,
         external_id = coalesce(external_id, p_charge_id), verified_at = now(), updated_at = now()
   where reference = p_reference;
  insert into public.financial_audit_log (action, target_type, target_id, reference, details)
  values ('coin_deposit_settled', 'coin_deposit', v_a.user_id::text, p_reference,
          jsonb_build_object('amount_cents', v_a.amount_cents, 'paid_minor', p_paid_minor, 'paid_currency', upper(p_paid_currency), 'hold_hours', v_hold, 'release_at', v_release, 'ledger_id', v_id));
  return jsonb_build_object('ok', true, 'amount', v_a.amount_cents, 'user_id', v_a.user_id, 'release_at', v_release, 'hold_hours', v_hold, 'balance', v_after);
end;
$$;
