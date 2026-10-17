-- 0254 — Frenz Exclusive Part 12 follow-up: a paid-out withdrawal that the bank sent back, and a
-- dispute the platform won. Both are rare, both move money, and both must happen exactly once.
--
--   withdrawal_requests.status   gains 'reversed': a payout that COMPLETED and that Paystack later
--                                confirmed came back (transfer.reversed, re-checked with
--                                /transfer/verify by the server before this is called).
--   reverse_paid_withdrawal      completed -> reversed, once. For a SUB withdrawal the gross goes back
--                                to the creator's available balance (withdrawn falls by the same), with
--                                its own ledger row (kind 'withdrawal_reversed', unique per withdrawal)
--                                and an audit row. An AI-credit withdrawal is NOT changed here: it is
--                                audited for a manual return (that wallet's rules are not this file's).
--   restore_disputed_sub_purchase
--                                a purchase reversed as 'disputed' that the platform then WON. This
--                                integration has no provider event for a dispute's outcome, so an
--                                ADMIN calls it (actor required) after confirming the outcome in the
--                                Paystack dashboard. disputed -> paid, once: the earning comes back
--                                (ledger 'dispute_restore', unique per purchase; any debt the dispute
--                                created is settled first by release_sub_earnings), and the access the
--                                payment bought is given back up to that purchase's own period end
--                                (never to a member the creator removed).
--
-- Additive: one constraint widened, two new functions, service role only. No row is rewritten.
-- No semicolon inside any quoted string. Every dollar-quoted block is at the end.

alter table public.withdrawal_requests drop constraint if exists withdrawal_requests_status_chk;
alter table public.withdrawal_requests add constraint withdrawal_requests_status_chk
  check (status in ('pending', 'reviewing', 'approved', 'processing', 'completed', 'rejected', 'cancelled', 'reversed'));
-- 0227's ledger kinds, restated whole with the two new ones
alter table public.sub_ledger drop constraint if exists sub_ledger_kind_chk;
alter table public.sub_ledger add constraint sub_ledger_kind_chk
  check (kind in ('earning', 'release', 'withdrawal_hold', 'withdrawal_paid', 'withdrawal_return', 'clawback', 'adjustment', 'withdrawal_reversed', 'dispute_restore'));

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.reverse_paid_withdrawal(p_id uuid, p_actor uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_w public.withdrawal_requests%rowtype;
  v_b public.sub_balances%rowtype;
begin
  select * into v_w from public.withdrawal_requests where id = p_id for update;
  if v_w.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_w.status = 'reversed' then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if v_w.status <> 'completed' then return jsonb_build_object('ok', false, 'reason', 'not_completed', 'status', v_w.status); end if;
  if v_w.source is distinct from 'sub' then
    insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
    values (p_actor, 'withdrawal_reversal_manual', 'withdrawal', p_id::text, coalesce(v_w.payout_reference, 'withdrawal:' || p_id::text), jsonb_build_object('source', v_w.source, 'credits', v_w.credits, 'note', p_note));
    return jsonb_build_object('ok', false, 'reason', 'manual', 'source', v_w.source);
  end if;
  update public.withdrawal_requests set status = 'reversed', review_note = coalesce(p_note, review_note), updated_at = now() where id = p_id;
  insert into public.sub_balances (creator_id) values (v_w.user_id) on conflict (creator_id) do nothing;
  update public.sub_balances
     set withdrawn_cents = greatest(0, withdrawn_cents - v_w.gross_cents), available_cents = available_cents + v_w.gross_cents, updated_at = now()
   where creator_id = v_w.user_id returning * into v_b;
  insert into public.sub_ledger (creator_id, kind, amount_cents, pending_after, available_after, reference, withdrawal_id, actor_id, note)
  values (v_w.user_id, 'withdrawal_reversed', v_w.gross_cents, v_b.pending_cents, v_b.available_cents, 'withdrawal:' || p_id::text, p_id, p_actor, coalesce(p_note, 'Payout returned by the bank'));
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_actor, 'withdrawal_reversed', 'withdrawal', p_id::text, coalesce(v_w.payout_reference, 'withdrawal:' || p_id::text), jsonb_build_object('source', 'sub', 'gross', v_w.gross_cents, 'net', v_w.net_cents, 'note', p_note));
  insert into public.notifications (user_id, type, data) values (v_w.user_id, 'withdrawal_update', jsonb_build_object('withdrawal_id', p_id, 'status', 'reversed', 'source', 'sub', 'net_cents', v_w.net_cents));
  return jsonb_build_object('ok', true, 'available_after', v_b.available_cents);
end;
$$;

create or replace function public.restore_disputed_sub_purchase(p_reference text, p_actor uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_p   public.sub_purchases%rowtype;
  v_m   public.creator_memberships%rowtype;
  v_b   public.sub_balances%rowtype;
  v_end timestamptz;
begin
  if p_actor is null or coalesce(trim(p_note), '') = '' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select * into v_p from public.sub_purchases where reference = p_reference for update;
  if v_p.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_p.status = 'paid' and exists (select 1 from public.sub_ledger where kind = 'dispute_restore' and reference = 'purchase:' || v_p.id::text) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  if v_p.status <> 'disputed' then return jsonb_build_object('ok', false, 'reason', 'not_disputed', 'status', v_p.status); end if;

  -- the earning comes back as unreleased (available now), so release_sub_earnings settles any debt first
  update public.sub_purchases set status = 'paid', reversed_at = null, released_at = null, available_at = least(coalesce(available_at, now()), now()), updated_at = now() where id = v_p.id;
  insert into public.sub_balances (creator_id) values (v_p.creator_id) on conflict (creator_id) do nothing;
  update public.sub_balances set pending_cents = pending_cents + v_p.price_cents, lifetime_cents = lifetime_cents + v_p.price_cents, updated_at = now()
   where creator_id = v_p.creator_id returning * into v_b;
  insert into public.sub_ledger (creator_id, kind, amount_cents, pending_after, available_after, reference, purchase_id, actor_id, note)
  values (v_p.creator_id, 'dispute_restore', v_p.price_cents, v_b.pending_cents, v_b.available_cents, 'purchase:' || v_p.id::text, v_p.id, p_actor, p_note);

  -- the access this payment bought, up to its own period end - never for a member the creator removed
  select * into v_m from public.creator_memberships where creator_id = v_p.creator_id and member_id = v_p.subscriber_id for update;
  if v_m.id is not null and v_m.status <> 'removed' and v_p.period_end is not null then
    v_end := greatest(coalesce(v_m.period_end, v_p.period_end), v_p.period_end);
    update public.creator_memberships
       set period_end = v_end, billing = 'sub',
           status = case when v_end > now() then 'active' else status end,
           ended_at = case when v_end > now() then null else ended_at end
     where id = v_m.id;
  end if;
  perform public.release_sub_earnings(v_p.creator_id);

  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_actor, 'sub_dispute_won_restored', 'sub_purchase', v_p.id::text, p_reference, jsonb_build_object('price_cents', v_p.price_cents, 'note', p_note));
  return jsonb_build_object('ok', true);
end;
$$;

do $$
begin
  execute 'revoke all on function public.reverse_paid_withdrawal(uuid, uuid, text) from public, anon, authenticated';
  execute 'revoke all on function public.restore_disputed_sub_purchase(text, uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.reverse_paid_withdrawal(uuid, uuid, text) to service_role';
  execute 'grant execute on function public.restore_disputed_sub_purchase(text, uuid, text) to service_role';
end;
$$;
