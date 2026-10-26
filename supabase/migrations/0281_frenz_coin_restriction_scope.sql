-- ═══════════════════════════════════════════════════════════════════════════
--  0281 — Frenz Coin Part 4.1: restrictions scoped to their product (2026-10-25)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Found in the Part 4.1 audit: an automatic SHORTFALL (a refunded or charged-back payment whose money was already spent)
-- was written as the account-level flag `reward_profiles.restricted`. That flag is read by every money path — AI-credit
-- transfers and withdrawals (0193 / 0199 / 0202 / 0258 / 0278), SUB withdrawals (0227), affiliate payouts (0255), both
-- coin functions (0279) — and by the public trust signal (lib/social/graph/trust-server.ts). So a credit top-up shortfall
-- (0278) froze Frenz Coin and SUB earnings, and a coin deposit shortfall (0280) froze AI credits and SUB earnings.
--
-- ── The two kinds of restriction, after this migration ──────────────────────
--   ACCOUNT-WIDE   profiles.is_suspended, and reward_profiles.restricted — set ONLY by an administrator's explicit
--                  decision (Admin -> Rewards -> Restrict: a fresh password and a financial_audit_log row). Every money
--                  path keeps honouring both, coins included.
--   PRODUCT        derived from that product's own open shortfall rows, never copied onto the account:
--                    AI credits  wallet_topup_reversals  (shortfall_credits > 0, not cleared)  -> credit_wallet_block_reason
--                    Frenz Coin  coin_deposit_reversals  (shortfall_cents > 0, not cleared)    -> coin_wallet_block_reason
--                  Clearing one product's shortfall touches nothing else.
--
-- ── What changes ─────────────────────────────────────────────────────────────
--   coin_wallet_block_reason (new)      suspended | restricted (admin) | a coin shortfall. Not an AI-credit shortfall.
--   credit_wallet_block_reason          restated EXACTLY as 0278 wrote it (0280's coin-shortfall line removed): suspended |
--                                       restricted (admin) | an AI-credit shortfall. Not a coin shortfall.
--   transfer_coins (0280), request_coin_withdrawal (0279)   restated word for word, calling coin_wallet_block_reason.
--   reverse_wallet_topup (0278), reverse_coin_deposit (0280)  restated word for word WITHOUT the write to
--                                       reward_profiles: the shortfall row itself is the product restriction.
--   backfill                            any automatic shortfall restriction already written (reason wallet_topup_shortfall
--                                       or coin_deposit_shortfall) is moved off the account, one audit row each. The
--                                       product restriction stays in force through the open shortfall row.
--   reward_profiles_restriction_explicit_chk   those two automatic reasons can never again be an account restriction.
--
-- The lift functions (lift_topup_shortfall_restriction 0278, lift_coin_shortfall_restriction 0280) are unchanged: they
-- clear only their own automatic reason, which no longer exists, so resolving a shortfall never clears an admin's
-- restriction or another product's.
--
-- Depends on 0278, 0279, 0280. Run by hand AFTER 0280 (and again after any re-run of 0278 / 0279 / 0280, which would
-- restore their earlier function bodies). Safe to run twice. No semicolon inside any quoted string. Dollar-quoted last.

-- ── backfill: automatic shortfall restrictions leave the account (audited) ──
insert into public.financial_audit_log (action, target_type, target_id, reference, details)
select 'restriction_rescoped_to_product', 'reward_profile', p.user_id::text, p.restricted_reason,
       jsonb_build_object('was_restricted', p.restricted, 'reason', p.restricted_reason, 'migration', '0281',
                          'product', case when p.restricted_reason = 'coin_deposit_shortfall' then 'frenz_coin' else 'ai_credits' end)
  from public.reward_profiles p
 where p.restricted_reason in ('wallet_topup_shortfall', 'coin_deposit_shortfall');
update public.reward_profiles set restricted = false, restricted_reason = null, updated_at = now()
 where restricted_reason in ('wallet_topup_shortfall', 'coin_deposit_shortfall');

alter table public.reward_profiles drop constraint if exists reward_profiles_restriction_explicit_chk;
alter table public.reward_profiles add constraint reward_profiles_restriction_explicit_chk
  check (restricted_reason is null or restricted_reason not in ('wallet_topup_shortfall', 'coin_deposit_shortfall')) not valid;
alter table public.reward_profiles validate constraint reward_profiles_restriction_explicit_chk;
comment on column public.reward_profiles.restricted is 'An ACCOUNT-WIDE financial restriction, set only by an administrator (Admin -> Rewards -> Restrict, audited). Product shortfalls are not written here (0281): they live on wallet_topup_reversals / coin_deposit_reversals.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

-- Why this member may not move Frenz Coins right now (null = they may). Read it under the coin wallet lock.
create or replace function public.coin_wallet_block_reason(p_user uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from public.profiles where id = p_user and is_suspended) then return 'suspended'; end if;
  -- an administrator's explicit, account-wide restriction
  if exists (select 1 from public.reward_profiles where user_id = p_user and restricted) then return 'restricted'; end if;
  -- a Frenz Coin shortfall only: an AI-credit shortfall pauses AI credits, not coins
  if exists (select 1 from public.coin_deposit_reversals where user_id = p_user and shortfall_cents > 0 and shortfall_cleared_at is null) then return 'recovery_due'; end if;
  return null;
end;
$$;

-- 0278's AI-credit block reason, restated EXACTLY as 0278 wrote it (0280 had added the coin shortfall to it).
create or replace function public.credit_wallet_block_reason(p_user uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from public.profiles where id = p_user and is_suspended) then return 'suspended'; end if;
  if exists (select 1 from public.reward_profiles where user_id = p_user and restricted) then return 'restricted'; end if;
  if exists (select 1 from public.wallet_topup_reversals where user_id = p_user and shortfall_credits > 0 and shortfall_cleared_at is null) then return 'recovery_due'; end if;
  return null;
end;
$$;

-- 0280's coin transfer, restated: the coin block reason.
create or replace function public.transfer_coins(p_sender uuid, p_account_number text, p_amount bigint, p_idempotency text, p_note text, p_rules jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ex        public.coin_transfers%rowtype;
  v_recipient uuid;
  v_block     text;
  v_sent      bigint;
  v_fee       jsonb;
  v_total     bigint;
  v_s_bal     bigint;
  v_s_pend    bigint;
  v_id        uuid;
  v_s_after   bigint;
  v_r_after   bigint;
  v_note      text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_sender is null or p_amount is null or p_amount <= 0 or coalesce(p_idempotency, '') = '' or char_length(p_idempotency) > 80
     or (v_note is not null and char_length(v_note) > 120) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- a replay answers what the first request did, and is never charged or counted again
  select * into v_ex from public.coin_transfers where sender_id = p_sender and idempotency_key = p_idempotency;
  if v_ex.id is not null then
    -- 0280: a replayed key must name the SAME transfer (amount and recipient), or it is refused, never answered as done
    if v_ex.amount_cents <> p_amount or v_ex.recipient_id is distinct from (select user_id from public.wallet_accounts where account_number = p_account_number) then
      return jsonb_build_object('ok', false, 'reason', 'idempotency_conflict');
    end if;
    return jsonb_build_object('ok', true, 'duplicate', true, 'transfer_id', v_ex.id, 'amount', v_ex.amount_cents, 'fee', v_ex.fee_cents, 'total', v_ex.total_debit_cents);
  end if;
  if not public.coin_rules_ok(p_rules, 'transfer') then return jsonb_build_object('ok', false, 'reason', 'rules_invalid'); end if;
  if not (p_rules ->> 'enabled')::boolean then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
  if p_amount < (p_rules ->> 'minCents')::bigint or p_amount > (p_rules ->> 'maxCents')::bigint then
    return jsonb_build_object('ok', false, 'reason', 'amount_out_of_range', 'min', (p_rules ->> 'minCents')::bigint, 'max', (p_rules ->> 'maxCents')::bigint);
  end if;
  select user_id into v_recipient from public.wallet_accounts where account_number = p_account_number;
  if v_recipient is null then return jsonb_build_object('ok', false, 'reason', 'no_account'); end if;
  if v_recipient = p_sender then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  if not exists (select 1 from public.ai_product_balances where user_id = p_sender and product = 'frenz_coin') then return jsonb_build_object('ok', false, 'reason', 'no_wallet'); end if;
  perform public.ensure_coin_wallet(v_recipient);
  -- both coin wallets, locked in a FIXED order (user id), so two opposite transfers never deadlock
  perform 1 from public.ai_product_balances where product = 'frenz_coin' and user_id in (p_sender, v_recipient) order by user_id for update;
  v_block := public.coin_wallet_block_reason(p_sender); -- 0281: the coin product's own block reason
  if v_block is not null then return jsonb_build_object('ok', false, 'reason', v_block); end if;
  if exists (select 1 from public.profiles where id = v_recipient and is_suspended) then return jsonb_build_object('ok', false, 'reason', 'recipient_unavailable'); end if;
  -- every coin transfer by this sender holds the sender's coin row lock, so this sum cannot be raced
  select coalesce(sum(amount_cents), 0) into v_sent from public.coin_transfers where sender_id = p_sender and created_at >= now() - interval '24 hours';
  if v_sent + p_amount > (p_rules ->> 'dailyMaxCents')::bigint then
    return jsonb_build_object('ok', false, 'reason', 'daily_limit', 'sent', v_sent, 'limit', (p_rules ->> 'dailyMaxCents')::bigint);
  end if;
  v_fee := public.coin_transfer_fee(p_amount, p_rules);
  v_total := (v_fee ->> 'total')::bigint;
  select balance_cents, pending_cents into v_s_bal, v_s_pend from public.ai_product_balances where user_id = p_sender and product = 'frenz_coin';
  if v_s_bal - v_s_pend < v_total then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'available', v_s_bal - v_s_pend, 'needed', v_total, 'fee', (v_fee ->> 'fee')::bigint);
  end if;

  insert into public.coin_transfers (sender_id, recipient_id, amount_cents, fee_percent_cents, fee_flat_cents, fee_cents, total_debit_cents, bracket, idempotency_key, note, rules_snapshot)
  values (p_sender, v_recipient, p_amount, (v_fee ->> 'percent')::bigint, (v_fee ->> 'flat')::bigint, (v_fee ->> 'fee')::bigint, v_total, v_fee ->> 'bracket', p_idempotency, v_note,
          p_rules || jsonb_build_object('fee', v_fee))
  on conflict (sender_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then
    select * into v_ex from public.coin_transfers where sender_id = p_sender and idempotency_key = p_idempotency;
    return jsonb_build_object('ok', true, 'duplicate', true, 'transfer_id', v_ex.id, 'amount', v_ex.amount_cents, 'fee', v_ex.fee_cents, 'total', v_ex.total_debit_cents);
  end if;

  perform set_config('frenz.coin_writer', 'on', true);
  update public.ai_product_balances set balance_cents = balance_cents - v_total, updated_at = now()
   where user_id = p_sender and product = 'frenz_coin' returning balance_cents into v_s_after;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, withdrawable_part, metadata)
  values (p_sender, 'frenz_coin', 'transfer_out', 'settled', -p_amount, v_s_after + (v_fee ->> 'fee')::bigint, 'USD', 'coin-transfer:' || v_id::text,
          'Sent to wallet ' || right(p_account_number, 4), 0, jsonb_build_object('transfer_id', v_id, 'recipient_id', v_recipient));
  if (v_fee ->> 'fee')::bigint > 0 then
    -- the trigger ai_product_ledger_post_fee posts its counter-entry (coin_transfer_fee), once per ledger row
    insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, withdrawable_part, metadata)
    values (p_sender, 'frenz_coin', 'transfer_fee', 'settled', -(v_fee ->> 'fee')::bigint, v_s_after, 'USD', 'coin-transfer-fee:' || v_id::text, 'Transfer fee', 0,
            jsonb_build_object('transfer_id', v_id, 'fee', v_fee, 'rules_version', p_rules -> 'version'));
  end if;
  update public.ai_product_balances set balance_cents = balance_cents + p_amount, updated_at = now()
   where user_id = v_recipient and product = 'frenz_coin' returning balance_cents into v_r_after;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, withdrawable_part, metadata)
  values (v_recipient, 'frenz_coin', 'transfer_in', 'settled', p_amount, v_r_after, 'USD', 'coin-transfer:' || v_id::text, 'Received Frenz Coins', 0,
          jsonb_build_object('transfer_id', v_id, 'sender_id', p_sender));
  perform set_config('frenz.coin_writer', 'off', true);
  return jsonb_build_object('ok', true, 'transfer_id', v_id, 'recipient_id', v_recipient, 'amount', p_amount, 'fee', (v_fee ->> 'fee')::bigint,
                            'fee_percent', (v_fee ->> 'percent')::bigint, 'fee_flat', (v_fee ->> 'flat')::bigint, 'total', v_total,
                            'balance_after', v_s_after, 'recipient_balance_after', v_r_after);
end;
$$;

-- 0279's coin withdrawal request, restated: the coin block reason.
create or replace function public.request_coin_withdrawal(p_user uuid, p_gross bigint, p_method text, p_details jsonb, p_idempotency text, p_rules jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ex    public.withdrawal_requests%rowtype;
  v_bal   bigint;
  v_pend  bigint;
  v_block text;
  v_prof  public.reward_profiles%rowtype;
  v_day   integer;
  v_month bigint;
  v_fee   jsonb;
  v_net   bigint;
  v_rate  bigint;
  v_pmin  bigint;
  v_id    uuid;
  v_after bigint;
begin
  if p_user is null or p_gross is null or p_gross <= 0 or coalesce(p_idempotency, '') = '' or coalesce(p_method, '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into v_ex from public.withdrawal_requests where user_id = p_user and idempotency_key = p_idempotency;
  if v_ex.id is not null then
    if v_ex.source <> 'coin' then return jsonb_build_object('ok', false, 'reason', 'idempotency_conflict'); end if;
    return jsonb_build_object('ok', true, 'duplicate', true, 'id', v_ex.id, 'status', v_ex.status, 'gross', v_ex.gross_cents, 'fee', v_ex.fee_cents, 'net', v_ex.net_cents);
  end if;
  if not public.coin_rules_ok(p_rules, 'withdrawal') then return jsonb_build_object('ok', false, 'reason', 'rules_invalid'); end if;
  if not (p_rules ->> 'enabled')::boolean then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
  if p_gross < (p_rules ->> 'minCents')::bigint or p_gross > (p_rules ->> 'maxCents')::bigint then
    return jsonb_build_object('ok', false, 'reason', 'amount_out_of_range', 'min', (p_rules ->> 'minCents')::bigint, 'max', (p_rules ->> 'maxCents')::bigint);
  end if;
  -- every withdrawal and spend of this coin wallet serialises on its row
  select balance_cents, pending_cents into v_bal, v_pend from public.ai_product_balances where user_id = p_user and product = 'frenz_coin' for update;
  if v_bal is null then return jsonb_build_object('ok', false, 'reason', 'no_wallet'); end if;
  v_block := public.coin_wallet_block_reason(p_user); -- 0281: the coin product's own block reason
  if v_block is not null then return jsonb_build_object('ok', false, 'reason', v_block); end if;
  if (p_rules ->> 'requireEmailConfirmed')::boolean and not exists (select 1 from auth.users where id = p_user and email_confirmed_at is not null) then
    return jsonb_build_object('ok', false, 'reason', 'email_unconfirmed');
  end if;
  if (p_rules ->> 'requireQualification')::boolean then
    select * into v_prof from public.reward_profiles where user_id = p_user;
    if v_prof.user_id is null or not (v_prof.qualified_at is not null or v_prof.qualification_status = 'approved') then return jsonb_build_object('ok', false, 'reason', 'not_qualified'); end if;
  end if;
  select count(*) into v_day from public.withdrawal_requests where user_id = p_user and source = 'coin' and status not in ('rejected', 'cancelled') and created_at >= now() - interval '1 day';
  if v_day >= (p_rules ->> 'maxPerDay')::bigint then return jsonb_build_object('ok', false, 'reason', 'day_limit'); end if;
  select coalesce(sum(gross_cents), 0) into v_month from public.withdrawal_requests where user_id = p_user and source = 'coin' and status not in ('rejected', 'cancelled') and created_at >= now() - interval '30 days';
  if v_month + p_gross > (p_rules ->> 'maxMonthCents')::bigint then return jsonb_build_object('ok', false, 'reason', 'month_limit'); end if;
  v_fee := public.coin_withdrawal_fee(p_gross, p_rules);
  v_net := (v_fee ->> 'net')::bigint;
  if v_net <= 0 then return jsonb_build_object('ok', false, 'reason', 'below_fee', 'fee', (v_fee ->> 'fee')::bigint); end if;
  if v_bal - v_pend < p_gross then return jsonb_build_object('ok', false, 'reason', 'insufficient', 'available', v_bal - v_pend); end if;
  -- the payout amount in the payout currency, at the rate in the rules (floor: never pay out a fraction not held)
  v_rate := case when jsonb_typeof(p_rules -> 'payoutMinorPerUsd') = 'number' then (p_rules ->> 'payoutMinorPerUsd')::bigint end;
  v_pmin := case when v_rate is not null and v_rate > 0 then (v_net * v_rate) / 100 end;

  begin
    insert into public.withdrawal_requests (user_id, credits, amount_usd_cents, rate_snapshot, status, payout_method, payout_details, source, gross_cents, fee_cents, net_cents, fee_bp,
                                            idempotency_key, payout_currency, payout_minor)
    values (p_user, 0, v_net, p_rules || jsonb_build_object('fee', v_fee), 'pending', p_method, coalesce(p_details, '{}'::jsonb), 'coin', p_gross, (v_fee ->> 'fee')::bigint, v_net,
            (p_rules ->> 'percentBp')::integer, p_idempotency, case when v_pmin is not null and v_pmin > 0 then coalesce(p_rules ->> 'payoutCurrency', 'NGN') end,
            case when v_pmin is not null and v_pmin > 0 then v_pmin end)
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'open_exists');
  end;
  perform set_config('frenz.coin_writer', 'on', true);
  update public.ai_product_balances set balance_cents = balance_cents - p_gross, held_cents = held_cents + p_gross, updated_at = now()
   where user_id = p_user and product = 'frenz_coin' returning balance_cents into v_after;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, withdrawable_part, metadata)
  values (p_user, 'frenz_coin', 'withdrawal', 'reserved', -p_gross, v_after, 'USD', 'coin-withdrawal:' || v_id::text, 'Withdrawal requested (held)', 0,
          jsonb_build_object('withdrawal_id', v_id, 'fee', v_fee));
  perform set_config('frenz.coin_writer', 'off', true);
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_user, 'coin_withdrawal_requested', 'withdrawal', v_id::text, 'coin-withdrawal:' || v_id::text,
          jsonb_build_object('gross', p_gross, 'fee', v_fee, 'net', v_net, 'payout_minor', v_pmin, 'rules_version', p_rules -> 'version', 'method', p_method));
  return jsonb_build_object('ok', true, 'id', v_id, 'gross', p_gross, 'fee', (v_fee ->> 'fee')::bigint, 'net', v_net, 'payout_minor', v_pmin, 'balance_after', v_after);
end;
$$;

-- 0278's top-up reversal, restated without writing the account restriction (the shortfall row pauses AI credits).
create or replace function public.reverse_wallet_topup(
  p_provider text, p_event_key text, p_kind text, p_reference text,
  p_refunded_minor bigint, p_paid_minor bigint, p_paid_currency text, p_actor uuid, p_note text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ex       public.wallet_topup_reversals%rowtype;
  v_user     uuid;
  v_credited bigint;
  v_first    timestamptz;
  v_already  bigint;
  v_remain   bigint;
  v_due      bigint;
  v_bal      bigint;
  v_wd       bigint;
  v_dep      bigint;
  v_take     bigint := 0;
  v_wpart    bigint := 0;
  v_dpart    bigint := 0;
  v_after    bigint;
  v_short    bigint;
  v_id       uuid;
  v_ref      text;
  v_state    text;
  v_out_n    integer;
  v_out_sum  bigint;
  v_open     jsonb;
begin
  if p_provider is null or p_provider not in ('paystack', 'flutterwave') or p_kind is null or p_kind not in ('refund', 'dispute')
     or coalesce(p_event_key, '') = '' or coalesce(p_reference, '') = ''
     or (p_refunded_minor is not null and p_refunded_minor <= 0) or (p_paid_minor is not null and p_paid_minor <= 0) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into v_ex from public.wallet_topup_reversals where provider = p_provider and event_key = p_event_key;
  if v_ex.id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'id', v_ex.id, 'state', v_ex.state, 'due', v_ex.credits_due, 'recovered', v_ex.credits_recovered, 'shortfall', v_ex.shortfall_credits);
  end if;

  -- what the ORIGINAL top-up credited: its recharge row and its pack bonus share our reference
  select user_id, sum(delta_cents), min(created_at) into v_user, v_credited, v_first
    from public.ai_product_ledger
   where product = 'character_replace' and reference = p_reference and kind in ('recharge', 'bonus')
   group by user_id
   order by min(created_at)
   limit 1;
  if v_user is null or coalesce(v_credited, 0) <= 0 then
    insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
    values (p_actor, 'wallet_topup_reversal_unmatched', 'wallet_topup', p_reference, p_reference,
            jsonb_build_object('provider', p_provider, 'event_key', p_event_key, 'kind', p_kind, 'refunded_minor', p_refunded_minor, 'review', 'no credited top-up has this reference'));
    return jsonb_build_object('ok', false, 'reason', 'not_credited');
  end if;

  -- every reversal of this wallet, and every spend from it, serialises on the balance row
  select balance_cents, withdrawable_cents, deposited_cents into v_bal, v_wd, v_dep
    from public.ai_product_balances where user_id = v_user and product = 'character_replace' for update;

  select coalesce(sum(credits_due), 0) into v_already from public.wallet_topup_reversals where reference = p_reference and state <> 'restored';
  v_remain := greatest(0, v_credited - v_already);
  if p_refunded_minor is null or p_paid_minor is null or p_refunded_minor >= p_paid_minor then
    v_due := v_remain;
  else
    -- a partial refund takes back its share of the credits, rounded UP (the platform is never short a fraction)
    v_due := least(v_remain, ceil(v_credited::numeric * p_refunded_minor / p_paid_minor)::bigint);
  end if;
  -- deposited credits first, then other withdrawable credits, then tokens. Never below zero.
  v_take := least(v_due, greatest(coalesce(v_bal, 0), 0));
  v_wpart := least(v_take, greatest(coalesce(v_wd, 0), 0));
  v_dpart := least(v_take, greatest(coalesce(v_dep, 0), 0));
  v_short := v_due - v_take;
  v_ref := 'topup-reversal:' || p_provider || ':' || p_event_key;
  v_state := case when p_kind = 'dispute' then 'held' else 'recovered' end;

  insert into public.wallet_topup_reversals (provider, event_key, kind, reference, user_id, paid_minor, paid_currency, refunded_minor,
                                             credits_credited, credits_due, credits_recovered, withdrawable_recovered, deposited_recovered,
                                             shortfall_credits, state, ledger_reference, actor_id, note)
  values (p_provider, p_event_key, p_kind, p_reference, v_user, p_paid_minor, p_paid_currency, p_refunded_minor,
          v_credited, v_due, v_take, v_wpart, v_dpart, v_short, v_state, v_ref, p_actor, p_note)
  on conflict (provider, event_key) do nothing
  returning id into v_id;
  if v_id is null then
    select * into v_ex from public.wallet_topup_reversals where provider = p_provider and event_key = p_event_key;
    return jsonb_build_object('ok', true, 'duplicate', true, 'id', v_ex.id, 'state', v_ex.state, 'due', v_ex.credits_due, 'recovered', v_ex.credits_recovered, 'shortfall', v_ex.shortfall_credits);
  end if;

  if v_take > 0 then
    update public.ai_product_balances
       set balance_cents = balance_cents - v_take, withdrawable_cents = withdrawable_cents - v_wpart, deposited_cents = deposited_cents - v_dpart, updated_at = now()
     where user_id = v_user and product = 'character_replace'
    returning balance_cents into v_after;
    insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, credit_class, withdrawable_part, metadata)
    values (v_user, 'character_replace', 'reversal', case when p_kind = 'dispute' then 'reserved' else 'settled' end, -v_take, v_after, 'CREDIT', v_ref,
            case when p_kind = 'dispute' then 'Held: the payment for a top-up is disputed' else 'Taken back: a top-up was refunded' end,
            case when v_wpart > 0 then 'withdrawable' else 'usable' end, v_wpart,
            jsonb_build_object('reversal_id', v_id, 'topup_reference', p_reference, 'provider', p_provider, 'kind', p_kind, 'deposited_part', v_dpart));
  end if;

  -- 0281: the shortfall row itself pauses this product (its block-reason function reads it). The account flag
  -- reward_profiles.restricted is an administrator's decision only and is not written here.

  select count(*), coalesce(sum(amount), 0) into v_out_n, v_out_sum from public.credit_transfers where sender_id = v_user and created_at >= v_first;
  select coalesce(jsonb_agg(id), '[]'::jsonb) into v_open from public.withdrawal_requests where user_id = v_user and status in ('pending', 'reviewing', 'approved', 'processing');
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_actor, 'wallet_topup_' || p_kind, 'wallet_topup_reversal', v_id::text, p_reference,
          jsonb_build_object('provider', p_provider, 'event_key', p_event_key, 'user_id', v_user, 'paid_minor', p_paid_minor, 'paid_currency', p_paid_currency,
                             'refunded_minor', p_refunded_minor, 'credited', v_credited, 'due', v_due, 'recovered', v_take, 'withdrawable_recovered', v_wpart,
                             'deposited_recovered', v_dpart, 'shortfall', v_short, 'state', v_state, 'transfers_out_since_topup', v_out_n,
                             'credits_sent_since_topup', v_out_sum, 'open_withdrawals', v_open, 'note', p_note));
  return jsonb_build_object('ok', true, 'id', v_id, 'user_id', v_user, 'state', v_state, 'due', v_due, 'recovered', v_take, 'shortfall', v_short, 'open_withdrawals', v_open);
end;
$$;

-- 0280's deposit reversal, restated without writing the account restriction (the shortfall row pauses coins).
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
  if p_provider is distinct from 'flutterwave' or p_kind is null or p_kind not in ('refund', 'dispute')
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
  execute 'revoke all on function public.coin_wallet_block_reason(uuid) from public, anon, authenticated';
  execute 'grant execute on function public.coin_wallet_block_reason(uuid) to service_role';
  execute 'revoke all on function public.credit_wallet_block_reason(uuid) from public, anon, authenticated';
  execute 'grant execute on function public.credit_wallet_block_reason(uuid) to service_role';
  execute 'revoke all on function public.transfer_coins(uuid, text, bigint, text, text, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.transfer_coins(uuid, text, bigint, text, text, jsonb) to service_role';
  execute 'revoke all on function public.request_coin_withdrawal(uuid, bigint, text, jsonb, text, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.request_coin_withdrawal(uuid, bigint, text, jsonb, text, jsonb) to service_role';
  execute 'revoke all on function public.reverse_wallet_topup(text, text, text, text, bigint, bigint, text, uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.reverse_wallet_topup(text, text, text, text, bigint, bigint, text, uuid, text) to service_role';
  execute 'revoke all on function public.reverse_coin_deposit(text, text, text, text, bigint, bigint, text, uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.reverse_coin_deposit(text, text, text, text, bigint, bigint, text, uuid, text) to service_role';
end;
$$;
