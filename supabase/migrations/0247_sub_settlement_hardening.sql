-- 0247 — Frenz Exclusive Part 2: SUB payment reliability and exclusive-content moderation
-- (docs/FRENZ_EXCLUSIVE_PART1_AUDIT.md S1/R2, docs/SUB_MONETIZATION.md "Part 2 hardening").
--
--   sub_purchases.failure_source  WHY a purchase is 'failed'. Only a failure the app assigned
--                                 from a still-unfinished checkout (verify said abandoned/failed,
--                                 or initialize was refused) may later settle - and only from a
--                                 charge Paystack verifies, at the quoted amount and currency.
--                                 A Paystack reversal or a refund that arrived before settlement
--                                 is final. Null on an older 'failed' row = treated as recoverable
--                                 (the only way it settles is a verified, correctly-priced charge).
--   sub_purchases.status          gains 'refund_due': a verified payment that arrived after the
--                                 creator REMOVED the member. No access, no creator earnings,
--                                 audited; an admin refunds it in Paystack and the refund webhook
--                                 closes it as 'refunded'.
--   settle_sub_purchase           same signature and return shape. Recovers a recoverable failure,
--                                 refuses a removed member, audits every refusal.
--   reverse_sub_purchase          same signature and return shape. Closes 'refund_due'; a refund
--                                 before settlement makes the row final (never settles later).
--   reports.target_type           gains 'sub_post' and 'sub_comment' (every older value kept).
--   sub_posts.moderated_*         who took a post down and when (status 'archived', media kept).
--   sub_post_comments.hidden_*    an admin takedown hides a comment instead of deleting it.
--
-- Additive and idempotent. No row is rewritten. No grant is widened: the money functions stay
-- service_role only. Works before and after 0239 (sub_post_comments may not exist yet).
-- No semicolon inside any quoted string. Every dollar-quoted block is at the end.

alter table public.sub_purchases add column if not exists failure_source text;
comment on column public.sub_purchases.failure_source is '0247: why a purchase is failed. verify_abandoned / verify_failed / init_refused may still settle from a verified charge. provider_reversed / reversal_before_payment are final.';

alter table public.sub_posts add column if not exists moderated_at timestamptz;
alter table public.sub_posts add column if not exists moderated_by uuid references auth.users (id) on delete set null;

alter table if exists public.sub_post_comments add column if not exists hidden_at timestamptz;
alter table if exists public.sub_post_comments add column if not exists hidden_by uuid references auth.users (id) on delete set null;

-- the purchases an admin must refund by hand are found by this
create index if not exists sub_purchases_refund_due_idx on public.sub_purchases (created_at desc) where status = 'refund_due';

-- reports: every existing target type stays valid
alter table public.reports drop constraint if exists reports_target_chk;
alter table public.reports add constraint reports_target_chk check (target_type in ('post', 'comment', 'user', 'sub_post', 'sub_comment'));

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
begin
  -- 0227's money check, restated whole with 'refund_due' added
  alter table public.sub_purchases drop constraint if exists sub_purchases_money_chk;
  alter table public.sub_purchases add constraint sub_purchases_money_chk check (
    price_cents > 0 and fee_cents >= 0 and total_cents = price_cents + fee_cents
    and fee_bp between 0 and 10000 and charged_minor > 0 and period_days between 1 and 366 and hold_days between 0 and 90
    and status in ('initiated', 'paid', 'failed', 'refunded', 'disputed', 'reversed', 'refund_due'));
  begin
    alter table public.sub_purchases add constraint sub_purchases_failure_source_chk check (
      failure_source is null or failure_source in ('verify_abandoned', 'verify_failed', 'init_refused', 'provider_reversed', 'reversal_before_payment'));
  exception when duplicate_object then null;
  end;
end;
$$;

-- A verified Paystack charge: grants the paid period and credits the creator. Answers a
-- duplicate with what it did the first time. Refuses an amount or currency that does not
-- match what was quoted. 0247: a purchase the APP marked failed while the checkout was
-- still open settles here when Paystack later verifies the charge; a final state never
-- does; a member the creator removed is not let back in (the payment becomes refund_due).
create or replace function public.settle_sub_purchase(p_reference text, p_paid_minor bigint, p_paid_currency text, p_provider_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_p         public.sub_purchases%rowtype;
  v_m         public.creator_memberships%rowtype;
  v_start     timestamptz;
  v_end       timestamptz;
  v_b         public.sub_balances%rowtype;
  v_recovered boolean := false;
begin
  select * into v_p from public.sub_purchases where reference = p_reference for update;
  if v_p.id is null then
    insert into public.financial_audit_log (action, target_type, target_id, reference, details)
    values ('sub_settle_refused', 'sub_purchase', null, left(p_reference, 120), jsonb_build_object('reason', 'not_found', 'paid', p_paid_minor, 'currency', p_paid_currency));
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_p.status = 'paid' then return jsonb_build_object('ok', true, 'duplicate', true, 'purchase_id', v_p.id); end if;
  if v_p.status = 'refund_due' then return jsonb_build_object('ok', false, 'reason', 'removed', 'duplicate', true, 'purchase_id', v_p.id); end if;
  if v_p.status = 'failed' and coalesce(v_p.failure_source, 'verify_abandoned') in ('verify_abandoned', 'verify_failed', 'init_refused') then
    v_recovered := true;
  elsif v_p.status <> 'initiated' then
    insert into public.financial_audit_log (action, target_type, target_id, reference, details)
    values ('sub_settle_refused', 'sub_purchase', v_p.id::text, p_reference, jsonb_build_object('reason', 'not_payable', 'status', v_p.status, 'failure_source', v_p.failure_source, 'paid', p_paid_minor, 'currency', p_paid_currency));
    return jsonb_build_object('ok', false, 'reason', 'not_payable', 'status', v_p.status);
  end if;
  if p_paid_currency is distinct from v_p.charged_currency or coalesce(p_paid_minor, 0) < v_p.charged_minor then
    insert into public.financial_audit_log (action, target_type, target_id, reference, details)
    values ('sub_payment_mismatch', 'sub_purchase', v_p.id::text, p_reference, jsonb_build_object('paid', p_paid_minor, 'currency', p_paid_currency, 'expected', v_p.charged_minor, 'expected_currency', v_p.charged_currency));
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;

  select * into v_m from public.creator_memberships where creator_id = v_p.creator_id and member_id = v_p.subscriber_id for update;
  -- removal and money are separate: the charge is recorded, access is NOT granted, the creator
  -- earns nothing from it, and the refund owed is on the audit log for an admin
  if v_m.id is not null and v_m.status = 'removed' then
    update public.sub_purchases
       set status = 'refund_due', paid_at = now(), provider_ref = p_provider_ref, failure_source = null, updated_at = now()
     where id = v_p.id;
    insert into public.financial_audit_log (action, target_type, target_id, reference, details)
    values ('sub_payment_after_removal', 'sub_purchase', v_p.id::text, p_reference, jsonb_build_object('creator_id', v_p.creator_id, 'subscriber_id', v_p.subscriber_id, 'paid', p_paid_minor, 'currency', p_paid_currency, 'refund', 'due'));
    return jsonb_build_object('ok', false, 'reason', 'removed', 'purchase_id', v_p.id);
  end if;

  if v_m.id is null then
    insert into public.creator_memberships (creator_id, member_id, status, billing, price_cents, period_index, period_end)
    values (v_p.creator_id, v_p.subscriber_id, 'active', 'sub', v_p.price_cents, 0, now())
    on conflict (creator_id, member_id) do nothing;
    select * into v_m from public.creator_memberships where creator_id = v_p.creator_id and member_id = v_p.subscriber_id for update;
  end if;
  -- a renewal before expiry extends from the current end, otherwise from now
  v_start := greatest(now(), coalesce(case when v_m.billing = 'sub' and v_m.status = 'active' then v_m.period_end end, now()));
  v_end := v_start + make_interval(days => v_p.period_days);
  update public.creator_memberships
     set status = 'active', billing = 'sub', price_cents = v_p.price_cents, period_index = period_index + 1, period_start = v_start, period_end = v_end, ended_at = null,
         joined_at = case when v_m.status in ('ended', 'lapsed') or v_m.period_index = 0 then now() else joined_at end
   where id = v_m.id;

  update public.sub_purchases
     set status = 'paid', paid_at = now(), provider_ref = p_provider_ref, period_start = v_start, period_end = v_end, failure_source = null,
         available_at = now() + make_interval(days => v_p.hold_days), updated_at = now()
   where id = v_p.id;

  insert into public.sub_balances (creator_id) values (v_p.creator_id) on conflict (creator_id) do nothing;
  update public.sub_balances set pending_cents = pending_cents + v_p.price_cents, lifetime_cents = lifetime_cents + v_p.price_cents, updated_at = now()
   where creator_id = v_p.creator_id returning * into v_b;
  insert into public.sub_ledger (creator_id, kind, amount_cents, pending_after, available_after, reference, purchase_id, note)
  values (v_p.creator_id, 'earning', v_p.price_cents, v_b.pending_cents, v_b.available_cents, 'purchase:' || v_p.id::text, v_p.id, 'Subscription');
  -- with no hold (the owner default), it is withdrawable at once
  if v_p.hold_days = 0 then perform public.release_sub_earnings(v_p.creator_id); end if;

  if v_recovered then
    insert into public.financial_audit_log (action, target_type, target_id, reference, details)
    values ('sub_purchase_recovered', 'sub_purchase', v_p.id::text, p_reference, jsonb_build_object('failure_source', coalesce(v_p.failure_source, 'legacy'), 'paid', p_paid_minor, 'currency', p_paid_currency));
  end if;
  insert into public.notifications (user_id, actor_id, type, data)
  values (v_p.creator_id, v_p.subscriber_id, 'member_joined', jsonb_build_object('purchase_id', v_p.id, 'url', '/members'));
  return jsonb_build_object('ok', true, 'purchase_id', v_p.id, 'period_end', v_end, 'recovered', v_recovered);
end;
$$;

-- A refund, a chargeback or an admin reversal. Unreleased money leaves pending, released money
-- leaves available, and whatever was already withdrawn becomes debt the next earnings settle.
-- The paid period is taken back. 0247: a refund_due payment is closed with no balance change,
-- and a refund that arrives before the purchase settled makes it final.
create or replace function public.reverse_sub_purchase(p_reference text, p_status text, p_actor uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_p    public.sub_purchases%rowtype;
  v_b    public.sub_balances%rowtype;
  v_take bigint;
begin
  if p_status not in ('refunded', 'disputed', 'reversed') then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select * into v_p from public.sub_purchases where reference = p_reference for update;
  if v_p.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_p.status in ('refunded', 'disputed', 'reversed') then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if v_p.status = 'refund_due' then
    update public.sub_purchases set status = p_status, reversed_at = now(), updated_at = now() where id = v_p.id;
    insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
    values (p_actor, 'sub_purchase_' || p_status, 'sub_purchase', v_p.id::text, p_reference, jsonb_build_object('price_cents', v_p.price_cents, 'note', p_note, 'was', 'refund_due'));
    return jsonb_build_object('ok', true, 'refund_due_closed', true);
  end if;
  if v_p.status <> 'paid' then
    update public.sub_purchases set status = 'failed', failure_source = 'reversal_before_payment', updated_at = now() where id = v_p.id and status in ('initiated', 'failed');
    insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
    values (p_actor, 'sub_reversal_before_settlement', 'sub_purchase', v_p.id::text, p_reference, jsonb_build_object('status', p_status, 'was', v_p.status, 'note', p_note));
    return jsonb_build_object('ok', true, 'unpaid', true);
  end if;
  insert into public.sub_balances (creator_id) values (v_p.creator_id) on conflict (creator_id) do nothing;
  select * into v_b from public.sub_balances where creator_id = v_p.creator_id for update;
  if v_p.released_at is null then
    update public.sub_balances set pending_cents = greatest(0, pending_cents - v_p.price_cents), lifetime_cents = greatest(0, lifetime_cents - v_p.price_cents), updated_at = now()
     where creator_id = v_p.creator_id returning * into v_b;
  else
    v_take := least(v_b.available_cents, v_p.price_cents);
    update public.sub_balances
       set available_cents = available_cents - v_take, debt_cents = debt_cents + (v_p.price_cents - v_take), lifetime_cents = greatest(0, lifetime_cents - v_p.price_cents), updated_at = now()
     where creator_id = v_p.creator_id returning * into v_b;
  end if;
  update public.sub_purchases set status = p_status, reversed_at = now(), updated_at = now() where id = v_p.id;
  -- the access this payment bought is taken back
  update public.creator_memberships
     set period_end = greatest(period_start, period_end - make_interval(days => v_p.period_days)),
         status = case when status = 'removed' then status when period_end - make_interval(days => v_p.period_days) <= now() then 'ended' else status end,
         ended_at = case when status = 'removed' then ended_at when period_end - make_interval(days => v_p.period_days) <= now() then now() else ended_at end
   where creator_id = v_p.creator_id and member_id = v_p.subscriber_id and billing = 'sub';
  insert into public.sub_ledger (creator_id, kind, amount_cents, pending_after, available_after, reference, purchase_id, actor_id, note)
  values (v_p.creator_id, 'clawback', -v_p.price_cents, v_b.pending_cents, v_b.available_cents, 'purchase:' || v_p.id::text, v_p.id, p_actor, coalesce(p_note, p_status));
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_actor, 'sub_purchase_' || p_status, 'sub_purchase', v_p.id::text, p_reference, jsonb_build_object('price_cents', v_p.price_cents, 'note', p_note, 'debt_after', v_b.debt_cents));
  return jsonb_build_object('ok', true, 'debt_after', v_b.debt_cents);
end;
$$;

do $$
begin
  execute 'revoke all on function public.settle_sub_purchase(text, bigint, text, text) from public, anon, authenticated';
  execute 'revoke all on function public.reverse_sub_purchase(text, text, uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.settle_sub_purchase(text, bigint, text, text) to service_role';
  execute 'grant execute on function public.reverse_sub_purchase(text, text, uuid, text) to service_role';
end;
$$;
