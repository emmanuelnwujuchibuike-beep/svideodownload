-- 0256 — Frenz Exclusive Part 12 closure: a REJECTED or CANCELLED SUB withdrawal settles the
-- creator's refund debt before its money becomes available again.
--
-- Why a new migration: resolve_withdrawal was last defined in 0227, which is LIVE in production.
-- Published migrations are not rewritten, so the corrected function is restated here whole.
--
-- The defect (0227): rejecting a held withdrawal put its whole gross back into available_cents even
-- when the creator owed debt_cents (a refund or dispute that clawed back more than was available).
-- The creator could then withdraw that money again while still owing. Every other path that adds
-- money back already settles debt first: release_sub_earnings (0227) and reverse_paid_withdrawal
-- (0254). This makes the rejection path the same.
--
-- What changes, and only this:
--   · SUB rejected / cancelled: v_pay = least(debt, gross); available += gross - v_pay; debt -= v_pay;
--     held -= gross. The withdrawal_return ledger row keeps the FULL gross (it is released reserved
--     money, never an earning) and its note names the debt settled, the same convention as the
--     release row's "Released, after settling a refund". The audit row records debt_settled.
--   · 'reversed' (0254) is treated as a final state too (it was already refused as an invalid move).
-- Unchanged: every legal transition, the completed branch, the AI-credit branch, the audit and the
-- notification, the arguments and the grants. Lifetime, withdrawn and pending are not touched by a
-- rejection, before or after.
--
-- Invariant kept: pending + available + held + withdrawn - debt = lifetime
--   (held -gross, available +(gross - pay), debt -pay: net 0).
--
-- Depends on 0227 (the tables, the function it replaces). Runs before or after 0254 (the text
-- 'reversed' needs no schema), so the owner's order 0253 -> 0254 -> 0255 -> 0256 is fine.
-- No semicolon inside any quoted string. Every dollar-quoted block is at the end.

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.resolve_withdrawal(
  p_id uuid, p_status text, p_admin uuid, p_note text default null, p_payout_ref text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_w       public.withdrawal_requests%rowtype;
  v_balance bigint;
  v_b       public.sub_balances%rowtype;
  v_pay     bigint := 0;
begin
  select * into v_w from public.withdrawal_requests where id = p_id for update;
  if v_w.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_w.status in ('completed', 'rejected', 'cancelled', 'reversed') then return jsonb_build_object('ok', false, 'reason', 'final', 'status', v_w.status); end if;
  if not (
       (v_w.status = 'pending' and p_status in ('reviewing', 'approved', 'processing', 'rejected', 'cancelled'))
    or (v_w.status = 'reviewing' and p_status in ('approved', 'rejected', 'cancelled'))
    or (v_w.status = 'approved' and p_status in ('processing', 'completed', 'rejected', 'cancelled'))
    or (v_w.status = 'processing' and p_status in ('completed', 'rejected'))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition', 'from', v_w.status, 'to', p_status);
  end if;
  update public.withdrawal_requests
     set status = p_status, review_note = coalesce(p_note, review_note), reviewed_by = coalesce(p_admin, reviewed_by),
         payout_reference = coalesce(p_payout_ref, payout_reference), updated_at = now(),
         completed_at = case when p_status = 'completed' then now() else completed_at end
   where id = p_id;

  if v_w.source = 'sub' then
    if p_status in ('completed', 'rejected', 'cancelled') then
      insert into public.sub_balances (creator_id) values (v_w.user_id) on conflict (creator_id) do nothing;
      if p_status = 'completed' then
        update public.sub_balances set held_cents = greatest(0, held_cents - v_w.gross_cents), withdrawn_cents = withdrawn_cents + v_w.gross_cents, updated_at = now()
         where creator_id = v_w.user_id returning * into v_b;
        insert into public.sub_ledger (creator_id, kind, amount_cents, pending_after, available_after, reference, withdrawal_id, actor_id, note)
        values (v_w.user_id, 'withdrawal_paid', 0, v_b.pending_cents, v_b.available_cents, 'withdrawal:' || p_id::text, p_id, p_admin, 'Paid ' || v_w.net_cents || ' cents, fee ' || v_w.fee_cents)
        on conflict (kind, reference) do nothing;
      else
        -- 0256: the released money settles any refund debt FIRST (as release_sub_earnings and
        -- reverse_paid_withdrawal do); only the rest becomes available again. The balance row is
        -- locked before the debt is read, and the withdrawal row above already serialises callers.
        select * into v_b from public.sub_balances where creator_id = v_w.user_id for update;
        v_pay := least(coalesce(v_b.debt_cents, 0), v_w.gross_cents);
        update public.sub_balances
           set held_cents = greatest(0, held_cents - v_w.gross_cents),
               available_cents = available_cents + v_w.gross_cents - v_pay,
               debt_cents = debt_cents - v_pay,
               updated_at = now()
         where creator_id = v_w.user_id returning * into v_b;
        insert into public.sub_ledger (creator_id, kind, amount_cents, pending_after, available_after, reference, withdrawal_id, actor_id, note)
        values (v_w.user_id, 'withdrawal_return', v_w.gross_cents, v_b.pending_cents, v_b.available_cents, 'withdrawal:' || p_id::text, p_id, p_admin,
                'Withdrawal ' || p_status || case when v_pay > 0 then ', after settling a refund (' || v_pay || ' cents)' else '' end)
        on conflict (kind, reference) do nothing;
      end if;
    end if;
  elsif p_status = 'completed' then
    update public.ai_product_ledger set status = 'settled', updated_at = now() where reference = 'withdrawal:' || p_id::text and kind = 'withdrawal';
  elsif p_status in ('rejected', 'cancelled') then
    insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, credit_class, withdrawable_part, metadata)
    values (v_w.user_id, 'character_replace', 'withdrawal_reversal', 'settled', v_w.credits, 0, 'CREDIT', 'withdrawal:' || p_id::text, 'Withdrawal ' || p_status, 'withdrawable', v_w.credits, jsonb_build_object('withdrawal_id', p_id))
    on conflict (user_id, product, kind, reference) where reference is not null do nothing;
    if found then
      update public.ai_product_balances set balance_cents = balance_cents + v_w.credits, withdrawable_cents = withdrawable_cents + v_w.credits, updated_at = now()
       where user_id = v_w.user_id and product = 'character_replace' returning balance_cents into v_balance;
      update public.ai_product_ledger set balance_after_cents = v_balance, updated_at = now() where reference = 'withdrawal:' || p_id::text and kind = 'withdrawal_reversal';
      update public.ai_product_ledger set status = 'reversed', updated_at = now() where reference = 'withdrawal:' || p_id::text and kind = 'withdrawal';
    end if;
  end if;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_admin, 'withdrawal_' || p_status, 'withdrawal', p_id::text, coalesce(p_payout_ref, 'withdrawal:' || p_id::text), jsonb_build_object('source', v_w.source, 'from', v_w.status, 'note', p_note, 'debt_settled', v_pay));
  insert into public.notifications (user_id, type, data) values (v_w.user_id, 'withdrawal_update', jsonb_build_object('withdrawal_id', p_id, 'status', p_status, 'credits', v_w.credits, 'source', v_w.source, 'net_cents', v_w.net_cents));
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

do $$
begin
  execute 'revoke all on function public.resolve_withdrawal(uuid, text, uuid, text, text) from public, anon, authenticated';
  execute 'grant execute on function public.resolve_withdrawal(uuid, text, uuid, text, text) to service_role';
end;
$$;
