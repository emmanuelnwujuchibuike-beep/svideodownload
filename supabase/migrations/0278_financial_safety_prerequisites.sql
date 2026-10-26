-- ═══════════════════════════════════════════════════════════════════════════
--  0278 — Financial safety prerequisites (Frenz Coin Part 2, 2026-10-25)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Hardens the money that already exists (AI-credit wallet, SUB money, withdrawals) before any new
-- wallet is built on it. Every live money function (0187 request_withdrawal, 0202 transfer_credits,
-- 0256 resolve_withdrawal …) is left EXACTLY as it is: the new rules live in new, narrowly scoped
-- functions that take the same locks and then call the live ones, so an app that has not been updated
-- yet keeps working and a rollback is "stop calling the new function".
--
--   1. wallet_topup_reversals       a refund or chargeback of a wallet top-up (H1). One row per provider
--      reverse_wallet_topup         event (unique), tied to the ORIGINAL recharge/bonus ledger rows by our
--      resolve_wallet_topup_dispute reference. It takes back only what is still in the wallet (deposited
--      clear_wallet_topup_shortfall first, then other withdrawable, then tokens). What was already spent
--                                   or sent is a SHORTFALL: recorded on the row, the member's rewards
--                                   profile is restricted (no transfers, no withdrawals) and an admin
--                                   reviews it. A balance never goes negative and no ledger row is
--                                   rewritten. A dispute HOLDS the credits (a 'reserved' reversal row)
--                                   until an admin records the outcome: lost -> settled, won -> restored.
--   2. credit_wallet_block_reason   suspension (profiles.is_suspended), the rewards restriction and an open
--                                   recovery shortfall, read under the wallet row lock (M2).
--      transfer_credits_checked     locks both wallets in 0202's order, re-checks the sender and the
--                                   recipient, enforces the rolling 24-hour amount limit IN the transaction
--                                   (M3), then calls the live transfer_credits.
--      request_credit_withdrawal    locks the wallet, checks suspension, restriction, shortfall and the
--                                   admin-approved qualification (M1: qualified_at set or status approved,
--                                   the same rule as the rewards page), enforces the per-day count and the
--                                   30-day credit limit in the transaction (M3), stores a replay key, then
--                                   calls the live request_withdrawal.
--   3. account_financial_blockers   what stops an account purge (H3): withdrawable credits, SUB money or debt,
--      retain_financial_records     an open withdrawal, a payment in flight, an open recovery shortfall.
--                                   retain_* redacts bank details on old withdrawals (bank name + last four
--                                   only), closes a token-only balance with a ledger row, and audits it.
--      FK drops                     ledger, transfers, withdrawals, SUB ledger and purchases, top-up attempts,
--                                   verification purchases and plan renewals no longer CASCADE-delete with
--                                   auth.users. Their user id stays as a stable pseudonymous identifier.
--   4. platform_fee_ledger          the counter-entry for every transfer fee (a trigger on the ledger insert,
--                                   backfilled for existing fees).
--   5. ledger guards                ai_product_ledger: only the legitimate in-place changes are allowed (the
--                                   same-transaction fill-in of balance_after / class / withdrawable part, the
--                                   once-only notified_at claim, the reserved -> settled|refunded|reversed and
--                                   settled -> refunded status moves, FK set-null). No delete. sub_ledger,
--                                   financial_audit_log, credit_transfers and platform_fee_ledger are
--                                   append-only (FK set-null allowed). An operator correction needs
--                                   `set local frenz.ledger_maintenance = 'on'` and is written to the
--                                   financial audit log by the guard itself.
--
-- Depends on 0154, 0184, 0187, 0191, 0193, 0199, 0202, 0227, 0254, 0256. Tables from 0268 / 0274 are
-- touched only if they exist. Run by hand AFTER 0277. Safe to run twice. Proven in PGlite
-- (supabase/tests/0278_financial_safety.pglite.mjs, with mutants) and on a real PostgreSQL server with
-- separate connections (supabase/tests/credit_wallet_concurrency.pg.mjs).
-- No semicolon inside any quoted string. Every dollar-quoted block is at the end.

-- ── 1 · top-up refunds and chargebacks ──────────────────────────────────────
create table if not exists public.wallet_topup_reversals (
  id                     uuid primary key default gen_random_uuid(),
  provider               text not null,
  event_key              text not null,
  kind                   text not null,
  reference              text not null,
  user_id                uuid not null,
  paid_minor             bigint,
  paid_currency          text,
  refunded_minor         bigint,
  credits_credited       bigint not null,
  credits_due            bigint not null,
  credits_recovered      bigint not null,
  withdrawable_recovered bigint not null default 0,
  deposited_recovered    bigint not null default 0,
  shortfall_credits      bigint not null default 0,
  state                  text not null,
  ledger_reference       text not null,
  actor_id               uuid,
  note                   text,
  resolution_note        text,
  resolved_by            uuid,
  resolved_at            timestamptz,
  shortfall_cleared_at   timestamptz,
  shortfall_cleared_by   uuid,
  created_at             timestamptz not null default now(),
  constraint wallet_topup_reversals_provider_chk check (provider in ('paystack', 'flutterwave')),
  constraint wallet_topup_reversals_kind_chk check (kind in ('refund', 'dispute')),
  constraint wallet_topup_reversals_state_chk check (state in ('recovered', 'held', 'restored', 'lost')),
  constraint wallet_topup_reversals_amounts_chk check (
    credits_due >= 0 and credits_recovered >= 0 and credits_recovered <= credits_due
    and shortfall_credits = credits_due - credits_recovered
    and withdrawable_recovered between 0 and credits_recovered
    and deposited_recovered between 0 and withdrawable_recovered)
);
create unique index if not exists wallet_topup_reversals_event_uidx on public.wallet_topup_reversals (provider, event_key);
create index if not exists wallet_topup_reversals_reference_idx on public.wallet_topup_reversals (reference);
create index if not exists wallet_topup_reversals_open_idx on public.wallet_topup_reversals (user_id) where shortfall_credits > 0 and shortfall_cleared_at is null;
create index if not exists wallet_topup_reversals_held_idx on public.wallet_topup_reversals (created_at) where state = 'held';
alter table public.wallet_topup_reversals enable row level security;
revoke all on public.wallet_topup_reversals from public, anon, authenticated;
grant all on public.wallet_topup_reversals to service_role;
comment on table public.wallet_topup_reversals is 'A refund or chargeback of a wallet top-up (0278): what was due back, what was recovered from the wallet, and the shortfall an admin must settle. Service role only.';

-- ── 4 · the counter-entry for transfer fees ─────────────────────────────────
create table if not exists public.platform_fee_ledger (
  id                bigint generated always as identity primary key,
  source            text not null,
  source_ledger_id  uuid not null,
  reference         text not null,
  payer_id          uuid not null,
  amount            bigint not null,
  unit              text not null,
  credit_class      text,
  withdrawable_part bigint not null default 0,
  created_at        timestamptz not null default now(),
  constraint platform_fee_ledger_source_chk check (source in ('credit_transfer_fee')),
  constraint platform_fee_ledger_amount_chk check (amount > 0)
);
create unique index if not exists platform_fee_ledger_source_uidx on public.platform_fee_ledger (source, source_ledger_id);
create index if not exists platform_fee_ledger_created_idx on public.platform_fee_ledger (created_at desc);
alter table public.platform_fee_ledger enable row level security;
revoke all on public.platform_fee_ledger from public, anon, authenticated;
grant all on public.platform_fee_ledger to service_role;
comment on table public.platform_fee_ledger is 'Fee income: one row per fee taken from a member (0278), the counter-entry of the ledger row that took it. Append-only. Service role only.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

-- Lift the restriction a shortfall put on, once no other shortfall is open. A restriction set for any
-- other reason (an admin's) is never touched.
create or replace function public.lift_topup_shortfall_restriction(p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.wallet_topup_reversals where user_id = p_user and shortfall_credits > 0 and shortfall_cleared_at is null) then
    return false;
  end if;
  update public.reward_profiles set restricted = false, restricted_reason = null, updated_at = now()
   where user_id = p_user and restricted and restricted_reason = 'wallet_topup_shortfall';
  return found;
end;
$$;

-- A refund or a chargeback of a wallet top-up. Idempotent on (provider, event_key). Never takes more
-- than the top-up credited, in total, however many partial refunds arrive.
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

  if v_short > 0 then
    -- the credits were already spent or sent: no transfers and no withdrawals until an admin settles it
    insert into public.reward_profiles (user_id, restricted, restricted_reason, updated_at)
    values (v_user, true, 'wallet_topup_shortfall', now())
    on conflict (user_id) do update
      set restricted_reason = case when public.reward_profiles.restricted then public.reward_profiles.restricted_reason else 'wallet_topup_shortfall' end,
          restricted = true, updated_at = now();
  end if;

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

-- An admin records a dispute's outcome after confirming it with the provider. Once only.
create or replace function public.resolve_wallet_topup_dispute(p_id uuid, p_outcome text, p_actor uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_r     public.wallet_topup_reversals%rowtype;
  v_after bigint;
begin
  if p_id is null or p_actor is null or p_outcome is null or p_outcome not in ('won', 'lost') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into v_r from public.wallet_topup_reversals where id = p_id for update;
  if v_r.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_r.kind <> 'dispute' then return jsonb_build_object('ok', false, 'reason', 'not_a_dispute'); end if;
  if v_r.state <> 'held' then return jsonb_build_object('ok', true, 'duplicate', true, 'state', v_r.state); end if;
  perform 1 from public.ai_product_balances where user_id = v_r.user_id and product = 'character_replace' for update;

  if p_outcome = 'lost' then
    update public.ai_product_ledger set status = 'settled', updated_at = now()
     where user_id = v_r.user_id and product = 'character_replace' and kind = 'reversal' and reference = v_r.ledger_reference and status = 'reserved';
    update public.wallet_topup_reversals set state = 'lost', resolved_at = now(), resolved_by = p_actor, resolution_note = p_note where id = p_id;
  else
    if v_r.credits_recovered > 0 then
      update public.ai_product_balances
         set balance_cents = balance_cents + v_r.credits_recovered, withdrawable_cents = withdrawable_cents + v_r.withdrawable_recovered,
             deposited_cents = deposited_cents + v_r.deposited_recovered, updated_at = now()
       where user_id = v_r.user_id and product = 'character_replace'
      returning balance_cents into v_after;
      insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, credit_class, withdrawable_part, metadata)
      values (v_r.user_id, 'character_replace', 'refund', 'settled', v_r.credits_recovered, coalesce(v_after, v_r.credits_recovered), 'CREDIT', 'topup-restore:' || v_r.id::text,
              'Returned: the disputed top-up was upheld', case when v_r.withdrawable_recovered > 0 then 'withdrawable' else 'usable' end, v_r.withdrawable_recovered,
              jsonb_build_object('reversal_id', v_r.id, 'topup_reference', v_r.reference, 'deposited_part', v_r.deposited_recovered))
      on conflict (user_id, product, kind, reference) where reference is not null do nothing;
      update public.ai_product_ledger set status = 'refunded', updated_at = now()
       where user_id = v_r.user_id and product = 'character_replace' and kind = 'reversal' and reference = v_r.ledger_reference and status = 'reserved';
    end if;
    update public.wallet_topup_reversals
       set state = 'restored', resolved_at = now(), resolved_by = p_actor, resolution_note = p_note,
           shortfall_cleared_at = case when shortfall_credits > 0 then coalesce(shortfall_cleared_at, now()) else shortfall_cleared_at end,
           shortfall_cleared_by = case when shortfall_credits > 0 then coalesce(shortfall_cleared_by, p_actor) else shortfall_cleared_by end
     where id = p_id;
    perform public.lift_topup_shortfall_restriction(v_r.user_id);
  end if;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_actor, 'wallet_topup_dispute_' || p_outcome, 'wallet_topup_reversal', p_id::text, v_r.reference,
          jsonb_build_object('user_id', v_r.user_id, 'recovered', v_r.credits_recovered, 'shortfall', v_r.shortfall_credits, 'note', p_note));
  return jsonb_build_object('ok', true, 'state', case when p_outcome = 'lost' then 'lost' else 'restored' end);
end;
$$;

-- An admin settles a shortfall (recovered from the member, or written off). Lifts the restriction it caused.
create or replace function public.clear_wallet_topup_shortfall(p_id uuid, p_actor uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_r public.wallet_topup_reversals%rowtype;
begin
  if p_id is null or p_actor is null or coalesce(btrim(p_note), '') = '' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select * into v_r from public.wallet_topup_reversals where id = p_id for update;
  if v_r.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_r.shortfall_credits = 0 then return jsonb_build_object('ok', false, 'reason', 'no_shortfall'); end if;
  if v_r.shortfall_cleared_at is not null then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  update public.wallet_topup_reversals set shortfall_cleared_at = now(), shortfall_cleared_by = p_actor, resolution_note = coalesce(resolution_note || ' / ', '') || p_note where id = p_id;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_actor, 'wallet_topup_shortfall_cleared', 'wallet_topup_reversal', p_id::text, v_r.reference, jsonb_build_object('user_id', v_r.user_id, 'shortfall', v_r.shortfall_credits, 'note', p_note));
  return jsonb_build_object('ok', true, 'lifted', public.lift_topup_shortfall_restriction(v_r.user_id));
end;
$$;

-- Why this member may not move credits right now (null = they may). Read it under the wallet lock.
create or replace function public.credit_wallet_block_reason(p_user uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from public.profiles where id = p_user and is_suspended) then return 'suspended'; end if;
  if exists (select 1 from public.reward_profiles where user_id = p_user and restricted) then return 'restricted'; end if;
  if exists (select 1 from public.wallet_topup_reversals where user_id = p_user and shortfall_credits > 0 and shortfall_cleared_at is null) then return 'recovery_due'; end if;
  return null;
end;
$$;

-- 0202's transfer, with the account checks and the rolling 24-hour limit inside the transaction.
create or replace function public.transfer_credits_checked(
  p_sender uuid, p_account_number text, p_amount integer, p_fee integer, p_idempotency text, p_note text, p_class text, p_daily_max integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_recipient uuid;
  v_block     text;
  v_sent      bigint;
begin
  if p_sender is null or p_amount is null or p_amount <= 0 or p_fee is null or p_fee < 0 or coalesce(p_idempotency, '') = ''
     or p_daily_max is null or p_daily_max < 0 or p_class is null or p_class not in ('usable', 'withdrawable') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- a replay answers what the first request did (0202's own duplicate answer) and is never counted again
  if exists (select 1 from public.credit_transfers where sender_id = p_sender and idempotency_key = p_idempotency) then
    return public.transfer_credits(p_sender, p_account_number, p_amount, p_fee, p_idempotency, p_note, p_class);
  end if;
  select user_id into v_recipient from public.wallet_accounts where account_number = p_account_number;
  if v_recipient is null then return jsonb_build_object('ok', false, 'reason', 'no_account'); end if;
  if v_recipient = p_sender then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  -- the same fixed lock order as transfer_credits (0193/0202): two opposite transfers never deadlock
  insert into public.ai_product_balances (user_id, product, balance_cents, currency) values (v_recipient, 'character_replace', 0, 'CREDIT') on conflict (user_id, product) do nothing;
  perform 1 from public.ai_product_balances where product = 'character_replace' and user_id in (p_sender, v_recipient) order by user_id for update;
  v_block := public.credit_wallet_block_reason(p_sender);
  if v_block is not null then return jsonb_build_object('ok', false, 'reason', v_block); end if;
  if exists (select 1 from public.profiles where id = v_recipient and is_suspended) then return jsonb_build_object('ok', false, 'reason', 'recipient_unavailable'); end if;
  -- every transfer by this sender holds the sender's row lock, so this sum cannot be raced
  select coalesce(sum(amount), 0) into v_sent from public.credit_transfers where sender_id = p_sender and created_at >= now() - interval '24 hours';
  if v_sent + p_amount > p_daily_max then
    return jsonb_build_object('ok', false, 'reason', 'daily_limit', 'sent', v_sent, 'limit', p_daily_max);
  end if;
  return public.transfer_credits(p_sender, p_account_number, p_amount, p_fee, p_idempotency, p_note, p_class);
end;
$$;

-- 0187's withdrawal request, with eligibility and the day / 30-day limits inside the transaction.
-- p_credits is what is held (the amount plus the flat-fee credits); p_count_credits is what the 30-day
-- limit counts for THIS request (the amount asked for), exactly as lib/rewards/withdrawals.ts counted it.
create or replace function public.request_credit_withdrawal(
  p_user_id uuid, p_credits integer, p_count_credits integer, p_usd_cents integer, p_method text, p_details jsonb, p_snapshot jsonb,
  p_status text, p_idempotency text, p_max_per_day integer, p_max_credits_month integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ex    public.withdrawal_requests%rowtype;
  v_block text;
  v_prof  public.reward_profiles%rowtype;
  v_day   integer;
  v_month bigint;
  v_out   jsonb;
begin
  if p_user_id is null or p_credits is null or p_credits <= 0 or p_count_credits is null or p_count_credits <= 0
     or p_max_per_day is null or p_max_per_day < 1 or p_max_credits_month is null or p_max_credits_month < 1
     or coalesce(p_method, '') = '' or p_status is null or p_status not in ('pending', 'reviewing') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if p_idempotency is not null then
    select * into v_ex from public.withdrawal_requests where user_id = p_user_id and idempotency_key = p_idempotency;
    if v_ex.id is not null then return jsonb_build_object('ok', true, 'duplicate', true, 'id', v_ex.id, 'status', v_ex.status); end if;
  end if;
  -- every withdrawal (and every spend) of this wallet serialises here
  perform 1 from public.ai_product_balances where user_id = p_user_id and product = 'character_replace' for update;
  v_block := public.credit_wallet_block_reason(p_user_id);
  if v_block is not null then return jsonb_build_object('ok', false, 'reason', v_block); end if;
  select * into v_prof from public.reward_profiles where user_id = p_user_id;
  if v_prof.user_id is null or not (v_prof.qualified_at is not null or v_prof.qualification_status = 'approved') then
    return jsonb_build_object('ok', false, 'reason', 'not_qualified');
  end if;
  select count(*) into v_day from public.withdrawal_requests
   where user_id = p_user_id and coalesce(source, 'credits') = 'credits' and status not in ('rejected', 'cancelled') and created_at >= now() - interval '1 day';
  if v_day >= p_max_per_day then return jsonb_build_object('ok', false, 'reason', 'day_limit'); end if;
  select coalesce(sum(credits), 0) into v_month from public.withdrawal_requests
   where user_id = p_user_id and coalesce(source, 'credits') = 'credits' and status not in ('rejected', 'cancelled') and created_at >= now() - interval '30 days';
  if v_month + p_count_credits > p_max_credits_month then return jsonb_build_object('ok', false, 'reason', 'month_limit'); end if;
  begin
    v_out := public.request_withdrawal(p_user_id, p_credits, p_usd_cents, p_method, p_details, p_snapshot, p_status);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'open_exists');
  end;
  if coalesce((v_out ->> 'ok')::boolean, false) and p_idempotency is not null then
    update public.withdrawal_requests set idempotency_key = p_idempotency where id = (v_out ->> 'id')::uuid and idempotency_key is null;
  end if;
  return v_out;
end;
$$;

-- What must be settled before this account can be purged. Empty reasons = it may be.
create or replace function public.account_financial_blockers(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_reasons text[] := '{}';
  v_bal     bigint := 0;
  v_wd      bigint := 0;
begin
  select coalesce(balance_cents, 0), coalesce(withdrawable_cents, 0) into v_bal, v_wd
    from public.ai_product_balances where user_id = p_user and product = 'character_replace';
  if coalesce(v_wd, 0) > 0 then v_reasons := array_append(v_reasons, 'withdrawable_balance'); end if;
  if exists (select 1 from public.sub_balances where creator_id = p_user and (pending_cents + available_cents + held_cents) > 0) then v_reasons := array_append(v_reasons, 'sub_balance'); end if;
  if exists (select 1 from public.sub_balances where creator_id = p_user and debt_cents > 0) then v_reasons := array_append(v_reasons, 'sub_debt'); end if;
  if exists (select 1 from public.withdrawal_requests where user_id = p_user and status in ('pending', 'reviewing', 'approved', 'processing')) then v_reasons := array_append(v_reasons, 'open_withdrawal'); end if;
  if exists (select 1 from public.ai_topup_attempts where user_id = p_user and status in ('pending', 'verification_required') and created_at > now() - interval '7 days') then v_reasons := array_append(v_reasons, 'payment_in_flight'); end if;
  if exists (select 1 from public.wallet_topup_reversals where user_id = p_user and ((shortfall_credits > 0 and shortfall_cleared_at is null) or state = 'held')) then v_reasons := array_append(v_reasons, 'recovery_due'); end if;
  return jsonb_build_object('ok', cardinality(v_reasons) = 0, 'reasons', to_jsonb(v_reasons), 'tokens', greatest(coalesce(v_bal, 0) - coalesce(v_wd, 0), 0));
end;
$$;

-- Right before an account is purged: re-check, redact, close a token-only balance, audit. The financial
-- rows themselves stay (0278 dropped their cascades), keyed by the deleted account's id.
create or replace function public.retain_financial_records(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_block  jsonb;
  v_bal    bigint;
  v_redact integer;
begin
  if p_user is null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if not exists (select 1 from public.profiles where id = p_user and deletion_requested_at is not null) then
    return jsonb_build_object('ok', false, 'reason', 'not_requested');
  end if;
  perform 1 from public.ai_product_balances where user_id = p_user and product = 'character_replace' for update;
  v_block := public.account_financial_blockers(p_user);
  if not coalesce((v_block ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'blocked', 'reasons', v_block -> 'reasons');
  end if;
  -- bank details on past withdrawals: the bank and the last four digits stay for reconciliation
  update public.withdrawal_requests
     set payout_details = jsonb_strip_nulls(jsonb_build_object('redacted', true, 'bankName', payout_details ->> 'bankName', 'bankCode', payout_details ->> 'bankCode',
                                                               'last4', right(coalesce(payout_details ->> 'accountNumber', ''), 4), 'country', payout_details ->> 'country',
                                                               'rail', payout_details ->> 'rail')),
         updated_at = now()
   where user_id = p_user and not coalesce((payout_details ->> 'redacted')::boolean, false);
  get diagnostics v_redact = row_count;
  -- a token-only balance is closed with a ledger row, so the ledger still sums to what was held
  select balance_cents into v_bal from public.ai_product_balances where user_id = p_user and product = 'character_replace';
  if coalesce(v_bal, 0) > 0 then
    update public.ai_product_balances set balance_cents = 0, updated_at = now() where user_id = p_user and product = 'character_replace';
    insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, credit_class, withdrawable_part, metadata)
    values (p_user, 'character_replace', 'adjustment', 'settled', -v_bal, 0, 'CREDIT', 'account-closed:' || p_user::text, 'Account deleted: unused tokens closed', 'usable', 0,
            jsonb_build_object('reason', 'account_deleted'))
    on conflict (user_id, product, kind, reference) where reference is not null do nothing;
  end if;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (null, 'account_financial_records_retained', 'account', p_user::text, 'account-closed:' || p_user::text,
          jsonb_build_object('tokens_closed', coalesce(v_bal, 0), 'withdrawals_redacted', v_redact));
  return jsonb_build_object('ok', true, 'tokens_closed', coalesce(v_bal, 0), 'withdrawals_redacted', v_redact);
end;
$$;

-- The ledger's legitimate in-place changes, and nothing else.
create or replace function public.ai_product_ledger_guard() returns trigger
language plpgsql as $$
begin
  if current_setting('frenz.ledger_maintenance', true) = 'on' then
    insert into public.financial_audit_log (action, target_type, target_id, reference, details)
    values ('ledger_maintenance_' || lower(tg_op), 'ai_product_ledger', old.id::text, old.reference,
            jsonb_build_object('before', to_jsonb(old), 'after', case when tg_op = 'UPDATE' then to_jsonb(new) end));
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'ai_product_ledger rows are permanent (0278)';
  end if;
  if new.id is distinct from old.id or new.user_id is distinct from old.user_id or new.product is distinct from old.product
     or new.kind is distinct from old.kind or new.delta_cents is distinct from old.delta_cents or new.currency is distinct from old.currency
     or new.reference is distinct from old.reference or new.snapshot is distinct from old.snapshot or new.note is distinct from old.note
     or new.metadata is distinct from old.metadata or new.created_at is distinct from old.created_at then
    raise exception 'ai_product_ledger: a recorded movement cannot be rewritten (0278)';
  end if;
  -- the FKs that are ON DELETE SET NULL may clear, never repoint
  if new.job_id is distinct from old.job_id and new.job_id is not null then raise exception 'ai_product_ledger: job_id cannot be repointed (0278)'; end if;
  if new.actor_admin_id is distinct from old.actor_admin_id and new.actor_admin_id is not null then raise exception 'ai_product_ledger: actor cannot be repointed (0278)'; end if;
  -- the writers fill these in right after their own insert, in the same transaction (0187, 0202, 0256)
  if (new.balance_after_cents is distinct from old.balance_after_cents or new.credit_class is distinct from old.credit_class
      or new.withdrawable_part is distinct from old.withdrawable_part)
     and not (old.created_at = now() and old.balance_after_cents = 0) then
    raise exception 'ai_product_ledger: balance_after, class and withdrawable part are fixed once written (0278)';
  end if;
  if new.notified_at is distinct from old.notified_at and old.notified_at is not null then raise exception 'ai_product_ledger: notified_at is claimed once (0278)'; end if;
  if new.status is distinct from old.status
     and not ((old.status = 'reserved' and new.status in ('settled', 'refunded', 'reversed')) or (old.status = 'settled' and new.status = 'refunded')) then
    raise exception 'ai_product_ledger: status % cannot become % (0278)', old.status, new.status;
  end if;
  return new;
end;
$$;

-- Append-only, for tables whose rows are history. TG_ARGV names the columns an ON DELETE SET NULL may clear.
create or replace function public.financial_append_only_guard() returns trigger
language plpgsql as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb;
  k     text;
begin
  if current_setting('frenz.ledger_maintenance', true) = 'on' then
    if tg_table_name <> 'financial_audit_log' then
      insert into public.financial_audit_log (action, target_type, target_id, details)
      values ('ledger_maintenance_' || lower(tg_op), tg_table_name, v_old ->> 'id', jsonb_build_object('before', v_old, 'after', case when tg_op = 'UPDATE' then to_jsonb(new) end));
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception '% rows are permanent (0278)', tg_table_name;
  end if;
  v_new := to_jsonb(new);
  foreach k in array coalesce(tg_argv, '{}'::text[]) loop
    if (v_new -> k) is distinct from (v_old -> k) and (v_new -> k) <> 'null'::jsonb then
      raise exception '%.% may only be cleared (0278)', tg_table_name, k;
    end if;
    v_new := v_new - k;
    v_old := v_old - k;
  end loop;
  if v_new is distinct from v_old then
    raise exception '% rows are permanent (0278)', tg_table_name;
  end if;
  return new;
end;
$$;

-- Every transfer fee gets its counter-entry the moment the fee row is written.
create or replace function public.post_transfer_fee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'transfer_fee' and new.delta_cents < 0 and new.user_id is not null then
    insert into public.platform_fee_ledger (source, source_ledger_id, reference, payer_id, amount, unit, credit_class, withdrawable_part, created_at)
    values ('credit_transfer_fee', new.id, coalesce(new.reference, new.id::text), new.user_id, -new.delta_cents, coalesce(new.currency, 'CREDIT'), new.credit_class, coalesce(new.withdrawable_part, 0), new.created_at)
    on conflict (source, source_ledger_id) do nothing;
  end if;
  return new;
end;
$$;

do $$
declare
  r record;
begin
  -- 3 · financial history no longer cascades away with an account (the user id stays as its stable identifier)
  for r in
    select n.nspname, cl.relname, c.conname
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.confdeltype = 'c' and n.nspname = 'public'
       and (cl.relname || '.' || a.attname) = any (array[
         'ai_product_ledger.user_id', 'credit_transfers.sender_id', 'credit_transfers.recipient_id', 'withdrawal_requests.user_id',
         'sub_ledger.creator_id', 'sub_purchases.creator_id', 'sub_purchases.subscriber_id', 'ai_topup_attempts.user_id',
         'verification_purchases.user_id', 'plan_renewals.user_id'])
  loop
    execute format('alter table %I.%I drop constraint %I', r.nspname, r.relname, r.conname);
  end loop;

  -- 4 · fee counter-entries: the trigger, and every fee taken before it
  execute 'drop trigger if exists ai_product_ledger_post_fee on public.ai_product_ledger';
  execute 'create trigger ai_product_ledger_post_fee after insert on public.ai_product_ledger for each row when (new.kind = ''transfer_fee'') execute function public.post_transfer_fee()';
  insert into public.platform_fee_ledger (source, source_ledger_id, reference, payer_id, amount, unit, credit_class, withdrawable_part, created_at)
  select 'credit_transfer_fee', l.id, coalesce(l.reference, l.id::text), l.user_id, -l.delta_cents, coalesce(l.currency, 'CREDIT'), l.credit_class, coalesce(l.withdrawable_part, 0), l.created_at
    from public.ai_product_ledger l
   where l.kind = 'transfer_fee' and l.delta_cents < 0 and l.user_id is not null
  on conflict (source, source_ledger_id) do nothing;

  -- 5 · the guards
  execute 'drop trigger if exists ai_product_ledger_guard on public.ai_product_ledger';
  execute 'create trigger ai_product_ledger_guard before update or delete on public.ai_product_ledger for each row execute function public.ai_product_ledger_guard()';
  execute 'drop trigger if exists sub_ledger_append_only on public.sub_ledger';
  execute 'create trigger sub_ledger_append_only before update or delete on public.sub_ledger for each row execute function public.financial_append_only_guard(''actor_id'', ''purchase_id'')';
  execute 'drop trigger if exists financial_audit_log_append_only on public.financial_audit_log';
  execute 'create trigger financial_audit_log_append_only before update or delete on public.financial_audit_log for each row execute function public.financial_append_only_guard(''actor_id'')';
  execute 'drop trigger if exists credit_transfers_append_only on public.credit_transfers';
  execute 'create trigger credit_transfers_append_only before update or delete on public.credit_transfers for each row execute function public.financial_append_only_guard()';
  execute 'drop trigger if exists platform_fee_ledger_append_only on public.platform_fee_ledger';
  execute 'create trigger platform_fee_ledger_append_only before update or delete on public.platform_fee_ledger for each row execute function public.financial_append_only_guard()';

  -- service role only (Postgres grants EXECUTE to PUBLIC by default)
  execute 'revoke all on function public.lift_topup_shortfall_restriction(uuid) from public, anon, authenticated';
  execute 'revoke all on function public.reverse_wallet_topup(text, text, text, text, bigint, bigint, text, uuid, text) from public, anon, authenticated';
  execute 'revoke all on function public.resolve_wallet_topup_dispute(uuid, text, uuid, text) from public, anon, authenticated';
  execute 'revoke all on function public.clear_wallet_topup_shortfall(uuid, uuid, text) from public, anon, authenticated';
  execute 'revoke all on function public.credit_wallet_block_reason(uuid) from public, anon, authenticated';
  execute 'revoke all on function public.transfer_credits_checked(uuid, text, integer, integer, text, text, text, integer) from public, anon, authenticated';
  execute 'revoke all on function public.request_credit_withdrawal(uuid, integer, integer, integer, text, jsonb, jsonb, text, text, integer, integer) from public, anon, authenticated';
  execute 'revoke all on function public.account_financial_blockers(uuid) from public, anon, authenticated';
  execute 'revoke all on function public.retain_financial_records(uuid) from public, anon, authenticated';
  execute 'revoke all on function public.post_transfer_fee() from public, anon, authenticated';
  execute 'grant execute on function public.lift_topup_shortfall_restriction(uuid) to service_role';
  execute 'grant execute on function public.reverse_wallet_topup(text, text, text, text, bigint, bigint, text, uuid, text) to service_role';
  execute 'grant execute on function public.resolve_wallet_topup_dispute(uuid, text, uuid, text) to service_role';
  execute 'grant execute on function public.clear_wallet_topup_shortfall(uuid, uuid, text) to service_role';
  execute 'grant execute on function public.credit_wallet_block_reason(uuid) to service_role';
  execute 'grant execute on function public.transfer_credits_checked(uuid, text, integer, integer, text, text, text, integer) to service_role';
  execute 'grant execute on function public.request_credit_withdrawal(uuid, integer, integer, integer, text, jsonb, jsonb, text, text, integer, integer) to service_role';
  execute 'grant execute on function public.account_financial_blockers(uuid) to service_role';
  execute 'grant execute on function public.retain_financial_records(uuid) to service_role';
end;
$$;
