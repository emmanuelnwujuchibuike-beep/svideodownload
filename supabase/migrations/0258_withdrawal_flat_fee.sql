-- 0258 — a flat fee on every private-post withdrawal (owner, 2026-10-17): "an additional flat $0.2
-- fee for every withdraw … balance must cover before withdraw can be made … flat fee covers below
-- $300, above flat fee is 0.5, above 500 is flat of $1". The tiers live in the admin's SUB settings
-- (sub.flatFees, lib/rewards/config.ts); the server passes the fee in, this function charges it.
--
-- request_sub_withdrawal (0227, LIVE — restated here whole, not edited there) gains p_flat_fee_cents:
--   · the balance must cover the amount AND the flat fee, or the request is refused ('insufficient')
--   · the minimum still applies to the amount itself
--   · net (what is paid out, = amount_usd_cents) = amount - the percentage fee   (unchanged)
--   · fee_cents = the percentage fee + the flat fee
--   · gross_cents = amount + flat fee = everything that leaves the balance, so the hold, a
--     rejection (0256 resolve_withdrawal returns gross_cents), a payout (withdrawn += gross_cents)
--     and a bank return (0254 reverse_paid_withdrawal) all move the flat fee with the rest — none of
--     them change, and 0227's check (gross = fee + net, amount_usd_cents = net) still holds.
-- The old 9-argument function is dropped first so exactly one exists; a caller that sends no flat
-- fee gets the default 0, i.e. the old behaviour.
--
-- Depends on 0227. Order: 0253 -> 0254 -> 0255 -> 0256 -> 0257 -> 0258.
-- AI-credit withdrawals take the same flat fee in lib/rewards/withdrawals.ts (no SQL change there).
-- No semicolon inside any quoted string. Every dollar-quoted block is at the end.

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
begin
  execute 'drop function if exists public.request_sub_withdrawal(uuid, integer, integer, integer, text, jsonb, jsonb, text, boolean)';
end;
$$;

create or replace function public.request_sub_withdrawal(
  p_user uuid, p_gross_cents integer, p_fee_bp integer, p_min_cents integer, p_method text, p_details jsonb, p_snapshot jsonb, p_idempotency text,
  p_require_qualification boolean, p_flat_fee_cents integer default 0
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_prof  public.reward_profiles%rowtype;
  v_b     public.sub_balances%rowtype;
  v_fee   bigint;
  v_net   bigint;
  v_id    uuid;
  v_ex    public.withdrawal_requests%rowtype;
  v_flat  bigint := greatest(0, coalesce(p_flat_fee_cents, 0));
  v_total bigint;
begin
  if p_user is null or p_gross_cents is null or p_gross_cents <= 0 or p_fee_bp is null or p_fee_bp < 0 or p_fee_bp >= 10000
     or coalesce(p_idempotency, '') = '' or coalesce(p_method, '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into v_ex from public.withdrawal_requests where user_id = p_user and idempotency_key = p_idempotency;
  if v_ex.id is not null then return jsonb_build_object('ok', true, 'duplicate', true, 'id', v_ex.id, 'status', v_ex.status); end if;
  select * into v_prof from public.reward_profiles where user_id = p_user;
  if coalesce(p_require_qualification, false) and (v_prof.user_id is null or v_prof.qualification_status is distinct from 'approved' or v_prof.qualified_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'not_qualified');
  end if;
  if coalesce(v_prof.restricted, false) then return jsonb_build_object('ok', false, 'reason', 'restricted'); end if;
  if p_gross_cents < coalesce(p_min_cents, 0) then return jsonb_build_object('ok', false, 'reason', 'below_minimum'); end if;

  perform public.release_sub_earnings(p_user);
  select * into v_b from public.sub_balances where creator_id = p_user for update;
  v_total := p_gross_cents::bigint + v_flat;
  if v_b.available_cents < v_total then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'available', v_b.available_cents);
  end if;
  -- the percentage fee comes off the amount withdrawn; the flat fee is ON TOP (0258)
  v_net := p_gross_cents - (p_gross_cents::bigint * p_fee_bp) / 10000;
  v_fee := v_total - v_net;

  begin
    insert into public.withdrawal_requests (user_id, credits, amount_usd_cents, rate_snapshot, status, payout_method, payout_details, source, gross_cents, fee_cents, net_cents, fee_bp, idempotency_key)
    values (p_user, 0, v_net, coalesce(p_snapshot, '{}'::jsonb), 'pending', p_method, coalesce(p_details, '{}'::jsonb), 'sub', v_total, v_fee, v_net, p_fee_bp, p_idempotency)
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'open_exists');
  end;
  update public.sub_balances set available_cents = available_cents - v_total, held_cents = held_cents + v_total, updated_at = now()
   where creator_id = p_user returning * into v_b;
  insert into public.sub_ledger (creator_id, kind, amount_cents, pending_after, available_after, reference, withdrawal_id, note)
  values (p_user, 'withdrawal_hold', -v_total, v_b.pending_cents, v_b.available_cents, 'withdrawal:' || v_id::text, v_id, 'Withdrawal requested');
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_user, 'sub_withdrawal_requested', 'withdrawal', v_id::text, 'withdrawal:' || v_id::text, jsonb_build_object('gross', v_total, 'amount', p_gross_cents, 'fee', v_fee, 'flat_fee', v_flat, 'net', v_net, 'fee_bp', p_fee_bp, 'method', p_method));
  return jsonb_build_object('ok', true, 'id', v_id, 'gross', v_total, 'amount', p_gross_cents, 'fee', v_fee, 'flat_fee', v_flat, 'net', v_net);
end;
$$;

do $$
begin
  execute 'revoke all on function public.request_sub_withdrawal(uuid, integer, integer, integer, text, jsonb, jsonb, text, boolean, integer) from public, anon, authenticated';
  execute 'grant execute on function public.request_sub_withdrawal(uuid, integer, integer, integer, text, jsonb, jsonb, text, boolean, integer) to service_role';
end;
$$;
