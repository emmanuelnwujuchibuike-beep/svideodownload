-- ═══════════════════════════════════════════════════════════════════════════
--  0309 — an affiliate earns on DEPOSITS SPENT ON AI, not on deposits (2026-10-30)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-30: "users who are in affiliate programme doesn't earn from every deposit but deposit spent on AI …
-- so in case another affiliate user doesn't deposit and withdraw for the percentage". 0255 queued a commission the
-- moment an invited member's payment settled — so a member could deposit, cash the deposit out, and their affiliate
-- still earned on it. Now:
--
--   · a wallet TOP-UP queues nothing (0255's trigger keeps only AI plans — money paid straight for AI);
--   · an AI charge records how much of it came out of DEPOSITED credits (ai_product_ledger.deposited_part). Credits
--     are spent earned-first (0187: cashable last; 0202: deposited after earned), so the deposited part of a charge is
--     exactly how far that charge lowered deposited_cents — captured by a balance trigger that runs after 0202's clamp
--     and read by the ledger row the same function inserts next (reserve_product_charge: balance, then ledger);
--   · when that charge SETTLES (the AI job completed — never a refunded or failed one) the affiliate's share of its
--     deposited part is queued (purpose 'ai_spend', currency 'CREDIT', reference 'spend:<ledger id>'), and the
--     existing sweep pays it (lib/rewards/v2-sweeps.ts → grant_affiliate_commission), re-checking the affiliate.
--
-- Additive and idempotent. Until it runs, 0255 behaves as before (commissions on payments).
-- No semicolon inside any quoted string (the 0186 lesson). Functions and DO blocks last.

alter table public.ai_product_balances add column if not exists last_deposited_debit bigint not null default 0;
alter table public.ai_product_balances add column if not exists last_debit_balance bigint;
comment on column public.ai_product_balances.last_deposited_debit is
  'How far the LAST update lowered deposited_cents (0309) — read by the ledger row an AI charge inserts right after its balance update.';
comment on column public.ai_product_balances.last_debit_balance is
  'balance_cents after that last update (0309): the ledger row must carry the same balance_after to claim last_deposited_debit.';

alter table public.ai_product_ledger add column if not exists deposited_part bigint;
comment on column public.ai_product_ledger.deposited_part is
  'For an AI charge: the credits of it that came from paid deposits (0309). An affiliate earns a share of this once the charge settles.';

-- the commission's own purpose
do $$
begin
  alter table public.affiliate_commissions drop constraint if exists affiliate_commissions_chk;
  alter table public.affiliate_commissions add constraint affiliate_commissions_chk check (
    status in ('queued', 'granted', 'skipped') and purpose in ('wallet_topup', 'ai_subscription', 'ad_campaign', 'ai_spend')
    and amount_minor > 0 and rate_bp between 0 and 5000 and (credits is null or credits >= 0) and affiliate_id <> referred_user_id);
end $$;

-- 1 · every balance update remembers how far it lowered deposited_cents (after 0202's clamp: zz_ sorts last)
create or replace function public.track_deposited_debit() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.last_deposited_debit := greatest(coalesce(old.deposited_cents, 0) - coalesce(new.deposited_cents, 0), 0);
  else
    new.last_deposited_debit := 0;
  end if;
  new.last_debit_balance := new.balance_cents;
  return new;
end;
$$;

-- 2 · an AI charge claims it as its deposited part — only when it is THIS charge's update (same balance after)
create or replace function public.ledger_deposited_part() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_debit   bigint;
  v_balance bigint;
begin
  if new.kind = 'processing_charge' and new.deposited_part is null then
    select last_deposited_debit, last_debit_balance into v_debit, v_balance
      from public.ai_product_balances where user_id = new.user_id and product = new.product;
    new.deposited_part := case when v_balance is not distinct from new.balance_after_cents then greatest(coalesce(v_debit, 0), 0) else 0 end;
  end if;
  return new;
end;
$$;

-- 3 · the charge settled: queue the inviting affiliate's share of its deposited part, once
create or replace function public.queue_affiliate_spend_commission() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_ref  uuid;
  v_rate integer;
begin
  if new.kind = 'processing_charge' and new.status = 'settled' and coalesce(new.deposited_part, 0) > 0
     and (tg_op = 'INSERT' or old.status is distinct from 'settled') then
    begin
      select a.referrer_id into v_ref from public.referral_attributions a where a.referred_user_id = new.user_id and a.status = 'active';
      if v_ref is not null and v_ref <> new.user_id then
        select rate_bp into v_rate from public.affiliate_accounts where user_id = v_ref and status = 'approved';
        if v_rate is not null and v_rate > 0 then
          insert into public.affiliate_commissions (reference, affiliate_id, referred_user_id, purpose, amount_minor, currency, fx_minor_per_usd, rate_bp)
          values ('spend:' || new.id::text, v_ref, new.user_id, 'ai_spend', new.deposited_part, 'CREDIT', null, v_rate)
          on conflict (reference) do nothing;
        end if;
      end if;
    exception when others then
      -- a commission can never cost a member their AI job
      raise warning 'affiliate spend commission queue failed: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

-- 4 · 0255's payment trigger keeps AI PLANS only (money paid straight for AI); a top-up or an ad earns nothing now
create or replace function public.queue_affiliate_commission() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_ref  uuid;
  v_rate integer;
begin
  if new.status = 'success' and (tg_op = 'INSERT' or old.status is distinct from 'success')
     and coalesce(new.purpose, 'wallet_topup') = 'ai_subscription' then
    begin
      select a.referrer_id into v_ref from public.referral_attributions a where a.referred_user_id = new.user_id and a.status = 'active';
      if v_ref is not null and v_ref <> new.user_id then
        select rate_bp into v_rate from public.affiliate_accounts where user_id = v_ref and status = 'approved';
        if v_rate is not null and v_rate > 0 then
          insert into public.affiliate_commissions (reference, affiliate_id, referred_user_id, purpose, amount_minor, currency, fx_minor_per_usd, rate_bp)
          values (new.reference, v_ref, new.user_id, 'ai_subscription', new.amount_cents, new.currency, new.fx_minor_per_usd, v_rate)
          on conflict (reference) do nothing;
        end if;
      end if;
    exception when others then
      raise warning 'affiliate commission queue failed: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

do $$
begin
  execute 'drop trigger if exists ai_product_balances_zz_deposited_debit on public.ai_product_balances';
  execute 'create trigger ai_product_balances_zz_deposited_debit before insert or update on public.ai_product_balances for each row execute function public.track_deposited_debit()';
  execute 'drop trigger if exists ai_product_ledger_deposited_part on public.ai_product_ledger';
  execute 'create trigger ai_product_ledger_deposited_part before insert on public.ai_product_ledger for each row when (new.kind = ''processing_charge'') execute function public.ledger_deposited_part()';
  execute 'drop trigger if exists ai_product_ledger_affiliate_spend on public.ai_product_ledger';
  execute 'create trigger ai_product_ledger_affiliate_spend after insert or update of status on public.ai_product_ledger for each row when (new.kind = ''processing_charge'') execute function public.queue_affiliate_spend_commission()';
  execute 'revoke all on function public.ledger_deposited_part() from public, anon, authenticated';
  execute 'revoke all on function public.queue_affiliate_spend_commission() from public, anon, authenticated';
end $$;
