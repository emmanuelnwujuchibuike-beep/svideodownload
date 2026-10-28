-- ═══════════════════════════════════════════════════════════════════════════
--  0290 — Frenz Gift Coin: the FGC wallet and the FC <-> FGC conversion engine (Frenz Gift Coin Part 2, 2026-10-27)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Frenz Gift Coin (FGC) is a THIRD product on the existing wallet tables, beside AI Credits (`character_replace`) and
-- Frenz Coin (`frenz_coin`): product `frenz_gift` in ai_product_balances / ai_product_ledger. No second ledger, no
-- second balance table. The FC wallet, its rules, its withdrawals and its $1-per-FC reference value are not changed.
--
-- ── Units ────────────────────────────────────────────────────────────────────
--   FC   currency 'USD', integer US cents (0279, unchanged). 1 FC = 100 cents.
--   FGC  currency 'FGC', integer FGC minor units (1 FGC = 100 minor units, the same shape as FC). The column names say
--        "_cents" for history. Every FGC balance and ledger row carries currency 'FGC' (constraints below).
--
-- ── The FGC balance model (one row per member, product frenz_gift) ───────────
--   Exactly the FC model (0279): balance_cents = Σ ledger delta, pending_cents = the part not yet spendable (reserved
--   positive rows), available = balance - pending. Nothing makes FGC pending yet. Part 5 (gift earnings on hold) will,
--   and a conversion already spends AVAILABLE FGC only, so pending gift earnings can never be converted while released
--   ones can. FGC bought with the member's own FC is ordinary available FGC and converts back like any other.
--
-- ── A conversion (convert_fgc), the only way FGC is made from FC or turned back ───
--   direction fc_to_fgc   input FC (USD cents)  -> output FGC (minor units)
--   direction fgc_to_fc   input FGC             -> output FC
--   Each direction has its own leg in the rules: rateNum / rateDen, feeBp, feeFlat, minIn, maxIn, dailyMaxIn.
--     gross     = floor(input × rateNum / rateDen)                  (in output units, rounded DOWN)
--     remainder = input × rateNum - gross × rateDen                  (what the floor dropped, 0 <= r < rateDen)
--     fee       = ceil(gross × feeBp / 10000) + feeFlat               (in OUTPUT units, the percent part rounded UP)
--     net       = gross - fee                                        (must be at least 1, else 'below_fee')
--   Every rounding step favours the platform, so no amount, split or merge can gain from rounding.
--   Ledger: input product  conversion_out  -input   (settled)
--           output product conversion_in   +gross   (settled)
--           output product conversion_fee  -fee     (settled, only when fee > 0) -> platform_fee_ledger, once
--   Both wallets move in ONE transaction, under both row locks (taken in product order: frenz_coin, then frenz_gift).
--   fgc_conversions keeps the whole record: rate, remainder, fee parts, the rules snapshot and version, the ledger ids.
--
-- ── Arbitrage (fgc_conversion_rules_check) ───────────────────────────────────
--   Let leg A = fcToFgc (a/b, fee p1 = feeBp/10000, flat f1) and leg B = fgcToFc (c/d, p2, f2).
--   Upper bound of one leg on input x:  out <= x × rate × (1 - p) - flat   (floor <= exact, ceil fee >= exact).
--   A round trip x -> y -> z, and ANY split or merge of conversions, therefore returns at most
--       z <= X × K - L,   K = (a × c × (10000 - bp1) × (10000 - bp2)) / (b × d × 10^8),   L > 0 when any flat fee > 0.
--   Valid only when K < 1, or K = 1 and some flat fee is > 0. Otherwise a round trip can return at least what went in
--   (K = 1 with no flat fee breaks even on exact multiples, K > 1 gains on large amounts). Refused with
--   'config_arbitrage', never adjusted. Checked in exact integer arithmetic (numeric), both directions are covered
--   because K and the condition on L are symmetric.
--
-- ── Configuration ────────────────────────────────────────────────────────────
--   The rules come from the server (Part 3: the admin's audited frenzGift settings), passed as p_rules exactly like
--   the FC transfer rules. None are hardcoded here. NULL rules = 'config_missing', malformed or arbitrage-prone =
--   'config_invalid'. Nothing moves until valid rules exist. A client never supplies a rate, a fee or an output.
--
-- ── Also ─────────────────────────────────────────────────────────────────────
--   gift_wallet_guard       an FGC balance or ledger row may be written ONLY inside the functions here
--                           (`frenz.gift_writer`), exactly as coin_wallet_guard protects FC (which is unchanged).
--   adjust_gift_balance     the audited operator correction, the FGC twin of adjust_coin_balance.
--   account_financial_blockers   restated from 0280 word for word, plus: FGC in the wallet blocks a purge.
--   Ledger kinds conversion_in / conversion_out / conversion_fee (FC and FGC only), and FGC rows may use only these
--   and 'adjustment' until Parts 3-5 add gift kinds. Fee sources fc_to_fgc_conversion_fee (unit FGC) and
--   fgc_to_fc_conversion_fee (unit USD).
--
-- Depends on 0154, 0187, 0202, 0227, 0278, 0279, 0280, 0281. Run by hand AFTER 0284. Safe to run twice.
-- No semicolon inside any quoted string or comment. Every dollar-quoted block is at the end.

-- ── the product ─────────────────────────────────────────────────────────────
alter table public.ai_product_balances drop constraint if exists ai_product_balances_product_chk;
alter table public.ai_product_balances add constraint ai_product_balances_product_chk check (product in ('character_replace', 'frenz_coin', 'frenz_gift'));
alter table public.ai_product_ledger drop constraint if exists ai_product_ledger_product_chk;
alter table public.ai_product_ledger add constraint ai_product_ledger_product_chk check (product in ('character_replace', 'frenz_coin', 'frenz_gift'));

-- 0279's state constraint, restated: FGC may carry pending and held amounts like FC, and is always in 'FGC'
alter table public.ai_product_balances drop constraint if exists ai_product_balances_coin_state_chk;
alter table public.ai_product_balances add constraint ai_product_balances_coin_state_chk check (
  pending_cents >= 0 and held_cents >= 0 and pending_cents <= balance_cents
  and (product in ('frenz_coin', 'frenz_gift') or (pending_cents = 0 and held_cents = 0))
  and (product <> 'frenz_coin' or (currency = 'USD' and withdrawable_cents = 0 and deposited_cents = 0))
  and (product <> 'frenz_gift' or (currency = 'FGC' and withdrawable_cents = 0 and deposited_cents = 0)));
alter table public.ai_product_ledger drop constraint if exists ai_product_ledger_gift_currency_chk;
alter table public.ai_product_ledger add constraint ai_product_ledger_gift_currency_chk check (product <> 'frenz_gift' or (currency = 'FGC' and coalesce(withdrawable_part, 0) = 0));

-- ── the conversion kinds (0280's lists restated, plus three) ────────────────
alter table public.ai_product_ledger drop constraint if exists ai_product_ledger_kind_chk;
alter table public.ai_product_ledger add constraint ai_product_ledger_kind_chk
  check (kind in ('recharge', 'processing_charge', 'refund', 'adjustment', 'reversal', 'bonus', 'grant', 'withdrawal', 'withdrawal_reversal', 'transfer_out', 'transfer_in', 'transfer_fee', 'deposit',
                  'conversion_in', 'conversion_out', 'conversion_fee'));
alter table public.ai_product_ledger drop constraint if exists ai_product_ledger_sign_chk;
alter table public.ai_product_ledger add constraint ai_product_ledger_sign_chk check (
  (kind in ('recharge', 'refund', 'bonus', 'grant', 'withdrawal_reversal', 'transfer_in', 'deposit', 'conversion_in') and delta_cents > 0)
  or (kind in ('processing_charge', 'reversal', 'withdrawal', 'transfer_out', 'transfer_fee', 'conversion_out', 'conversion_fee') and delta_cents < 0)
  or (kind = 'adjustment' and delta_cents <> 0)
);
-- a conversion moves FC and FGC only, AI Credits are never converted
alter table public.ai_product_ledger drop constraint if exists ai_product_ledger_conversion_product_chk;
alter table public.ai_product_ledger add constraint ai_product_ledger_conversion_product_chk
  check (kind not in ('conversion_in', 'conversion_out', 'conversion_fee') or product in ('frenz_coin', 'frenz_gift'));
-- FGC has no deposit, recharge, reward or withdrawal of its own (yet): conversions and audited corrections only
alter table public.ai_product_ledger drop constraint if exists ai_product_ledger_gift_kind_chk;
alter table public.ai_product_ledger add constraint ai_product_ledger_gift_kind_chk
  check (product <> 'frenz_gift' or kind in ('conversion_in', 'conversion_out', 'conversion_fee', 'adjustment'));

-- ── fee income: the conversion sources (0283's list restated, plus two) ─────
alter table public.platform_fee_ledger drop constraint if exists platform_fee_ledger_source_chk;
alter table public.platform_fee_ledger add constraint platform_fee_ledger_source_chk
  check (source in ('credit_transfer_fee', 'coin_transfer_fee', 'coin_withdrawal_fee', 'coin_withdrawal_fee_reversal', 'coin_transfer_fee_reversal',
                    'fc_to_fgc_conversion_fee', 'fgc_to_fc_conversion_fee'));
comment on column public.platform_fee_ledger.source is 'credit_transfer_fee (0278) | coin_transfer_fee | coin_withdrawal_fee | coin_withdrawal_fee_reversal (0279) | coin_transfer_fee_reversal (0283) | fc_to_fgc_conversion_fee (unit FGC) | fgc_to_fc_conversion_fee (unit USD) (0290). A reversal row is fee income given back.';

-- ── the conversion record ───────────────────────────────────────────────────
create table if not exists public.fgc_conversions (
  id                  uuid primary key,
  user_id             uuid not null,
  direction           text not null,
  input_currency      text not null,
  input_amount        bigint not null,
  output_currency     text not null,
  rate_num            bigint not null,
  rate_den            bigint not null,
  gross_output        bigint not null,
  rounding_remainder  bigint not null,
  fee_bp              integer not null,
  fee_percent_part    bigint not null,
  fee_flat_part       bigint not null,
  fee_amount          bigint not null,
  fee_currency        text not null,
  net_output          bigint not null,
  config_version      bigint not null,
  rules_snapshot      jsonb not null,
  idempotency_key     text not null,
  status              text not null default 'completed',
  debit_ledger_id     uuid not null,
  credit_ledger_id    uuid not null,
  fee_ledger_id       uuid,
  created_at          timestamptz not null default now(),
  constraint fgc_conversions_direction_chk check (
    (direction = 'fc_to_fgc' and input_currency = 'USD' and output_currency = 'FGC')
    or (direction = 'fgc_to_fc' and input_currency = 'FGC' and output_currency = 'USD')),
  constraint fgc_conversions_fee_currency_chk check (fee_currency = output_currency),
  constraint fgc_conversions_amounts_chk check (
    input_amount > 0 and rate_num > 0 and rate_den > 0 and gross_output > 0
    and rounding_remainder >= 0 and rounding_remainder < rate_den
    and fee_bp between 0 and 5000 and fee_percent_part >= 0 and fee_flat_part >= 0
    and fee_amount = fee_percent_part + fee_flat_part and net_output = gross_output - fee_amount and net_output > 0
    and config_version > 0),
  -- the rounding is provable from the row itself: gross is the exact floor, the percent fee the exact ceiling
  constraint fgc_conversions_floor_chk check (input_amount::numeric * rate_num = gross_output::numeric * rate_den + rounding_remainder),
  constraint fgc_conversions_fee_ceil_chk check (fee_percent_part = div(gross_output::numeric * fee_bp + 9999, 10000)),
  constraint fgc_conversions_fee_row_chk check ((fee_amount = 0) = (fee_ledger_id is null)),
  constraint fgc_conversions_status_chk check (status in ('completed')),
  constraint fgc_conversions_key_chk check (char_length(idempotency_key) between 1 and 80)
);
create unique index if not exists fgc_conversions_idem_uidx on public.fgc_conversions (user_id, idempotency_key);
create index if not exists fgc_conversions_user_idx on public.fgc_conversions (user_id, created_at desc);
create index if not exists fgc_conversions_user_dir_idx on public.fgc_conversions (user_id, direction, created_at desc);
alter table public.fgc_conversions enable row level security;
revoke all on public.fgc_conversions from public, anon, authenticated;
grant all on public.fgc_conversions to service_role;
comment on table public.fgc_conversions is 'Frenz Gift Coin conversions (0290): one row per FC to FGC or FGC to FC conversion, with the rate, the rounding remainder, the fee parts, the rules snapshot and version, and the three ledger rows it wrote. Written only by convert_fgc. Append-only. Service role only. No foreign key to auth.users (history outlives an account, 0278).';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

-- An FGC wallet row may be written only from inside the functions below (they switch frenz.gift_writer on for their
-- own write section). The FC guard (0279 coin_wallet_guard, frenz.coin_writer) is untouched and still required for FC:
-- a conversion switches on both, each for its own product.
create or replace function public.gift_wallet_guard() returns trigger
language plpgsql as $$
begin
  if new.product = 'frenz_gift' and coalesce(current_setting('frenz.gift_writer', true), '') <> 'on' then
    raise exception 'a Frenz Gift Coin wallet is written only by the gift functions (0290)';
  end if;
  return new;
end;
$$;

-- Why the rules cannot be used (null = they can). config_missing | config_invalid:<what> | config_arbitrage.
create or replace function public.fgc_conversion_rules_check(p_rules jsonb) returns text
language plpgsql immutable as $$
declare
  leg   text;
  k     text;
  v     jsonb;
  l     jsonb;
  pat   text;
  a     numeric;
  b     numeric;
  c     numeric;
  d     numeric;
  kn    numeric;
  kd    numeric;
begin
  if p_rules is null or jsonb_typeof(p_rules) = 'null' then return 'config_missing'; end if;
  if jsonb_typeof(p_rules) <> 'object' then return 'config_invalid:shape'; end if;
  if coalesce(jsonb_typeof(p_rules -> 'version'), '') <> 'number' or (p_rules ->> 'version') !~ '^[1-9][0-9]{0,14}$' then return 'config_invalid:version'; end if;
  foreach leg in array array['fcToFgc', 'fgcToFc'] loop
    l := p_rules -> leg;
    if l is null or jsonb_typeof(l) <> 'object' then return 'config_invalid:' || leg; end if;
    foreach k in array array['rateNum', 'rateDen', 'feeBp', 'feeFlat', 'minIn', 'maxIn', 'dailyMaxIn'] loop
      v := l -> k;
      pat := case k when 'rateNum' then '^[1-9][0-9]{0,8}$' when 'rateDen' then '^[1-9][0-9]{0,8}$' when 'feeBp' then '^[0-9]{1,4}$'
                    when 'feeFlat' then '^[0-9]{1,9}$' when 'dailyMaxIn' then '^[1-9][0-9]{0,11}$' else '^[1-9][0-9]{0,10}$' end;
      if v is null or jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ pat then return 'config_invalid:' || leg || '.' || k; end if;
    end loop;
    if (l ->> 'feeBp')::int > 5000 then return 'config_invalid:' || leg || '.feeBp'; end if;
    if (l ->> 'maxIn')::bigint < (l ->> 'minIn')::bigint then return 'config_invalid:' || leg || '.maxIn'; end if;
    if (l ->> 'dailyMaxIn')::bigint < (l ->> 'minIn')::bigint then return 'config_invalid:' || leg || '.dailyMaxIn'; end if;
    -- the largest allowed input must give an output that stays an exact integer in JavaScript (2^53 - 1)
    if div((l ->> 'maxIn')::numeric * (l ->> 'rateNum')::numeric, (l ->> 'rateDen')::numeric) > 9007199254740991 then return 'config_invalid:' || leg || '.range'; end if;
  end loop;
  -- arbitrage: K = a c (10000 - bp1)(10000 - bp2) / (b d 10^8), refused when K > 1, or K = 1 with no flat fee
  a := (p_rules #>> '{fcToFgc,rateNum}')::numeric;
  b := (p_rules #>> '{fcToFgc,rateDen}')::numeric;
  c := (p_rules #>> '{fgcToFc,rateNum}')::numeric;
  d := (p_rules #>> '{fgcToFc,rateDen}')::numeric;
  kn := a * c * (10000 - (p_rules #>> '{fcToFgc,feeBp}')::numeric) * (10000 - (p_rules #>> '{fgcToFc,feeBp}')::numeric);
  kd := b * d * 100000000;
  if kn > kd then return 'config_arbitrage'; end if;
  if kn = kd and (p_rules #>> '{fcToFgc,feeFlat}')::numeric = 0 and (p_rules #>> '{fgcToFc,feeFlat}')::numeric = 0 then return 'config_arbitrage'; end if;
  return null;
end;
$$;

-- One leg's arithmetic on an input amount (the leg already passed fgc_conversion_rules_check). Integers only.
create or replace function public.fgc_conversion_quote(p_amount bigint, p_leg jsonb) returns jsonb
language plpgsql immutable as $$
declare
  v_num   numeric := (p_leg ->> 'rateNum')::numeric;
  v_den   numeric := (p_leg ->> 'rateDen')::numeric;
  v_bp    numeric := (p_leg ->> 'feeBp')::numeric;
  v_flat  numeric := (p_leg ->> 'feeFlat')::numeric;
  v_gross numeric;
  v_pct   numeric;
begin
  v_gross := div(p_amount::numeric * v_num, v_den);
  v_pct := div(v_gross * v_bp + 9999, 10000);
  return jsonb_build_object('gross', v_gross::bigint, 'remainder', (p_amount::numeric * v_num - v_gross * v_den)::bigint,
                            'percent', v_pct::bigint, 'flat', v_flat::bigint, 'fee', (v_pct + v_flat)::bigint, 'net', (v_gross - v_pct - v_flat)::bigint);
end;
$$;

-- A member's FGC wallet row, made on first need (writer section of its own).
create or replace function public.ensure_gift_wallet(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.ai_product_balances where user_id = p_user and product = 'frenz_gift') then return; end if;
  perform set_config('frenz.gift_writer', 'on', true);
  insert into public.ai_product_balances (user_id, product, balance_cents, currency) values (p_user, 'frenz_gift', 0, 'FGC') on conflict (user_id, product) do nothing;
  perform set_config('frenz.gift_writer', 'off', true);
end;
$$;

-- What a stored conversion answers, first time or on a replay.
create or replace function public.fgc_conversion_result(p_c public.fgc_conversions, p_duplicate boolean) returns jsonb
language sql immutable as $$
  select jsonb_build_object('ok', true, 'duplicate', p_duplicate, 'conversion_id', p_c.id, 'direction', p_c.direction,
    'input_currency', p_c.input_currency, 'input', p_c.input_amount, 'output_currency', p_c.output_currency,
    'gross', p_c.gross_output, 'fee', p_c.fee_amount, 'fee_currency', p_c.fee_currency, 'net', p_c.net_output,
    'rate_num', p_c.rate_num, 'rate_den', p_c.rate_den, 'remainder', p_c.rounding_remainder, 'version', p_c.config_version,
    'created_at', p_c.created_at)
$$;

-- The conversion. Both wallets of ONE member, locked in product order, both legs in this one transaction.
create or replace function public.convert_fgc(p_user uuid, p_direction text, p_amount bigint, p_idempotency text, p_rules jsonb, p_expected_version bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ex       public.fgc_conversions%rowtype;
  v_err      text;
  v_leg      jsonb;
  v_q        jsonb;
  v_in       text;
  v_out      text;
  v_in_cur   text;
  v_out_cur  text;
  v_block    text;
  v_sum      bigint;
  v_bal      bigint;
  v_pend     bigint;
  v_id       uuid;
  v_in_after bigint;
  v_out_after bigint;
  v_debit    uuid;
  v_credit   uuid;
  v_fee_row  uuid;
  v_gross    bigint;
  v_fee      bigint;
  v_net      bigint;
  v_version  bigint;
begin
  if p_user is null or p_direction is null or p_direction not in ('fc_to_fgc', 'fgc_to_fc') or p_amount is null or p_amount <= 0
     or coalesce(p_idempotency, '') = '' or char_length(p_idempotency) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- a replay answers what the first request did (even if the rules changed since), and never converts twice
  select * into v_ex from public.fgc_conversions where user_id = p_user and idempotency_key = p_idempotency;
  if v_ex.id is not null then
    if v_ex.direction <> p_direction or v_ex.input_amount <> p_amount then return jsonb_build_object('ok', false, 'reason', 'idempotency_conflict'); end if;
    return public.fgc_conversion_result(v_ex, true);
  end if;
  v_err := public.fgc_conversion_rules_check(p_rules);
  if v_err = 'config_missing' then return jsonb_build_object('ok', false, 'reason', 'config_missing'); end if;
  if v_err is not null then return jsonb_build_object('ok', false, 'reason', 'config_invalid', 'detail', v_err); end if;
  v_version := (p_rules ->> 'version')::bigint;
  if p_expected_version is not null and p_expected_version <> v_version then
    return jsonb_build_object('ok', false, 'reason', 'rules_changed', 'version', v_version);
  end if;
  if p_direction = 'fc_to_fgc' then
    v_leg := p_rules -> 'fcToFgc'; v_in := 'frenz_coin'; v_out := 'frenz_gift'; v_in_cur := 'USD'; v_out_cur := 'FGC';
  else
    v_leg := p_rules -> 'fgcToFc'; v_in := 'frenz_gift'; v_out := 'frenz_coin'; v_in_cur := 'FGC'; v_out_cur := 'USD';
  end if;
  if p_amount < (v_leg ->> 'minIn')::bigint or p_amount > (v_leg ->> 'maxIn')::bigint then
    return jsonb_build_object('ok', false, 'reason', 'amount_out_of_range', 'min', (v_leg ->> 'minIn')::bigint, 'max', (v_leg ->> 'maxIn')::bigint);
  end if;
  v_q := public.fgc_conversion_quote(p_amount, v_leg);
  v_gross := (v_q ->> 'gross')::bigint;
  v_fee := (v_q ->> 'fee')::bigint;
  v_net := (v_q ->> 'net')::bigint;
  if v_gross <= 0 or v_net <= 0 then return jsonb_build_object('ok', false, 'reason', 'below_fee', 'gross', v_gross, 'fee', v_fee); end if;

  perform public.ensure_coin_wallet(p_user);
  perform public.ensure_gift_wallet(p_user);
  -- both wallets of this member, locked in a FIXED order (product: frenz_coin before frenz_gift, then user id), the
  -- order every FC and FGC function follows, so a conversion never deadlocks with a transfer or another conversion
  perform 1 from public.ai_product_balances where user_id = p_user and product in ('frenz_coin', 'frenz_gift') order by product, user_id for update;
  -- the same key may have committed while this call waited for the locks: answer it, never convert twice
  select * into v_ex from public.fgc_conversions where user_id = p_user and idempotency_key = p_idempotency;
  if v_ex.id is not null then
    if v_ex.direction <> p_direction or v_ex.input_amount <> p_amount then return jsonb_build_object('ok', false, 'reason', 'idempotency_conflict'); end if;
    return public.fgc_conversion_result(v_ex, true);
  end if;
  v_block := public.coin_wallet_block_reason(p_user);
  if v_block is not null then return jsonb_build_object('ok', false, 'reason', v_block); end if;
  -- every conversion by this member holds both wallet locks, so this sum cannot be raced
  select coalesce(sum(input_amount), 0) into v_sum from public.fgc_conversions where user_id = p_user and direction = p_direction and created_at >= now() - interval '24 hours';
  if v_sum + p_amount > (v_leg ->> 'dailyMaxIn')::bigint then
    return jsonb_build_object('ok', false, 'reason', 'daily_limit', 'used', v_sum, 'limit', (v_leg ->> 'dailyMaxIn')::bigint);
  end if;
  -- only AVAILABLE money converts: pending FC deposits and pending FGC gift earnings stay where they are
  select balance_cents, pending_cents into v_bal, v_pend from public.ai_product_balances where user_id = p_user and product = v_in;
  if v_bal - v_pend < p_amount then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'available', v_bal - v_pend, 'needed', p_amount);
  end if;

  v_id := gen_random_uuid();
  perform set_config('frenz.coin_writer', 'on', true);
  perform set_config('frenz.gift_writer', 'on', true);
  update public.ai_product_balances set balance_cents = balance_cents - p_amount, updated_at = now()
   where user_id = p_user and product = v_in returning balance_cents into v_in_after;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, withdrawable_part, metadata)
  values (p_user, v_in, 'conversion_out', 'settled', -p_amount, v_in_after, v_in_cur, 'fgc-conversion:' || v_id::text,
          case when p_direction = 'fc_to_fgc' then 'Converted to Gift Coins' else 'Converted to Frenz Coins' end, 0,
          jsonb_build_object('conversion_id', v_id, 'direction', p_direction, 'rules_version', v_version))
  returning id into v_debit;
  update public.ai_product_balances set balance_cents = balance_cents + v_net, updated_at = now()
   where user_id = p_user and product = v_out returning balance_cents into v_out_after;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, withdrawable_part, metadata)
  values (p_user, v_out, 'conversion_in', 'settled', v_gross, v_out_after + v_fee, v_out_cur, 'fgc-conversion:' || v_id::text,
          case when p_direction = 'fc_to_fgc' then 'Converted from Frenz Coins' else 'Converted from Gift Coins' end, 0,
          jsonb_build_object('conversion_id', v_id, 'direction', p_direction, 'rate_num', (v_leg ->> 'rateNum')::bigint, 'rate_den', (v_leg ->> 'rateDen')::bigint, 'rules_version', v_version))
  returning id into v_credit;
  if v_fee > 0 then
    insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, withdrawable_part, metadata)
    values (p_user, v_out, 'conversion_fee', 'settled', -v_fee, v_out_after, v_out_cur, 'fgc-conversion-fee:' || v_id::text, 'Conversion fee', 0,
            jsonb_build_object('conversion_id', v_id, 'fee', v_q, 'rules_version', v_version))
    returning id into v_fee_row;
    insert into public.platform_fee_ledger (source, source_ledger_id, reference, payer_id, amount, unit, withdrawable_part)
    values (case when p_direction = 'fc_to_fgc' then 'fc_to_fgc_conversion_fee' else 'fgc_to_fc_conversion_fee' end, v_fee_row, 'fgc-conversion:' || v_id::text, p_user, v_fee, v_out_cur, 0)
    on conflict (source, source_ledger_id) do nothing;
  end if;
  perform set_config('frenz.gift_writer', 'off', true);
  perform set_config('frenz.coin_writer', 'off', true);

  insert into public.fgc_conversions (id, user_id, direction, input_currency, input_amount, output_currency, rate_num, rate_den, gross_output, rounding_remainder,
                                      fee_bp, fee_percent_part, fee_flat_part, fee_amount, fee_currency, net_output, config_version, rules_snapshot, idempotency_key,
                                      status, debit_ledger_id, credit_ledger_id, fee_ledger_id)
  values (v_id, p_user, p_direction, v_in_cur, p_amount, v_out_cur, (v_leg ->> 'rateNum')::bigint, (v_leg ->> 'rateDen')::bigint, v_gross, (v_q ->> 'remainder')::bigint,
          (v_leg ->> 'feeBp')::integer, (v_q ->> 'percent')::bigint, (v_q ->> 'flat')::bigint, v_fee, v_out_cur, v_net, v_version, p_rules || jsonb_build_object('quote', v_q), p_idempotency,
          'completed', v_debit, v_credit, v_fee_row)
  returning * into v_ex;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_user, 'fgc_conversion', 'fgc_conversion', v_id::text, 'fgc-conversion:' || v_id::text,
          jsonb_build_object('direction', p_direction, 'input', p_amount, 'gross', v_gross, 'fee', v_fee, 'net', v_net, 'rules_version', v_version));
  return public.fgc_conversion_result(v_ex, false) || jsonb_build_object('input_balance_after', v_in_after, 'output_balance_after', v_out_after);
end;
$$;

-- An operator's FGC correction, the twin of 0279 adjust_coin_balance: signed, with an actor, a reason and a reference
-- that makes it once-only. A debit can never take more than is available. Every one is in financial_audit_log.
create or replace function public.adjust_gift_balance(p_user uuid, p_delta bigint, p_reference text, p_note text, p_admin uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_bal   bigint;
  v_pend  bigint;
  v_after bigint;
  v_id    uuid;
begin
  if p_user is null or p_delta is null or p_delta = 0 or p_admin is null or coalesce(btrim(p_note), '') = '' or coalesce(p_reference, '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  perform public.ensure_gift_wallet(p_user);
  select balance_cents, pending_cents into v_bal, v_pend from public.ai_product_balances where user_id = p_user and product = 'frenz_gift' for update;
  if exists (select 1 from public.ai_product_ledger where user_id = p_user and product = 'frenz_gift' and kind = 'adjustment' and reference = p_reference) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'balance', v_bal);
  end if;
  if p_delta < 0 and v_bal - v_pend < -p_delta then return jsonb_build_object('ok', false, 'reason', 'insufficient', 'available', v_bal - v_pend); end if;
  perform set_config('frenz.gift_writer', 'on', true);
  update public.ai_product_balances set balance_cents = balance_cents + p_delta, updated_at = now()
   where user_id = p_user and product = 'frenz_gift' returning balance_cents into v_after;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, actor_admin_id, withdrawable_part, metadata)
  values (p_user, 'frenz_gift', 'adjustment', 'settled', p_delta, v_after, 'FGC', p_reference, p_note, p_admin, 0, jsonb_build_object('pending', false))
  returning id into v_id;
  perform set_config('frenz.gift_writer', 'off', true);
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_admin, 'gift_adjustment', 'gift_wallet', p_user::text, p_reference, jsonb_build_object('delta', p_delta, 'note', p_note, 'ledger_id', v_id));
  return jsonb_build_object('ok', true, 'balance', v_after, 'ledger_id', v_id);
end;
$$;

-- 0280's blockers, restated word for word, plus Frenz Gift Coin: FGC in the wallet (or held) blocks a purge.
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
  -- 0290
  if exists (select 1 from public.ai_product_balances where user_id = p_user and product = 'frenz_gift' and (balance_cents + held_cents) > 0) then v_reasons := array_append(v_reasons, 'gift_balance'); end if;
  return jsonb_build_object('ok', cardinality(v_reasons) = 0, 'reasons', to_jsonb(v_reasons), 'tokens', greatest(coalesce(v_bal, 0) - coalesce(v_wd, 0), 0));
end;
$$;

do $$
begin
  execute 'drop trigger if exists ai_product_balances_gift_guard on public.ai_product_balances';
  execute 'create trigger ai_product_balances_gift_guard before insert or update on public.ai_product_balances for each row execute function public.gift_wallet_guard()';
  execute 'drop trigger if exists ai_product_ledger_gift_guard on public.ai_product_ledger';
  execute 'create trigger ai_product_ledger_gift_guard before insert on public.ai_product_ledger for each row execute function public.gift_wallet_guard()';
  execute 'drop trigger if exists fgc_conversions_append_only on public.fgc_conversions';
  execute 'create trigger fgc_conversions_append_only before update or delete on public.fgc_conversions for each row execute function public.financial_append_only_guard()';

  execute 'revoke all on function public.gift_wallet_guard() from public, anon, authenticated';
  execute 'revoke all on function public.fgc_conversion_rules_check(jsonb) from public, anon, authenticated';
  execute 'revoke all on function public.fgc_conversion_quote(bigint, jsonb) from public, anon, authenticated';
  execute 'revoke all on function public.ensure_gift_wallet(uuid) from public, anon, authenticated';
  execute 'revoke all on function public.fgc_conversion_result(public.fgc_conversions, boolean) from public, anon, authenticated';
  execute 'revoke all on function public.convert_fgc(uuid, text, bigint, text, jsonb, bigint) from public, anon, authenticated';
  execute 'revoke all on function public.adjust_gift_balance(uuid, bigint, text, text, uuid) from public, anon, authenticated';
  execute 'revoke all on function public.account_financial_blockers(uuid) from public, anon, authenticated';
  execute 'grant execute on function public.fgc_conversion_rules_check(jsonb) to service_role';
  execute 'grant execute on function public.fgc_conversion_quote(bigint, jsonb) to service_role';
  execute 'grant execute on function public.ensure_gift_wallet(uuid) to service_role';
  execute 'grant execute on function public.convert_fgc(uuid, text, bigint, text, jsonb, bigint) to service_role';
  execute 'grant execute on function public.adjust_gift_balance(uuid, bigint, text, text, uuid) to service_role';
  execute 'grant execute on function public.account_financial_blockers(uuid) to service_role';
end;
$$;
