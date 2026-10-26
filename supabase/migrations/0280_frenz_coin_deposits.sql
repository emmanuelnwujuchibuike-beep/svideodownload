-- ═══════════════════════════════════════════════════════════════════════════
--  0280 — Frenz Coin: deposits, the deposit hold, deposit reversals (Frenz Coin Part 4, 2026-10-25)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Builds on 0278 (financial safety) and 0279 (the coin wallet). Coins are still the `frenz_coin` product in
-- ai_product_balances / ai_product_ledger, in integer US cents. AI Credits are not read, converted or debited.
--
-- ── A deposit, end to end ───────────────────────────────────────────────────
--   begin_coin_deposit     the attempt row (ai_topup_attempts, purpose coin_deposit) BEFORE any checkout: the member,
--                          the USD amount, what the provider will be asked for, the hold in hours and the rules, all
--                          from the server. One open deposit per member at a time (advisory lock), and a replayed
--                          idempotency key answers the attempt it made.
--   settle_coin_deposit    after the SERVER verified the charge with the provider: the paid amount and currency must
--                          equal the attempt row exactly (re-checked here under the row lock). Once per reference
--                          (coin_deposits primary key). Credits the coin wallet as PENDING: a ledger row of the NEW
--                          kind `deposit`, status reserved, and pending_cents rises with balance_cents.
--   the hold               release_at = the database's now() at settlement + the hold the attempt was opened with,
--                          never under 72 hours (constraint and code). Pending coins cannot be sent or withdrawn:
--                          transfer_coins and request_coin_withdrawal spend balance - pending only (0279).
--   release_coin_deposit / release_due_coin_deposits   the ONLY way out of the hold: at or after release_at, by the
--                          database clock, once. release_coin_pending (0279) now refuses a deposit row.
--
-- ── Rewards ─────────────────────────────────────────────────────────────────
--   0187's reward_on_topup_trg fires on EVERY `recharge` ledger row, whatever the product. A coin deposit is the
--   kind `deposit`, so it never matches, and the trigger is restated with a product filter as a second wall.
--   0255's affiliate trigger on ai_topup_attempts already lists its purposes (coin_deposit is not one).
--   AI-credit top-ups keep firing both exactly as before.
--
-- ── Refunds and chargebacks of a deposit (coin_deposit_reversals) ──────────
--   reverse_coin_deposit   once per provider event, never more than the deposit in total. A deposit still ON HOLD is
--                          taken back whole from its own pending coins (nothing of it could have been spent): no
--                          shortfall is possible. A RELEASED deposit is recovered from available coins only. What was
--                          already spent or sent is a SHORTFALL: recorded, the account restricted, an admin settles
--                          it. Recipients are never clawed back. Never a negative balance, never a rewritten row.
--                          A dispute on a held deposit freezes its release; on a released one it holds what it can.
--                          A PARTIAL refund changes nothing automatically: it is recorded for review.
--   resolve_coin_deposit_dispute / clear_coin_deposit_shortfall   an admin's recorded outcome. Once only, audited.
--
-- ── Also restated (each word for word, plus the lines marked 0280) ─────────
--   release_coin_pending (0279)         refuses a deposit row: the hold cannot be skipped by reference.
--   transfer_coins (0279)               a replayed idempotency key that names another amount or recipient is refused
--                                        (idempotency_conflict) instead of answering the earlier transfer.
--   credit_wallet_block_reason (0278)   an open coin deposit shortfall is `recovery_due`.
--   account_financial_blockers (0279)   an open coin deposit shortfall or dispute blocks a purge (coin_recovery_due).
--
-- No checkout, payout or provider call happens in SQL. Depends on 0151, 0186, 0187, 0197, 0255, 0273, 0278, 0279.
-- Run by hand AFTER 0279. Safe to run twice. No semicolon inside any quoted string. Every dollar-quoted block is last.

-- ── the deposit purpose, the deposit kind ───────────────────────────────────
alter table public.ai_topup_attempts drop constraint if exists ai_topup_attempts_purpose_chk;
alter table public.ai_topup_attempts
  add constraint ai_topup_attempts_purpose_chk check (purpose in ('wallet_topup', 'ai_subscription', 'ad_campaign', 'site_subscription', 'coin_deposit')) not valid;
alter table public.ai_topup_attempts validate constraint ai_topup_attempts_purpose_chk;
comment on column public.ai_topup_attempts.purpose is 'What the payment is for: wallet_topup | ai_subscription | ad_campaign | site_subscription (0273) | coin_deposit (0280, Frenz Coin, settled by settle_coin_deposit only).';
-- a replayed deposit request (same member, same key) answers the attempt it already made
create unique index if not exists ai_topup_attempts_coin_idem_uidx on public.ai_topup_attempts (user_id, ((metadata ->> 'idempotency_key'))) where purpose = 'coin_deposit';

alter table public.ai_product_ledger drop constraint if exists ai_product_ledger_kind_chk;
alter table public.ai_product_ledger add constraint ai_product_ledger_kind_chk
  check (kind in ('recharge', 'processing_charge', 'refund', 'adjustment', 'reversal', 'bonus', 'grant', 'withdrawal', 'withdrawal_reversal', 'transfer_out', 'transfer_in', 'transfer_fee', 'deposit'));
alter table public.ai_product_ledger drop constraint if exists ai_product_ledger_sign_chk;
alter table public.ai_product_ledger add constraint ai_product_ledger_sign_chk check (
  (kind in ('recharge', 'refund', 'bonus', 'grant', 'withdrawal_reversal', 'transfer_in', 'deposit') and delta_cents > 0)
  or (kind in ('processing_charge', 'reversal', 'withdrawal', 'transfer_out', 'transfer_fee') and delta_cents < 0)
  or (kind = 'adjustment' and delta_cents <> 0)
);
-- `deposit` is a Frenz Coin kind only: an AI-credit top-up stays `recharge` (and keeps its rewards)
alter table public.ai_product_ledger drop constraint if exists ai_product_ledger_deposit_coin_chk;
alter table public.ai_product_ledger add constraint ai_product_ledger_deposit_coin_chk check (kind <> 'deposit' or product = 'frenz_coin');

-- ── coin_deposits: one row per settled deposit, and its hold ────────────────
create table if not exists public.coin_deposits (
  reference      text primary key,
  user_id        uuid not null,
  amount_cents   bigint not null,
  provider       text not null,
  charge_id      text,
  paid_minor     bigint not null,
  paid_currency  text not null,
  hold_hours     integer not null,
  settled_at     timestamptz not null default now(),
  release_at     timestamptz not null,
  status         text not null default 'held',
  ledger_id      uuid not null,
  released_at    timestamptz,
  reversed_at    timestamptz,
  rules_snapshot jsonb,
  created_at     timestamptz not null default now(),
  constraint coin_deposits_amount_chk check (amount_cents > 0 and paid_minor > 0),
  constraint coin_deposits_provider_chk check (provider in ('flutterwave')),
  constraint coin_deposits_hold_chk check (hold_hours between 72 and 2160 and release_at >= settled_at + make_interval(hours => hold_hours)),
  constraint coin_deposits_status_chk check (status in ('held', 'disputed', 'released', 'reversed')),
  constraint coin_deposits_released_chk check ((status = 'released') = (released_at is not null) or status = 'reversed')
);
create unique index if not exists coin_deposits_ledger_uidx on public.coin_deposits (ledger_id);
create index if not exists coin_deposits_due_idx on public.coin_deposits (release_at) where status = 'held';
create index if not exists coin_deposits_user_idx on public.coin_deposits (user_id, settled_at desc);
alter table public.coin_deposits enable row level security;
revoke all on public.coin_deposits from public, anon, authenticated;
grant all on public.coin_deposits to service_role;
comment on table public.coin_deposits is 'Frenz Coin deposits (0280): one row per settled deposit, when it was settled and the earliest time it may be released (database clock, at least 72 hours). Written by settle_coin_deposit, moved only by the coin release and reversal functions. Service role only. No foreign key to auth.users (history outlives an account, 0278).';

-- ── coin_deposit_reversals: a refund or chargeback of a coin deposit ────────
create table if not exists public.coin_deposit_reversals (
  id                   uuid primary key default gen_random_uuid(),
  provider             text not null,
  event_key            text not null,
  kind                 text not null,
  reference            text not null,
  user_id              uuid not null,
  phase                text not null,
  paid_minor           bigint,
  paid_currency        text,
  refunded_minor       bigint,
  deposit_cents        bigint not null,
  due_cents            bigint not null,
  recovered_cents      bigint not null,
  shortfall_cents      bigint not null default 0,
  state                text not null,
  ledger_reference     text not null,
  actor_id             uuid,
  note                 text,
  resolution_note      text,
  resolved_by          uuid,
  resolved_at          timestamptz,
  shortfall_cleared_at timestamptz,
  shortfall_cleared_by uuid,
  created_at           timestamptz not null default now(),
  constraint coin_deposit_reversals_provider_chk check (provider in ('flutterwave')),
  constraint coin_deposit_reversals_kind_chk check (kind in ('refund', 'dispute')),
  constraint coin_deposit_reversals_phase_chk check (phase in ('held', 'released')),
  constraint coin_deposit_reversals_state_chk check (state in ('recovered', 'disputed', 'restored', 'lost', 'review')),
  constraint coin_deposit_reversals_amounts_chk check (
    due_cents >= 0 and recovered_cents >= 0 and recovered_cents <= due_cents and due_cents <= deposit_cents
    and shortfall_cents = due_cents - recovered_cents
    and (state <> 'review' or due_cents = 0))
);
create unique index if not exists coin_deposit_reversals_event_uidx on public.coin_deposit_reversals (provider, event_key);
create index if not exists coin_deposit_reversals_reference_idx on public.coin_deposit_reversals (reference);
create index if not exists coin_deposit_reversals_open_idx on public.coin_deposit_reversals (user_id) where shortfall_cents > 0 and shortfall_cleared_at is null;
alter table public.coin_deposit_reversals enable row level security;
revoke all on public.coin_deposit_reversals from public, anon, authenticated;
grant all on public.coin_deposit_reversals to service_role;
comment on table public.coin_deposit_reversals is 'A refund or chargeback of a Frenz Coin deposit (0280): what was due back, what was recovered from the coin wallet, and the shortfall an admin must settle. A partial refund is state review (nothing applied). Service role only.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

-- A coin deposit row: identity, amount, timing and the hold are fixed once written. Status moves only forward
-- (held -> disputed | released | reversed, disputed -> held | reversed, released -> reversed). Never deleted.
create or replace function public.coin_deposit_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'coin_deposits rows are permanent (0280)'; end if;
  if new.reference is distinct from old.reference or new.user_id is distinct from old.user_id or new.amount_cents is distinct from old.amount_cents
     or new.provider is distinct from old.provider or new.charge_id is distinct from old.charge_id or new.paid_minor is distinct from old.paid_minor
     or new.paid_currency is distinct from old.paid_currency or new.hold_hours is distinct from old.hold_hours or new.settled_at is distinct from old.settled_at
     or new.release_at is distinct from old.release_at or new.ledger_id is distinct from old.ledger_id or new.rules_snapshot is distinct from old.rules_snapshot
     or new.created_at is distinct from old.created_at then
    raise exception 'coin_deposits: a settled deposit and its hold cannot be rewritten (0280)';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'held' and new.status in ('disputed', 'released', 'reversed'))
    or (old.status = 'disputed' and new.status in ('held', 'reversed'))
    or (old.status = 'released' and new.status = 'reversed')) then
    raise exception 'coin_deposits: status % cannot become % (0280)', old.status, new.status;
  end if;
  if new.status = 'released' and old.status = 'held' and old.release_at > now() then
    raise exception 'coin_deposits: a deposit cannot be released before its release time (0280)';
  end if;
  return new;
end;
$$;

-- A coin deposit reversal: what happened and what it moved are fixed. Only an open dispute gets an outcome
-- (disputed -> restored | lost), and a shortfall is cleared once. Never deleted.
create or replace function public.coin_deposit_reversal_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'coin_deposit_reversals rows are permanent (0280)'; end if;
  if new.id is distinct from old.id or new.provider is distinct from old.provider or new.event_key is distinct from old.event_key or new.kind is distinct from old.kind
     or new.reference is distinct from old.reference or new.user_id is distinct from old.user_id or new.phase is distinct from old.phase
     or new.paid_minor is distinct from old.paid_minor or new.paid_currency is distinct from old.paid_currency or new.refunded_minor is distinct from old.refunded_minor
     or new.deposit_cents is distinct from old.deposit_cents or new.due_cents is distinct from old.due_cents or new.recovered_cents is distinct from old.recovered_cents
     or new.shortfall_cents is distinct from old.shortfall_cents or new.ledger_reference is distinct from old.ledger_reference or new.actor_id is distinct from old.actor_id
     or new.note is distinct from old.note or new.created_at is distinct from old.created_at then
    raise exception 'coin_deposit_reversals: a recorded reversal cannot be rewritten (0280)';
  end if;
  if new.state is distinct from old.state and not (old.state = 'disputed' and new.state in ('restored', 'lost')) then
    raise exception 'coin_deposit_reversals: state % cannot become % (0280)', old.state, new.state;
  end if;
  if old.shortfall_cleared_at is not null and new.shortfall_cleared_at is distinct from old.shortfall_cleared_at then
    raise exception 'coin_deposit_reversals: a shortfall is cleared once (0280)';
  end if;
  return new;
end;
$$;

-- The deposit rules a checkout is opened under. NULL / missing / out of bounds = refused. holdHours: 72 to 2160.
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
  if (p_rules ->> 'holdHours')::bigint < 72 or (p_rules ->> 'holdHours')::bigint > 2160 then return false; end if;
  if (p_rules ->> 'minCents')::bigint < 1 or (p_rules ->> 'maxCents')::bigint < (p_rules ->> 'minCents')::bigint or (p_rules ->> 'maxCents')::bigint > 100000000 then return false; end if;
  return true;
end;
$$;

-- Open a coin deposit: the attempt row is written BEFORE any checkout. The server passes its current rules (the
-- admin's audited frenzCoin settings) and what the provider will be asked for. One open deposit per member at a time.
create or replace function public.begin_coin_deposit(
  p_user uuid, p_reference text, p_amount_cents bigint, p_provider text, p_provider_amount bigint, p_provider_currency text,
  p_idempotency text, p_rules jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_open record;
begin
  if p_user is null or coalesce(p_reference, '') = '' or p_amount_cents is null or p_amount_cents <= 0 or p_provider is distinct from 'flutterwave'
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

-- Settle a coin deposit the SERVER verified with the provider. The paid amount and currency must be exactly what the
-- attempt asked for. Credits the coin wallet as PENDING, once per reference. The hold comes from the attempt row.
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
  v_hold := greatest(72, least(2160, coalesce((v_a.metadata -> 'coin' ->> 'holdHours')::int, 72)));
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

-- Release ONE held deposit, at or after its release time by the database clock. Once only. The wallet lock first,
-- then the deposit row (the order settlement and reversal use), and every condition re-read under both.
create or replace function public.release_coin_deposit(p_reference text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_d    public.coin_deposits%rowtype;
begin
  select user_id into v_user from public.coin_deposits where reference = p_reference;
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform 1 from public.ai_product_balances where user_id = v_user and product = 'frenz_coin' for update;
  select * into v_d from public.coin_deposits where reference = p_reference for update;
  if v_d.status <> 'held' then return jsonb_build_object('ok', true, 'duplicate', true, 'status', v_d.status); end if;
  if v_d.release_at > now() then return jsonb_build_object('ok', false, 'reason', 'on_hold', 'release_at', v_d.release_at); end if;
  perform set_config('frenz.coin_writer', 'on', true);
  update public.ai_product_ledger set status = 'settled', updated_at = now() where id = v_d.ledger_id and status = 'reserved';
  if not found then raise exception 'coin deposit % has no reserved ledger row', p_reference; end if;
  update public.ai_product_balances set pending_cents = pending_cents - v_d.amount_cents, updated_at = now() where user_id = v_user and product = 'frenz_coin';
  perform set_config('frenz.coin_writer', 'off', true);
  update public.coin_deposits set status = 'released', released_at = now() where reference = p_reference;
  insert into public.financial_audit_log (action, target_type, target_id, reference, details)
  values ('coin_deposit_released', 'coin_deposit', v_user::text, p_reference, jsonb_build_object('amount_cents', v_d.amount_cents, 'release_at', v_d.release_at));
  return jsonb_build_object('ok', true, 'released', v_d.amount_cents, 'user_id', v_user);
end;
$$;

-- Release every deposit that is due (one member's, or everyone's), oldest first, bounded. Idempotent.
create or replace function public.release_due_coin_deposits(p_user uuid default null, p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ref   text;
  v_r     jsonb;
  v_n     integer := 0;
  v_cents bigint := 0;
begin
  for v_ref in
    select reference from public.coin_deposits
     where status = 'held' and release_at <= now() and (p_user is null or user_id = p_user)
     order by release_at limit greatest(1, least(coalesce(p_limit, 100), 500))
  loop
    v_r := public.release_coin_deposit(v_ref);
    if (v_r ->> 'ok')::boolean and v_r ? 'released' then
      v_n := v_n + 1;
      v_cents := v_cents + (v_r ->> 'released')::bigint;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'released', v_n, 'cents', v_cents);
end;
$$;

-- Lift the restriction a coin shortfall put on, once no other coin shortfall is open. Any other restriction stays.
create or replace function public.lift_coin_shortfall_restriction(p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.coin_deposit_reversals where user_id = p_user and shortfall_cents > 0 and shortfall_cleared_at is null) then
    return false;
  end if;
  update public.reward_profiles set restricted = false, restricted_reason = null, updated_at = now()
   where user_id = p_user and restricted and restricted_reason = 'coin_deposit_shortfall';
  return found;
end;
$$;

-- Take a deposit that is still ON HOLD back out of the wallet, whole: its pending row becomes refunded, a settled
-- reversal row removes the coins, and pending and balance fall together. Internal (the callers hold both locks).
create or replace function public.coin_take_back_held_deposit(p_reference text, p_ledger_reference text, p_note text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_d     public.coin_deposits%rowtype;
  v_after bigint;
begin
  select * into v_d from public.coin_deposits where reference = p_reference;
  perform set_config('frenz.coin_writer', 'on', true);
  update public.ai_product_ledger set status = 'refunded', updated_at = now() where id = v_d.ledger_id and status = 'reserved';
  if not found then raise exception 'coin deposit % is not on hold', p_reference; end if;
  update public.ai_product_balances set balance_cents = balance_cents - v_d.amount_cents, pending_cents = pending_cents - v_d.amount_cents, updated_at = now()
   where user_id = v_d.user_id and product = 'frenz_coin' returning balance_cents into v_after;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, withdrawable_part, metadata)
  values (v_d.user_id, 'frenz_coin', 'reversal', 'settled', -v_d.amount_cents, v_after, 'USD', p_ledger_reference, p_note, 0,
          jsonb_build_object('deposit_reference', p_reference, 'phase', 'held'));
  perform set_config('frenz.coin_writer', 'off', true);
  update public.coin_deposits set status = 'reversed', reversed_at = now() where reference = p_reference;
  return v_d.amount_cents;
end;
$$;

-- A refund or chargeback of a coin deposit. Idempotent on (provider, event_key). Never takes more than the deposit, in
-- total, however many events arrive. Never touches a recipient, never makes a balance negative.
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

  if v_short > 0 then
    -- the coins were already spent or sent: no transfers and no withdrawals until an admin settles it
    insert into public.reward_profiles (user_id, restricted, restricted_reason, updated_at)
    values (v_user, true, 'coin_deposit_shortfall', now())
    on conflict (user_id) do update
      set restricted_reason = case when public.reward_profiles.restricted then public.reward_profiles.restricted_reason else 'coin_deposit_shortfall' end,
          restricted = true, updated_at = now();
  end if;

  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_actor, 'coin_deposit_' || p_kind || case when v_partial then '_review' else '' end, 'coin_deposit_reversal', v_id::text, p_reference,
          jsonb_build_object('provider', p_provider, 'event_key', p_event_key, 'user_id', v_user, 'phase', v_phase, 'paid_minor', p_paid_minor,
                             'paid_currency', p_paid_currency, 'refunded_minor', p_refunded_minor, 'deposit_cents', v_d.amount_cents, 'due', v_due,
                             'recovered', v_take, 'shortfall', v_short, 'state', v_state, 'note', p_note,
                             'proposed_due', case when v_partial then ceil(v_d.amount_cents::numeric * p_refunded_minor / p_paid_minor)::bigint end));
  return jsonb_build_object('ok', true, 'id', v_id, 'user_id', v_user, 'phase', v_phase, 'state', v_state, 'due', v_due, 'recovered', v_take, 'shortfall', v_short);
end;
$$;

-- An admin records a coin deposit dispute's outcome after confirming it with the provider. Once only.
create or replace function public.resolve_coin_deposit_dispute(p_id uuid, p_outcome text, p_actor uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_r     public.coin_deposit_reversals%rowtype;
  v_after bigint;
begin
  if p_id is null or p_actor is null or p_outcome is null or p_outcome not in ('won', 'lost') or coalesce(btrim(p_note), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into v_r from public.coin_deposit_reversals where id = p_id;
  if v_r.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_r.kind <> 'dispute' then return jsonb_build_object('ok', false, 'reason', 'not_a_dispute'); end if;
  perform 1 from public.ai_product_balances where user_id = v_r.user_id and product = 'frenz_coin' for update;
  perform 1 from public.coin_deposits where reference = v_r.reference for update;
  select * into v_r from public.coin_deposit_reversals where id = p_id for update;
  if v_r.state <> 'disputed' then return jsonb_build_object('ok', true, 'duplicate', true, 'state', v_r.state); end if;

  if v_r.phase = 'held' then
    if p_outcome = 'won' then
      -- the hold resumes: released at its original time, or by the next pass if that time has gone
      update public.coin_deposits set status = 'held' where reference = v_r.reference and status = 'disputed';
    else
      perform public.coin_take_back_held_deposit(v_r.reference, v_r.ledger_reference, 'Taken back: a disputed deposit was lost');
    end if;
  elsif v_r.recovered_cents > 0 then
    perform set_config('frenz.coin_writer', 'on', true);
    if p_outcome = 'lost' then
      update public.ai_product_ledger set status = 'settled', updated_at = now()
       where user_id = v_r.user_id and product = 'frenz_coin' and kind = 'reversal' and reference = v_r.ledger_reference and status = 'reserved';
      update public.ai_product_balances set held_cents = held_cents - v_r.recovered_cents, updated_at = now() where user_id = v_r.user_id and product = 'frenz_coin';
      update public.coin_deposits set status = 'reversed', reversed_at = now() where reference = v_r.reference and status = 'released';
    else
      update public.ai_product_balances set balance_cents = balance_cents + v_r.recovered_cents, held_cents = held_cents - v_r.recovered_cents, updated_at = now()
       where user_id = v_r.user_id and product = 'frenz_coin' returning balance_cents into v_after;
      insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, withdrawable_part, metadata)
      values (v_r.user_id, 'frenz_coin', 'refund', 'settled', v_r.recovered_cents, v_after, 'USD', 'coin-deposit-restore:' || v_r.id::text,
              'Returned: the disputed deposit was upheld', 0, jsonb_build_object('reversal_id', v_r.id, 'deposit_reference', v_r.reference));
      update public.ai_product_ledger set status = 'refunded', updated_at = now()
       where user_id = v_r.user_id and product = 'frenz_coin' and kind = 'reversal' and reference = v_r.ledger_reference and status = 'reserved';
    end if;
    perform set_config('frenz.coin_writer', 'off', true);
  elsif p_outcome = 'lost' then
    update public.coin_deposits set status = 'reversed', reversed_at = now() where reference = v_r.reference and status = 'released';
  end if;

  update public.coin_deposit_reversals
     set state = case when p_outcome = 'lost' then 'lost' else 'restored' end, resolved_at = now(), resolved_by = p_actor, resolution_note = p_note,
         shortfall_cleared_at = case when p_outcome = 'won' and shortfall_cents > 0 then coalesce(shortfall_cleared_at, now()) else shortfall_cleared_at end,
         shortfall_cleared_by = case when p_outcome = 'won' and shortfall_cents > 0 then coalesce(shortfall_cleared_by, p_actor) else shortfall_cleared_by end
   where id = p_id;
  if p_outcome = 'won' then perform public.lift_coin_shortfall_restriction(v_r.user_id); end if;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_actor, 'coin_deposit_dispute_' || p_outcome, 'coin_deposit_reversal', p_id::text, v_r.reference,
          jsonb_build_object('user_id', v_r.user_id, 'phase', v_r.phase, 'recovered', v_r.recovered_cents, 'shortfall', v_r.shortfall_cents, 'note', p_note));
  return jsonb_build_object('ok', true, 'state', case when p_outcome = 'lost' then 'lost' else 'restored' end);
end;
$$;

-- An admin settles a coin shortfall (recovered from the member, or written off). Lifts the restriction it caused.
create or replace function public.clear_coin_deposit_shortfall(p_id uuid, p_actor uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_r public.coin_deposit_reversals%rowtype;
begin
  if p_id is null or p_actor is null or coalesce(btrim(p_note), '') = '' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select * into v_r from public.coin_deposit_reversals where id = p_id for update;
  if v_r.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_r.shortfall_cents = 0 then return jsonb_build_object('ok', false, 'reason', 'no_shortfall'); end if;
  if v_r.shortfall_cleared_at is not null then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  update public.coin_deposit_reversals set shortfall_cleared_at = now(), shortfall_cleared_by = p_actor, resolution_note = coalesce(resolution_note || ' / ', '') || p_note where id = p_id;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_actor, 'coin_deposit_shortfall_cleared', 'coin_deposit_reversal', p_id::text, v_r.reference, jsonb_build_object('user_id', v_r.user_id, 'shortfall', v_r.shortfall_cents, 'note', p_note));
  return jsonb_build_object('ok', true, 'lifted', public.lift_coin_shortfall_restriction(v_r.user_id));
end;
$$;

-- ── restated, word for word, with the lines marked 0280 ─────────────────────

-- 0279's pending release, restated: a deposit row is refused (its hold is released only by release_coin_deposit).
create or replace function public.release_coin_pending(p_user uuid, p_reference text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.ai_product_ledger%rowtype;
begin
  if p_user is null or coalesce(p_reference, '') = '' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  perform 1 from public.ai_product_balances where user_id = p_user and product = 'frenz_coin' for update;
  select * into v_row from public.ai_product_ledger where user_id = p_user and product = 'frenz_coin' and reference = p_reference and delta_cents > 0 order by created_at limit 1;
  if v_row.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  -- 0280: a deposit leaves its hold only through release_coin_deposit, at or after its release time
  if v_row.kind = 'deposit' then return jsonb_build_object('ok', false, 'reason', 'deposit_hold'); end if;
  if v_row.status <> 'reserved' then return jsonb_build_object('ok', true, 'duplicate', true, 'status', v_row.status); end if;
  perform set_config('frenz.coin_writer', 'on', true);
  update public.ai_product_ledger set status = 'settled', updated_at = now() where id = v_row.id;
  update public.ai_product_balances set pending_cents = pending_cents - v_row.delta_cents, updated_at = now() where user_id = p_user and product = 'frenz_coin';
  perform set_config('frenz.coin_writer', 'off', true);
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_actor, 'coin_pending_released', 'coin_wallet', p_user::text, p_reference, jsonb_build_object('amount_cents', v_row.delta_cents, 'ledger_id', v_row.id));
  return jsonb_build_object('ok', true, 'released', v_row.delta_cents);
end;
$$;

-- 0279's transfer, restated: a replayed key that names another amount or recipient is refused.
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
  v_block := public.credit_wallet_block_reason(p_sender);
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

-- 0278's block reason, restated: an open coin deposit shortfall pauses moving money too.
create or replace function public.credit_wallet_block_reason(p_user uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from public.profiles where id = p_user and is_suspended) then return 'suspended'; end if;
  if exists (select 1 from public.reward_profiles where user_id = p_user and restricted) then return 'restricted'; end if;
  if exists (select 1 from public.wallet_topup_reversals where user_id = p_user and shortfall_credits > 0 and shortfall_cleared_at is null) then return 'recovery_due'; end if;
  -- 0280
  if exists (select 1 from public.coin_deposit_reversals where user_id = p_user and shortfall_cents > 0 and shortfall_cleared_at is null) then return 'recovery_due'; end if;
  return null;
end;
$$;

-- 0279's purge blockers, restated: an open coin deposit shortfall or dispute blocks a purge.
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
  -- 0279
  if exists (select 1 from public.ai_product_balances where user_id = p_user and product = 'frenz_coin' and (balance_cents + held_cents) > 0) then v_reasons := array_append(v_reasons, 'coin_balance'); end if;
  -- 0280
  if exists (select 1 from public.coin_deposit_reversals where user_id = p_user and ((shortfall_cents > 0 and shortfall_cleared_at is null) or state = 'disputed')) then v_reasons := array_append(v_reasons, 'coin_recovery_due'); end if;
  return jsonb_build_object('ok', cardinality(v_reasons) = 0, 'reasons', to_jsonb(v_reasons), 'tokens', greatest(coalesce(v_bal, 0) - coalesce(v_wd, 0), 0));
end;
$$;

-- The triggers: the deposit guard, and 0187's reward trigger restated with a product filter (a second wall: a coin
-- deposit is the kind 'deposit' and never matches 'recharge' anyway). Then the grants: service role only, and the
-- internal helpers (the guard, the restriction lift, the held take-back) to nobody.
do $$
begin
  execute 'drop trigger if exists coin_deposits_guard on public.coin_deposits';
  execute 'create trigger coin_deposits_guard before update or delete on public.coin_deposits for each row execute function public.coin_deposit_guard()';
  execute 'drop trigger if exists coin_deposit_reversals_guard on public.coin_deposit_reversals';
  execute 'create trigger coin_deposit_reversals_guard before update or delete on public.coin_deposit_reversals for each row execute function public.coin_deposit_reversal_guard()';
  execute 'drop trigger if exists reward_on_topup_trg on public.ai_product_ledger';
  execute 'create trigger reward_on_topup_trg after insert on public.ai_product_ledger for each row when (new.kind = ''recharge'' and new.product <> ''frenz_coin'') execute function public.reward_on_activity()';

  execute 'revoke all on function public.coin_deposit_guard() from public, anon, authenticated';
  execute 'revoke all on function public.coin_deposit_reversal_guard() from public, anon, authenticated';
  execute 'revoke all on function public.coin_deposit_rules_ok(jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.coin_deposit_rules_ok(jsonb) to service_role';
  execute 'revoke all on function public.begin_coin_deposit(uuid, text, bigint, text, bigint, text, text, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.begin_coin_deposit(uuid, text, bigint, text, bigint, text, text, jsonb) to service_role';
  execute 'revoke all on function public.settle_coin_deposit(text, text, bigint, text) from public, anon, authenticated';
  execute 'grant execute on function public.settle_coin_deposit(text, text, bigint, text) to service_role';
  execute 'revoke all on function public.release_coin_deposit(text) from public, anon, authenticated';
  execute 'grant execute on function public.release_coin_deposit(text) to service_role';
  execute 'revoke all on function public.release_due_coin_deposits(uuid, integer) from public, anon, authenticated';
  execute 'grant execute on function public.release_due_coin_deposits(uuid, integer) to service_role';
  execute 'revoke all on function public.lift_coin_shortfall_restriction(uuid) from public, anon, authenticated';
  execute 'revoke all on function public.coin_take_back_held_deposit(text, text, text) from public, anon, authenticated';
  execute 'revoke all on function public.reverse_coin_deposit(text, text, text, text, bigint, bigint, text, uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.reverse_coin_deposit(text, text, text, text, bigint, bigint, text, uuid, text) to service_role';
  execute 'revoke all on function public.resolve_coin_deposit_dispute(uuid, text, uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.resolve_coin_deposit_dispute(uuid, text, uuid, text) to service_role';
  execute 'revoke all on function public.clear_coin_deposit_shortfall(uuid, uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.clear_coin_deposit_shortfall(uuid, uuid, text) to service_role';
  execute 'revoke all on function public.release_coin_pending(uuid, text, uuid) from public, anon, authenticated';
  execute 'grant execute on function public.release_coin_pending(uuid, text, uuid) to service_role';
  execute 'revoke all on function public.transfer_coins(uuid, text, bigint, text, text, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.transfer_coins(uuid, text, bigint, text, text, jsonb) to service_role';
  execute 'revoke all on function public.credit_wallet_block_reason(uuid) from public, anon, authenticated';
  execute 'grant execute on function public.credit_wallet_block_reason(uuid) to service_role';
  execute 'revoke all on function public.account_financial_blockers(uuid) from public, anon, authenticated';
  execute 'grant execute on function public.account_financial_blockers(uuid) to service_role';
end;
$$;
