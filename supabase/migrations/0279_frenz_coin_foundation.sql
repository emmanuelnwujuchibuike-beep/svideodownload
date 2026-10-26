-- ═══════════════════════════════════════════════════════════════════════════
--  0279 — Frenz Coin: schema and accounting foundation (Frenz Coin Part 3, 2026-10-25)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Frenz Coin is a SEPARATE wallet product on the existing wallet tables: product `frenz_coin` in
-- ai_product_balances / ai_product_ledger, unit 'USD' (integer cents). AI Credits (`character_replace`, unit CREDIT)
-- are not converted, read or changed. No UI, checkout, PIN or payout call here.
--
-- ── The balance model (one row per member, product frenz_coin) ──────────────
--   balance_cents   what is in the wallet = Σ delta_cents of the member's coin ledger rows (every row, any status)
--   pending_cents   the part of balance_cents not yet spendable = Σ delta of the coin rows still 'reserved' with a
--                   POSITIVE delta (a deposit or credit on hold). Released by release_coin_pending (reserved → settled).
--   held_cents      money reserved OUT of the wallet for a pending withdrawal = − Σ delta of the coin rows still
--                   'reserved' with a NEGATIVE delta. It has left balance_cents (exactly as an AI-credit withdrawal).
--   available       = balance_cents − pending_cents                         (what can be sent or withdrawn)
--   total owned     = balance_cents + held_cents = available + pending + held
--   withdrawable_cents and deposited_cents are AI-credit fields and stay 0 on a coin row.
--
-- ── What is new ──────────────────────────────────────────────────────────────
--   ai_product_balances.pending_cents / held_cents (0 for every other product, by constraint)
--   coin_transfers                the transfer record (amount, fee parts, the rules snapshot), one per (sender, key).
--                                 Its own table, not credit_transfers: that table's amounts are CREDITS, its replay
--                                 key is shared with credit transfers (one unique index), and the credit daily limit
--                                 (0278 transfer_credits_checked) and transfer history sum it.
--   coin_rules_ok / coin_transfer_fee / coin_withdrawal_fee   the fee formulas, recomputed in SQL from the rules the
--                                 server passes (the admin's audited settings); the rules are stored on each operation.
--   transfer_coins                lock both coin wallets in user-id order, check standing + the rolling 24-hour limit
--                                 + the available balance under the lock, debit amount + fee, credit the amount.
--   request_coin_withdrawal       available → held, gross / fee / net / payout snapshot, one open per member.
--   resolve_coin_withdrawal       the coin branch of resolve_withdrawal: completed settles the hold and posts the fee
--                                 once; rejected / cancelled returns the hold. Never on an uncertain outcome (the
--                                 payout code only moves a withdrawal on the provider's word).
--   reverse_coin_paid_withdrawal  the coin branch of reverse_paid_withdrawal: a bank return restores the gross and
--                                 posts a fee reversal, once.
--   adjust_coin_balance / release_coin_pending   the audited operator correction and the pending release.
--   coin_wallet_guard             a coin balance or ledger row may be written ONLY by these functions
--                                 (`frenz.coin_writer`), so no AI-credit writer can charge, credit or refund a coin
--                                 wallet by naming the product.
--   resolve_withdrawal, reverse_paid_withdrawal   restated from 0256 / 0254 WORD FOR WORD, with one dispatch at the
--                                 top for source = 'coin'. Credits and sub run exactly the code they ran before.
--   account_financial_blockers, post_transfer_fee   restated from 0278: a coin balance blocks a purge, and a coin
--                                 transfer fee posts as 'coin_transfer_fee'.
--
-- Depends on 0154, 0187, 0193, 0227, 0254, 0256, 0258, 0278. Run by hand AFTER 0278. Safe to run twice.
-- No semicolon inside any quoted string. Every dollar-quoted block is at the end.

-- ── the product and the explicit states ─────────────────────────────────────
alter table public.ai_product_balances drop constraint if exists ai_product_balances_product_chk;
alter table public.ai_product_balances add constraint ai_product_balances_product_chk check (product in ('character_replace', 'frenz_coin'));
alter table public.ai_product_ledger drop constraint if exists ai_product_ledger_product_chk;
alter table public.ai_product_ledger add constraint ai_product_ledger_product_chk check (product in ('character_replace', 'frenz_coin'));

alter table public.ai_product_balances add column if not exists pending_cents bigint not null default 0;
alter table public.ai_product_balances add column if not exists held_cents bigint not null default 0;
alter table public.ai_product_balances drop constraint if exists ai_product_balances_coin_state_chk;
alter table public.ai_product_balances add constraint ai_product_balances_coin_state_chk check (
  pending_cents >= 0 and held_cents >= 0 and pending_cents <= balance_cents
  and (product = 'frenz_coin' or (pending_cents = 0 and held_cents = 0))
  and (product <> 'frenz_coin' or (currency = 'USD' and withdrawable_cents = 0 and deposited_cents = 0)));
comment on column public.ai_product_balances.pending_cents is 'Frenz Coin (0279): the part of balance_cents not yet spendable (reserved positive coin ledger rows). Always 0 for other products.';
comment on column public.ai_product_balances.held_cents is 'Frenz Coin (0279): money reserved out of the wallet for a pending withdrawal (reserved negative coin ledger rows). Not part of balance_cents. Always 0 for other products.';

-- ── transfers ───────────────────────────────────────────────────────────────
create table if not exists public.coin_transfers (
  id                  uuid primary key default gen_random_uuid(),
  sender_id           uuid not null,
  recipient_id        uuid not null,
  amount_cents        bigint not null,
  fee_percent_cents   bigint not null,
  fee_flat_cents      bigint not null,
  fee_cents           bigint not null,
  total_debit_cents   bigint not null,
  bracket             text not null,
  idempotency_key     text not null,
  note                text,
  rules_snapshot      jsonb not null,
  created_at          timestamptz not null default now(),
  constraint coin_transfers_self_chk check (sender_id <> recipient_id),
  constraint coin_transfers_amount_chk check (amount_cents > 0 and fee_percent_cents >= 0 and fee_flat_cents >= 0
    and fee_cents = fee_percent_cents + fee_flat_cents and total_debit_cents = amount_cents + fee_cents),
  constraint coin_transfers_bracket_chk check (bracket in ('below', 'mid', 'above')),
  constraint coin_transfers_note_chk check (note is null or char_length(note) <= 120)
);
create unique index if not exists coin_transfers_idem_uidx on public.coin_transfers (sender_id, idempotency_key);
create index if not exists coin_transfers_sender_idx on public.coin_transfers (sender_id, created_at desc);
create index if not exists coin_transfers_recipient_idx on public.coin_transfers (recipient_id, created_at desc);
alter table public.coin_transfers enable row level security;
revoke all on public.coin_transfers from public, anon, authenticated;
grant all on public.coin_transfers to service_role;
comment on table public.coin_transfers is 'Frenz Coin transfers (0279): amount, fee parts and the fee rules they were priced under. Written only by transfer_coins. Append-only. Service role only. No foreign key to auth.users (history outlives an account, 0278).';

-- ── withdrawals: the coin source ────────────────────────────────────────────
alter table public.withdrawal_requests add column if not exists payout_currency text;
alter table public.withdrawal_requests add column if not exists payout_minor bigint;
alter table public.withdrawal_requests drop constraint if exists withdrawal_requests_source_chk;
alter table public.withdrawal_requests add constraint withdrawal_requests_source_chk check (source in ('credits', 'sub', 'coin'));
alter table public.withdrawal_requests drop constraint if exists withdrawal_requests_credits_chk;
alter table public.withdrawal_requests add constraint withdrawal_requests_credits_chk check (
  amount_usd_cents >= 0 and (
    (source = 'credits' and credits > 0)
    or (source in ('sub', 'coin') and credits = 0 and gross_cents > 0 and fee_cents >= 0 and net_cents > 0 and gross_cents = fee_cents + net_cents and amount_usd_cents = net_cents)
  ));
alter table public.withdrawal_requests drop constraint if exists withdrawal_requests_payout_chk;
alter table public.withdrawal_requests add constraint withdrawal_requests_payout_chk check (
  (payout_currency is null and payout_minor is null) or (payout_currency ~ '^[A-Z]{3}$' and payout_minor > 0));

-- ── fee income: the coin sources ────────────────────────────────────────────
alter table public.platform_fee_ledger drop constraint if exists platform_fee_ledger_source_chk;
alter table public.platform_fee_ledger add constraint platform_fee_ledger_source_chk
  check (source in ('credit_transfer_fee', 'coin_transfer_fee', 'coin_withdrawal_fee', 'coin_withdrawal_fee_reversal'));
comment on column public.platform_fee_ledger.source is 'credit_transfer_fee (0278) | coin_transfer_fee | coin_withdrawal_fee | coin_withdrawal_fee_reversal (0279). A reversal row is fee income given back: coin fee income = fees - reversals.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

-- A coin wallet row may be written only from inside the coin functions below (they switch frenz.coin_writer on for
-- their own write section). Balances: every insert and update. Ledger: every INSERT (its updates are already limited to
-- the legitimate transitions by 0278's ai_product_ledger_guard, and an admin's FK set-null must still clear). Any other writer naming product frenz_coin — an AI-credit charge, refund, recharge or
-- adjustment — is refused. Deleting an account's zero row still cascades (deletion is blocked while it holds money).
create or replace function public.coin_wallet_guard() returns trigger
language plpgsql as $$
begin
  if new.product = 'frenz_coin' and coalesce(current_setting('frenz.coin_writer', true), '') <> 'on' then
    raise exception 'a Frenz Coin wallet is written only by the coin functions (0279)';
  end if;
  return new;
end;
$$;

-- The rules a coin operation is priced and limited by, checked before anything moves. NULL / missing / out of bounds = refused.
create or replace function public.coin_rules_ok(p_rules jsonb, p_kind text) returns boolean
language plpgsql immutable as $$
declare
  k  text;
  v  jsonb;
  ks text[];
begin
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' or jsonb_typeof(p_rules -> 'enabled') <> 'boolean' then return false; end if;
  ks := case when p_kind = 'transfer'
    then array['percentBp', 'lowThresholdCents', 'highThresholdCents', 'flatBelowCents', 'flatMidCents', 'flatAboveCents', 'minCents', 'maxCents', 'dailyMaxCents']
    else array['percentBp', 'flatCents', 'minCents', 'maxCents', 'maxPerDay', 'maxMonthCents'] end;
  foreach k in array ks loop
    v := p_rules -> k;
    if v is null or jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{1,12}$' then return false; end if;
  end loop;
  if (p_rules ->> 'percentBp')::bigint > 5000 or (p_rules ->> 'minCents')::bigint < 1 or (p_rules ->> 'maxCents')::bigint < (p_rules ->> 'minCents')::bigint then return false; end if;
  if p_kind = 'transfer' then
    if (p_rules ->> 'lowThresholdCents')::bigint < 1 or (p_rules ->> 'highThresholdCents')::bigint < (p_rules ->> 'lowThresholdCents')::bigint or (p_rules ->> 'dailyMaxCents')::bigint < 1 then return false; end if;
    if greatest((p_rules ->> 'flatBelowCents')::bigint, (p_rules ->> 'flatMidCents')::bigint, (p_rules ->> 'flatAboveCents')::bigint) > 100000 then return false; end if;
  elsif p_kind = 'withdrawal' then
    if (p_rules ->> 'flatCents')::bigint > 100000 or (p_rules ->> 'maxPerDay')::bigint < 1 or (p_rules ->> 'maxMonthCents')::bigint < 1 then return false; end if;
    if jsonb_typeof(p_rules -> 'requireQualification') <> 'boolean' or jsonb_typeof(p_rules -> 'requireEmailConfirmed') <> 'boolean' then return false; end if;
    if p_rules ? 'payoutMinorPerUsd' and not (jsonb_typeof(p_rules -> 'payoutMinorPerUsd') = 'null'
       or (jsonb_typeof(p_rules -> 'payoutMinorPerUsd') = 'number' and (p_rules ->> 'payoutMinorPerUsd') ~ '^[1-9][0-9]{0,8}$')) then return false; end if;
  else
    return false;
  end if;
  return true;
end;
$$;

-- The transfer fee: ceil(amount × percentBp / 10000) + the bracket's flat fee. Below lowThreshold = flatBelow; from it up
-- to and INCLUDING highThreshold = flatMid; above = flatAbove. Integers only.
create or replace function public.coin_transfer_fee(p_amount bigint, p_rules jsonb) returns jsonb
language plpgsql immutable as $$
declare
  v_bp      bigint := (p_rules ->> 'percentBp')::bigint;
  v_pct     bigint;
  v_flat    bigint;
  v_bracket text;
begin
  v_pct := (p_amount * v_bp + 9999) / 10000;
  if p_amount < (p_rules ->> 'lowThresholdCents')::bigint then v_bracket := 'below'; v_flat := (p_rules ->> 'flatBelowCents')::bigint;
  elsif p_amount <= (p_rules ->> 'highThresholdCents')::bigint then v_bracket := 'mid'; v_flat := (p_rules ->> 'flatMidCents')::bigint;
  else v_bracket := 'above'; v_flat := (p_rules ->> 'flatAboveCents')::bigint;
  end if;
  return jsonb_build_object('percent', v_pct, 'flat', v_flat, 'fee', v_pct + v_flat, 'total', p_amount + v_pct + v_flat, 'bracket', v_bracket);
end;
$$;

-- The withdrawal fee, taken FROM the amount: fee = ceil(gross × percentBp / 10000) + flatCents, net = gross − fee.
create or replace function public.coin_withdrawal_fee(p_gross bigint, p_rules jsonb) returns jsonb
language plpgsql immutable as $$
declare
  v_pct  bigint := (p_gross * (p_rules ->> 'percentBp')::bigint + 9999) / 10000;
  v_flat bigint := (p_rules ->> 'flatCents')::bigint;
begin
  return jsonb_build_object('percent', v_pct, 'flat', v_flat, 'fee', v_pct + v_flat, 'net', p_gross - v_pct - v_flat);
end;
$$;

-- A member's coin wallet row, made on first need (writer section of its own).
create or replace function public.ensure_coin_wallet(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.ai_product_balances where user_id = p_user and product = 'frenz_coin') then return; end if;
  perform set_config('frenz.coin_writer', 'on', true);
  insert into public.ai_product_balances (user_id, product, balance_cents, currency) values (p_user, 'frenz_coin', 0, 'USD') on conflict (user_id, product) do nothing;
  perform set_config('frenz.coin_writer', 'off', true);
end;
$$;

-- An operator's correction (or, for tests and later parts, a funding entry): signed, with an actor, a reason and a
-- reference that makes it once-only. A credit may land PENDING (not spendable until released). A debit can never
-- take more than is available.
create or replace function public.adjust_coin_balance(p_user uuid, p_delta bigint, p_reference text, p_note text, p_admin uuid, p_pending boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_bal   bigint;
  v_pend  bigint;
  v_after bigint;
  v_id    uuid;
begin
  if p_user is null or p_delta is null or p_delta = 0 or p_admin is null or coalesce(btrim(p_note), '') = '' or coalesce(p_reference, '') = ''
     or (coalesce(p_pending, false) and p_delta < 0) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  perform public.ensure_coin_wallet(p_user);
  select balance_cents, pending_cents into v_bal, v_pend from public.ai_product_balances where user_id = p_user and product = 'frenz_coin' for update;
  if exists (select 1 from public.ai_product_ledger where user_id = p_user and product = 'frenz_coin' and kind = 'adjustment' and reference = p_reference) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'balance', v_bal);
  end if;
  if p_delta < 0 and v_bal - v_pend < -p_delta then return jsonb_build_object('ok', false, 'reason', 'insufficient', 'available', v_bal - v_pend); end if;
  perform set_config('frenz.coin_writer', 'on', true);
  update public.ai_product_balances
     set balance_cents = balance_cents + p_delta, pending_cents = pending_cents + case when coalesce(p_pending, false) then p_delta else 0 end, updated_at = now()
   where user_id = p_user and product = 'frenz_coin' returning balance_cents into v_after;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, actor_admin_id, withdrawable_part, metadata)
  values (p_user, 'frenz_coin', 'adjustment', case when coalesce(p_pending, false) then 'reserved' else 'settled' end, p_delta, v_after, 'USD', p_reference, p_note, p_admin, 0,
          jsonb_build_object('pending', coalesce(p_pending, false)))
  returning id into v_id;
  perform set_config('frenz.coin_writer', 'off', true);
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_admin, 'coin_adjustment', 'coin_wallet', p_user::text, p_reference, jsonb_build_object('delta_cents', p_delta, 'pending', coalesce(p_pending, false), 'note', p_note, 'ledger_id', v_id));
  return jsonb_build_object('ok', true, 'balance', v_after, 'ledger_id', v_id);
end;
$$;

-- A pending credit becomes spendable: its reserved row settles and pending falls by the same amount. Once only.
create or replace function public.release_coin_pending(p_user uuid, p_reference text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.ai_product_ledger%rowtype;
begin
  if p_user is null or coalesce(p_reference, '') = '' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  perform 1 from public.ai_product_balances where user_id = p_user and product = 'frenz_coin' for update;
  select * into v_row from public.ai_product_ledger where user_id = p_user and product = 'frenz_coin' and reference = p_reference and delta_cents > 0 order by created_at limit 1;
  if v_row.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
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

-- A coin transfer. The sender pays amount + fee from AVAILABLE coins, the recipient receives exactly the amount.
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

-- A coin withdrawal request: available → held, priced by the rules it was made under.
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
  v_block := public.credit_wallet_block_reason(p_user);
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

-- The coin branch of resolve_withdrawal. The same legal moves. The wallet row is locked BEFORE the withdrawal row (the
-- order request_coin_withdrawal uses), so a request and a resolution can never deadlock.
create or replace function public.resolve_coin_withdrawal(p_id uuid, p_status text, p_admin uuid, p_note text default null, p_payout_ref text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid;
  v_w     public.withdrawal_requests%rowtype;
  v_row   uuid;
  v_after bigint;
begin
  select user_id into v_user from public.withdrawal_requests where id = p_id and source = 'coin';
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform 1 from public.ai_product_balances where user_id = v_user and product = 'frenz_coin' for update;
  select * into v_w from public.withdrawal_requests where id = p_id for update;
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
  select id into v_row from public.ai_product_ledger where user_id = v_w.user_id and product = 'frenz_coin' and kind = 'withdrawal' and reference = 'coin-withdrawal:' || p_id::text;

  perform set_config('frenz.coin_writer', 'on', true);
  if p_status = 'completed' then
    update public.ai_product_ledger set status = 'settled', updated_at = now() where id = v_row and status = 'reserved';
    if found then
      update public.ai_product_balances set held_cents = held_cents - v_w.gross_cents, updated_at = now() where user_id = v_w.user_id and product = 'frenz_coin';
      if v_w.fee_cents > 0 then
        insert into public.platform_fee_ledger (source, source_ledger_id, reference, payer_id, amount, unit, withdrawable_part)
        values ('coin_withdrawal_fee', v_row, 'coin-withdrawal:' || p_id::text, v_w.user_id, v_w.fee_cents, 'USD', 0)
        on conflict (source, source_ledger_id) do nothing;
      end if;
    end if;
  elsif p_status in ('rejected', 'cancelled') then
    insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, withdrawable_part, metadata)
    values (v_w.user_id, 'frenz_coin', 'withdrawal_reversal', 'settled', v_w.gross_cents, 0, 'USD', 'coin-withdrawal:' || p_id::text, 'Withdrawal ' || p_status || ': returned', 0,
            jsonb_build_object('withdrawal_id', p_id))
    on conflict (user_id, product, kind, reference) where reference is not null do nothing;
    if found then
      update public.ai_product_balances set balance_cents = balance_cents + v_w.gross_cents, held_cents = held_cents - v_w.gross_cents, updated_at = now()
       where user_id = v_w.user_id and product = 'frenz_coin' returning balance_cents into v_after;
      update public.ai_product_ledger set balance_after_cents = v_after, updated_at = now()
       where user_id = v_w.user_id and product = 'frenz_coin' and kind = 'withdrawal_reversal' and reference = 'coin-withdrawal:' || p_id::text;
      update public.ai_product_ledger set status = 'reversed', updated_at = now() where id = v_row and status = 'reserved';
    end if;
  end if;
  perform set_config('frenz.coin_writer', 'off', true);
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_admin, 'withdrawal_' || p_status, 'withdrawal', p_id::text, coalesce(p_payout_ref, 'coin-withdrawal:' || p_id::text), jsonb_build_object('source', 'coin', 'from', v_w.status, 'note', p_note));
  insert into public.notifications (user_id, type, data) values (v_w.user_id, 'withdrawal_update', jsonb_build_object('withdrawal_id', p_id, 'status', p_status, 'source', 'coin', 'net_cents', v_w.net_cents));
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

-- The coin branch of reverse_paid_withdrawal: a COMPLETED payout the bank sent back. The gross returns to the wallet
-- (the member received nothing) and the fee income is given back with its own counter-entry. Once only.
create or replace function public.reverse_coin_paid_withdrawal(p_id uuid, p_actor uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid;
  v_w     public.withdrawal_requests%rowtype;
  v_row   uuid;
  v_after bigint;
begin
  select user_id into v_user from public.withdrawal_requests where id = p_id and source = 'coin';
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform 1 from public.ai_product_balances where user_id = v_user and product = 'frenz_coin' for update;
  select * into v_w from public.withdrawal_requests where id = p_id for update;
  if v_w.status = 'reversed' then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if v_w.status <> 'completed' then return jsonb_build_object('ok', false, 'reason', 'not_completed', 'status', v_w.status); end if;
  select id into v_row from public.ai_product_ledger where user_id = v_w.user_id and product = 'frenz_coin' and kind = 'withdrawal' and reference = 'coin-withdrawal:' || p_id::text;
  update public.withdrawal_requests set status = 'reversed', review_note = coalesce(p_note, review_note), updated_at = now() where id = p_id;
  perform set_config('frenz.coin_writer', 'on', true);
  -- the ledger row is the once-only claim: the balance moves only if it was written
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, withdrawable_part, metadata)
  values (v_w.user_id, 'frenz_coin', 'withdrawal_reversal', 'settled', v_w.gross_cents, 0, 'USD', 'coin-withdrawal:' || p_id::text, 'Payout returned by the bank', 0,
          jsonb_build_object('withdrawal_id', p_id, 'bank_return', true))
  on conflict (user_id, product, kind, reference) where reference is not null do nothing;
  if found then
    update public.ai_product_balances set balance_cents = balance_cents + v_w.gross_cents, updated_at = now()
     where user_id = v_w.user_id and product = 'frenz_coin' returning balance_cents into v_after;
    update public.ai_product_ledger set balance_after_cents = v_after, updated_at = now()
     where user_id = v_w.user_id and product = 'frenz_coin' and kind = 'withdrawal_reversal' and reference = 'coin-withdrawal:' || p_id::text;
  end if;
  perform set_config('frenz.coin_writer', 'off', true);
  if v_w.fee_cents > 0 and v_row is not null then
    insert into public.platform_fee_ledger (source, source_ledger_id, reference, payer_id, amount, unit, withdrawable_part)
    values ('coin_withdrawal_fee_reversal', v_row, 'coin-withdrawal:' || p_id::text, v_w.user_id, v_w.fee_cents, 'USD', 0)
    on conflict (source, source_ledger_id) do nothing;
  end if;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_actor, 'withdrawal_reversed', 'withdrawal', p_id::text, coalesce(v_w.payout_reference, 'coin-withdrawal:' || p_id::text), jsonb_build_object('source', 'coin', 'gross', v_w.gross_cents, 'fee', v_w.fee_cents, 'note', p_note));
  insert into public.notifications (user_id, type, data) values (v_w.user_id, 'withdrawal_update', jsonb_build_object('withdrawal_id', p_id, 'status', 'reversed', 'source', 'coin', 'net_cents', v_w.net_cents));
  return jsonb_build_object('ok', true, 'balance_after', v_after);
end;
$$;

-- resolve_withdrawal, restated from 0256 WORD FOR WORD below the coin dispatch.
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
  -- 0279: a Frenz Coin withdrawal has its own accounting. Read without a lock, so the coin path takes its locks in its
  -- own order (wallet, then withdrawal). A withdrawal's source never changes. Credits and sub run the code below, unchanged.
  if exists (select 1 from public.withdrawal_requests where id = p_id and source = 'coin') then
    return public.resolve_coin_withdrawal(p_id, p_status, p_admin, p_note, p_payout_ref);
  end if;
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

-- reverse_paid_withdrawal, restated from 0254 WORD FOR WORD below the coin dispatch.
create or replace function public.reverse_paid_withdrawal(p_id uuid, p_actor uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_w public.withdrawal_requests%rowtype;
  v_b public.sub_balances%rowtype;
begin
  -- 0279: a Frenz Coin payout returned by the bank is restored by its own accounting. Credits and sub: unchanged below.
  if exists (select 1 from public.withdrawal_requests where id = p_id and source = 'coin') then
    return public.reverse_coin_paid_withdrawal(p_id, p_actor, p_note);
  end if;
  select * into v_w from public.withdrawal_requests where id = p_id for update;
  if v_w.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_w.status = 'reversed' then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if v_w.status <> 'completed' then return jsonb_build_object('ok', false, 'reason', 'not_completed', 'status', v_w.status); end if;
  if v_w.source is distinct from 'sub' then
    -- once per withdrawal, however often Paystack redelivers the event
    if not exists (select 1 from public.financial_audit_log where action = 'withdrawal_reversal_manual' and target_id = p_id::text) then
      insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
      values (p_actor, 'withdrawal_reversal_manual', 'withdrawal', p_id::text, coalesce(v_w.payout_reference, 'withdrawal:' || p_id::text), jsonb_build_object('source', v_w.source, 'credits', v_w.credits, 'note', p_note));
    end if;
    return jsonb_build_object('ok', false, 'reason', 'manual', 'source', v_w.source);
  end if;
  update public.withdrawal_requests set status = 'reversed', review_note = coalesce(p_note, review_note), updated_at = now() where id = p_id;
  insert into public.sub_balances (creator_id) values (v_w.user_id) on conflict (creator_id) do nothing;
  -- the returned money settles any debt first (as release_sub_earnings does), the rest is available.
  -- One UPDATE: every right-hand side reads the row as it was.
  update public.sub_balances
     set withdrawn_cents = greatest(0, withdrawn_cents - v_w.gross_cents),
         available_cents = available_cents + v_w.gross_cents - least(debt_cents, v_w.gross_cents),
         debt_cents = debt_cents - least(debt_cents, v_w.gross_cents),
         updated_at = now()
   where creator_id = v_w.user_id returning * into v_b;
  insert into public.sub_ledger (creator_id, kind, amount_cents, pending_after, available_after, reference, withdrawal_id, actor_id, note)
  values (v_w.user_id, 'withdrawal_reversed', v_w.gross_cents, v_b.pending_cents, v_b.available_cents, 'withdrawal:' || p_id::text, p_id, p_actor, coalesce(p_note, 'Payout returned by the bank'));
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_actor, 'withdrawal_reversed', 'withdrawal', p_id::text, coalesce(v_w.payout_reference, 'withdrawal:' || p_id::text), jsonb_build_object('source', 'sub', 'gross', v_w.gross_cents, 'net', v_w.net_cents, 'note', p_note));
  insert into public.notifications (user_id, type, data) values (v_w.user_id, 'withdrawal_update', jsonb_build_object('withdrawal_id', p_id, 'status', 'reversed', 'source', 'sub', 'net_cents', v_w.net_cents));
  return jsonb_build_object('ok', true, 'available_after', v_b.available_cents);
end;
$$;

-- 0278's blockers, restated whole, plus Frenz Coin: coins in the wallet or held for a withdrawal block a purge.
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
  return jsonb_build_object('ok', cardinality(v_reasons) = 0, 'reasons', to_jsonb(v_reasons), 'tokens', greatest(coalesce(v_bal, 0) - coalesce(v_wd, 0), 0));
end;
$$;

-- 0278's fee counter-entry, restated: a coin transfer fee posts as coin_transfer_fee (in US cents), a credit one as before.
create or replace function public.post_transfer_fee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'transfer_fee' and new.delta_cents < 0 and new.user_id is not null then
    insert into public.platform_fee_ledger (source, source_ledger_id, reference, payer_id, amount, unit, credit_class, withdrawable_part, created_at)
    values (case when new.product = 'frenz_coin' then 'coin_transfer_fee' else 'credit_transfer_fee' end, new.id, coalesce(new.reference, new.id::text), new.user_id,
            -new.delta_cents, coalesce(new.currency, 'CREDIT'), new.credit_class, coalesce(new.withdrawable_part, 0), new.created_at)
    on conflict (source, source_ledger_id) do nothing;
  end if;
  return new;
end;
$$;

do $$
begin
  execute 'drop trigger if exists ai_product_balances_coin_guard on public.ai_product_balances';
  execute 'create trigger ai_product_balances_coin_guard before insert or update on public.ai_product_balances for each row execute function public.coin_wallet_guard()';
  execute 'drop trigger if exists ai_product_ledger_coin_guard on public.ai_product_ledger';
  execute 'create trigger ai_product_ledger_coin_guard before insert on public.ai_product_ledger for each row execute function public.coin_wallet_guard()';
  execute 'drop trigger if exists coin_transfers_append_only on public.coin_transfers';
  execute 'create trigger coin_transfers_append_only before update or delete on public.coin_transfers for each row execute function public.financial_append_only_guard()';

  execute 'revoke all on function public.coin_wallet_guard() from public, anon, authenticated';
  execute 'revoke all on function public.coin_rules_ok(jsonb, text) from public, anon, authenticated';
  execute 'revoke all on function public.coin_transfer_fee(bigint, jsonb) from public, anon, authenticated';
  execute 'revoke all on function public.coin_withdrawal_fee(bigint, jsonb) from public, anon, authenticated';
  execute 'revoke all on function public.ensure_coin_wallet(uuid) from public, anon, authenticated';
  execute 'revoke all on function public.adjust_coin_balance(uuid, bigint, text, text, uuid, boolean) from public, anon, authenticated';
  execute 'revoke all on function public.release_coin_pending(uuid, text, uuid) from public, anon, authenticated';
  execute 'revoke all on function public.transfer_coins(uuid, text, bigint, text, text, jsonb) from public, anon, authenticated';
  execute 'revoke all on function public.request_coin_withdrawal(uuid, bigint, text, jsonb, text, jsonb) from public, anon, authenticated';
  execute 'revoke all on function public.resolve_coin_withdrawal(uuid, text, uuid, text, text) from public, anon, authenticated';
  execute 'revoke all on function public.reverse_coin_paid_withdrawal(uuid, uuid, text) from public, anon, authenticated';
  execute 'revoke all on function public.resolve_withdrawal(uuid, text, uuid, text, text) from public, anon, authenticated';
  execute 'revoke all on function public.reverse_paid_withdrawal(uuid, uuid, text) from public, anon, authenticated';
  execute 'revoke all on function public.account_financial_blockers(uuid) from public, anon, authenticated';
  execute 'revoke all on function public.post_transfer_fee() from public, anon, authenticated';
  execute 'grant execute on function public.coin_rules_ok(jsonb, text) to service_role';
  execute 'grant execute on function public.coin_transfer_fee(bigint, jsonb) to service_role';
  execute 'grant execute on function public.coin_withdrawal_fee(bigint, jsonb) to service_role';
  execute 'grant execute on function public.ensure_coin_wallet(uuid) to service_role';
  execute 'grant execute on function public.adjust_coin_balance(uuid, bigint, text, text, uuid, boolean) to service_role';
  execute 'grant execute on function public.release_coin_pending(uuid, text, uuid) to service_role';
  execute 'grant execute on function public.transfer_coins(uuid, text, bigint, text, text, jsonb) to service_role';
  execute 'grant execute on function public.request_coin_withdrawal(uuid, bigint, text, jsonb, text, jsonb) to service_role';
  execute 'grant execute on function public.resolve_coin_withdrawal(uuid, text, uuid, text, text) to service_role';
  execute 'grant execute on function public.reverse_coin_paid_withdrawal(uuid, uuid, text) to service_role';
  execute 'grant execute on function public.resolve_withdrawal(uuid, text, uuid, text, text) to service_role';
  execute 'grant execute on function public.reverse_paid_withdrawal(uuid, uuid, text) to service_role';
  execute 'grant execute on function public.account_financial_blockers(uuid) to service_role';
end;
$$;
