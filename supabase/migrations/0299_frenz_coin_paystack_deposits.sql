-- ═══════════════════════════════════════════════════════════════════════════
--  0299 — Frenz Coin deposits through Paystack too (2026-10-27)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "make Nigeria users use Paystack as first choice of payment, deposit, plan and withdraw provider, but they can
-- decide to switch. Outside Nigeria … Flutterwave as first choice."
--
-- A coin deposit was Flutterwave-only down to the schema (0280: the provider checks, begin_coin_deposit, and
-- reverse_coin_deposit refused any other provider). Now Paystack may collect one too:
--   · coin_deposits and coin_deposit_reversals accept provider paystack
--   · begin_coin_deposit accepts p_provider paystack (everything else in it unchanged, copied from 0280)
--   · reverse_coin_deposit accepts p_provider paystack (everything else unchanged, copied from 0281)
-- settle_coin_deposit (0284) never named a provider: it settles on exactly the amount and currency the attempt row
-- pinned, whoever collected it, once per reference. The coins still land on hold, as before.
--
-- Depends on 0280, 0281, 0284. Safe to run twice. No semicolon inside any quoted string or comment. Dollar-quoted
-- blocks last.

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
begin
  execute 'alter table public.coin_deposits drop constraint if exists coin_deposits_provider_chk';
  execute 'alter table public.coin_deposits add constraint coin_deposits_provider_chk check (provider in (''flutterwave'', ''paystack''))';
  execute 'alter table public.coin_deposit_reversals drop constraint if exists coin_deposit_reversals_provider_chk';
  execute 'alter table public.coin_deposit_reversals add constraint coin_deposit_reversals_provider_chk check (provider in (''flutterwave'', ''paystack''))';
end
$$;

-- Open a coin deposit (0280), Flutterwave or Paystack
create or replace function public.begin_coin_deposit(
  p_user uuid, p_reference text, p_amount_cents bigint, p_provider text, p_provider_amount bigint, p_provider_currency text,
  p_idempotency text, p_rules jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_open record;
begin
  if p_user is null or coalesce(p_reference, '') = '' or p_amount_cents is null or p_amount_cents <= 0 or p_provider is null or p_provider not in ('flutterwave', 'paystack')
     or p_provider_amount is null or p_provider_amount <= 0 or coalesce(p_provider_currency, '') !~ '^[A-Z]{3}$'
     or coalesce(p_idempotency, '') !~ '^[A-Za-z0-9_-]{8,80}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- held until this transaction ends: a parallel request by the same member waits here, then sees this one's row
  perform pg_advisory_xact_lock(hashtextextended('frenz:coin_deposit:' || p_user::text, 0));
  select reference, status, checkout_url, amount_cents into v_open
    from public.ai_topup_attempts where user_id = p_user and purpose = 'coin_deposit' and metadata ->> 'idempotency_key' = p_idempotency;
  if found then
    if v_open.amount_cents <> p_amount_cents then return jsonb_build_object('ok', false, 'reason', 'idempotency_conflict'); end if;
    return jsonb_build_object('ok', false, 'reason', 'existing', 'reference', v_open.reference, 'status', v_open.status, 'checkout_url', v_open.checkout_url);
  end if;
  if not public.coin_deposit_rules_ok(p_rules) then return jsonb_build_object('ok', false, 'reason', 'rules_invalid'); end if;
  if not (p_rules ->> 'enabled')::boolean then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
  if p_amount_cents < (p_rules ->> 'minCents')::bigint or p_amount_cents > (p_rules ->> 'maxCents')::bigint then
    return jsonb_build_object('ok', false, 'reason', 'amount_out_of_range', 'min', (p_rules ->> 'minCents')::bigint, 'max', (p_rules ->> 'maxCents')::bigint);
  end if;
  if exists (select 1 from public.profiles where id = p_user and is_suspended) then return jsonb_build_object('ok', false, 'reason', 'suspended'); end if;
  select reference, status, checkout_url into v_open
    from public.ai_topup_attempts
   where user_id = p_user and purpose = 'coin_deposit' and status in ('pending', 'verification_required') and created_at > now() - interval '30 minutes'
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('ok', false, 'reason', 'open', 'reference', v_open.reference, 'status', v_open.status, 'checkout_url', v_open.checkout_url);
  end if;
  insert into public.ai_topup_attempts (reference, user_id, provider, purpose, status, amount_cents, currency, provider_amount, provider_currency, metadata)
  values (p_reference, p_user, p_provider, 'coin_deposit', 'pending', p_amount_cents, 'USD', p_provider_amount, upper(p_provider_currency),
          jsonb_build_object('idempotency_key', p_idempotency, 'coin', jsonb_build_object('holdHours', (p_rules ->> 'holdHours')::int, 'rules', p_rules)));
  return jsonb_build_object('ok', true, 'reference', p_reference, 'hold_hours', (p_rules ->> 'holdHours')::int);
end;
$$;

-- A refund or chargeback of a coin deposit (0281), Flutterwave or Paystack
create or replace function public.reverse_coin_deposit(
  p_provider text, p_event_key text, p_kind text, p_reference text,
  p_refunded_minor bigint, p_paid_minor bigint, p_paid_currency text, p_actor uuid, p_note text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ex      public.coin_deposit_reversals%rowtype;
  v_user    uuid;
  v_d       public.coin_deposits%rowtype;
  v_bal     bigint;
  v_pend    bigint;
  v_already bigint;
  v_due     bigint;
  v_take    bigint := 0;
  v_short   bigint := 0;
  v_state   text;
  v_phase   text;
  v_id      uuid;
  v_ref     text;
  v_after   bigint;
  v_partial boolean;
begin
  if p_provider is null or p_provider not in ('flutterwave', 'paystack') or p_kind is null or p_kind not in ('refund', 'dispute')
     or coalesce(p_event_key, '') = '' or coalesce(p_reference, '') = ''
     or (p_refunded_minor is not null and p_refunded_minor <= 0) or (p_paid_minor is not null and p_paid_minor <= 0) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into v_ex from public.coin_deposit_reversals where provider = p_provider and event_key = p_event_key;
  if v_ex.id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'id', v_ex.id, 'state', v_ex.state, 'due', v_ex.due_cents, 'recovered', v_ex.recovered_cents, 'shortfall', v_ex.shortfall_cents);
  end if;
  select user_id into v_user from public.coin_deposits where reference = p_reference;
  if v_user is null then
    insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
    values (p_actor, 'coin_deposit_reversal_unmatched', 'coin_deposit', p_reference, p_reference,
            jsonb_build_object('provider', p_provider, 'event_key', p_event_key, 'kind', p_kind, 'refunded_minor', p_refunded_minor, 'review', 'no settled coin deposit has this reference'));
    return jsonb_build_object('ok', false, 'reason', 'not_credited');
  end if;
  -- the wallet, then the deposit: every reversal, release and spend of this wallet queues here
  select balance_cents, pending_cents into v_bal, v_pend from public.ai_product_balances where user_id = v_user and product = 'frenz_coin' for update;
  select * into v_d from public.coin_deposits where reference = p_reference for update;
  select * into v_ex from public.coin_deposit_reversals where provider = p_provider and event_key = p_event_key;
  if v_ex.id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'id', v_ex.id, 'state', v_ex.state, 'due', v_ex.due_cents, 'recovered', v_ex.recovered_cents, 'shortfall', v_ex.shortfall_cents);
  end if;

  select coalesce(sum(due_cents), 0) into v_already from public.coin_deposit_reversals where reference = p_reference and state in ('recovered', 'disputed', 'lost');
  v_phase := case when v_d.status in ('held', 'disputed') then 'held' else 'released' end;
  v_partial := p_refunded_minor is not null and p_paid_minor is not null and p_refunded_minor < p_paid_minor;
  v_ref := 'coin-deposit-reversal:' || p_provider || ':' || p_event_key;

  if v_partial then
    -- a partial refund of a coin deposit is not applied by code: a person decides (an audited adjustment)
    v_due := 0;
    v_state := 'review';
  else
    v_due := greatest(0, v_d.amount_cents - v_already);
    if v_due = 0 then
      v_state := 'recovered';
    elsif v_phase = 'held' then
      -- nothing of a deposit on hold could have been spent: it is all still there
      v_take := v_due;
      v_state := case when p_kind = 'dispute' then 'disputed' else 'recovered' end;
    else
      v_take := least(v_due, greatest(v_bal - v_pend, 0));
      v_short := v_due - v_take;
      v_state := case when p_kind = 'dispute' then 'disputed' else 'recovered' end;
    end if;
  end if;

  insert into public.coin_deposit_reversals (provider, event_key, kind, reference, user_id, phase, paid_minor, paid_currency, refunded_minor,
                                             deposit_cents, due_cents, recovered_cents, shortfall_cents, state, ledger_reference, actor_id, note)
  values (p_provider, p_event_key, p_kind, p_reference, v_user, v_phase, p_paid_minor, p_paid_currency, p_refunded_minor,
          v_d.amount_cents, v_due, v_take, v_short, v_state, v_ref, p_actor, p_note)
  returning id into v_id;

  if v_take > 0 and v_phase = 'held' then
    if p_kind = 'refund' then
      perform public.coin_take_back_held_deposit(p_reference, v_ref, 'Taken back: a deposit was refunded');
    else
      -- the coins stay pending and the release is frozen until an admin records the outcome
      update public.coin_deposits set status = 'disputed' where reference = p_reference and status = 'held';
    end if;
  elsif v_take > 0 then
    perform set_config('frenz.coin_writer', 'on', true);
    update public.ai_product_balances
       set balance_cents = balance_cents - v_take, held_cents = held_cents + case when p_kind = 'dispute' then v_take else 0 end, updated_at = now()
     where user_id = v_user and product = 'frenz_coin' returning balance_cents into v_after;
    insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, withdrawable_part, metadata)
    values (v_user, 'frenz_coin', 'reversal', case when p_kind = 'dispute' then 'reserved' else 'settled' end, -v_take, v_after, 'USD', v_ref,
            case when p_kind = 'dispute' then 'Held: the payment for a deposit is disputed' else 'Taken back: a deposit was refunded' end, 0,
            jsonb_build_object('reversal_id', v_id, 'deposit_reference', p_reference, 'phase', 'released', 'kind', p_kind));
    perform set_config('frenz.coin_writer', 'off', true);
    if p_kind = 'refund' then update public.coin_deposits set status = 'reversed', reversed_at = now() where reference = p_reference and status = 'released'; end if;
  elsif v_due > 0 and p_kind = 'refund' and v_phase = 'released' then
    update public.coin_deposits set status = 'reversed', reversed_at = now() where reference = p_reference and status = 'released';
  end if;

  -- 0281: the shortfall row itself pauses this product (its block-reason function reads it). The account flag
  -- reward_profiles.restricted is an administrator's decision only and is not written here.

  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_actor, 'coin_deposit_' || p_kind || case when v_partial then '_review' else '' end, 'coin_deposit_reversal', v_id::text, p_reference,
          jsonb_build_object('provider', p_provider, 'event_key', p_event_key, 'user_id', v_user, 'phase', v_phase, 'paid_minor', p_paid_minor,
                             'paid_currency', p_paid_currency, 'refunded_minor', p_refunded_minor, 'deposit_cents', v_d.amount_cents, 'due', v_due,
                             'recovered', v_take, 'shortfall', v_short, 'state', v_state, 'note', p_note,
                             'proposed_due', case when v_partial then ceil(v_d.amount_cents::numeric * p_refunded_minor / p_paid_minor)::bigint end));
  return jsonb_build_object('ok', true, 'id', v_id, 'user_id', v_user, 'phase', v_phase, 'state', v_state, 'due', v_due, 'recovered', v_take, 'shortfall', v_short);
end;
$$;

do $$
begin
  execute 'revoke all on function public.begin_coin_deposit(uuid, text, bigint, text, bigint, text, text, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.begin_coin_deposit(uuid, text, bigint, text, bigint, text, text, jsonb) to service_role';
  execute 'revoke all on function public.reverse_coin_deposit(text, text, text, text, bigint, bigint, text, uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.reverse_coin_deposit(text, text, text, text, bigint, bigint, text, uuid, text) to service_role';
end
$$;
