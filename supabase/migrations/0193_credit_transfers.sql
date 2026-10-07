-- ═══════════════════════════════════════════════════════════════════════════
--  0193 — member-to-member credit transfers by wallet number (2026-10-07)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "users can transfer credits to another user with a user virtual account
-- number … when the account gets funded the credit balance updates instantly.
-- Credit transferred will have a charge of 5%."
--
-- Internal, not a payment provider: credits live only in our ledger, so a
-- transfer is ONE transaction here - instant, no provider fee, no webhook delay.
--
--   wallet_accounts      each member's 10-digit wallet number (random, unique, lazy)
--   credit_transfers     one row per transfer, unique per (sender, idempotency key)
--   transfer_credits()   lock both wallets in a fixed order, check, debit the
--                        sender amount + fee (non-withdrawable part first), credit
--                        the recipient the amount as USABLE credits (a transfer can
--                        never make credits withdrawable), write three ledger lines
--   realtime             ai_product_balances joins the realtime publication, so an
--                        open wallet sees a received transfer at once (RLS: own row)
--
-- No semicolon inside any quoted string (the 0186 lesson).

create table if not exists public.wallet_accounts (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  account_number text not null unique,
  created_at     timestamptz not null default now(),
  constraint wallet_accounts_number_chk check (account_number ~ '^[0-9]{10}$')
);
alter table public.wallet_accounts enable row level security;
revoke all on public.wallet_accounts from public, anon, authenticated;
grant all on public.wallet_accounts to service_role;
comment on table public.wallet_accounts is 'Credit wallet numbers (0193): a 10-digit number a member shares to receive credits. Service role only.';

create table if not exists public.credit_transfers (
  id               uuid primary key default gen_random_uuid(),
  sender_id        uuid not null references auth.users (id) on delete cascade,
  recipient_id     uuid not null references auth.users (id) on delete cascade,
  amount           integer not null,
  fee              integer not null,
  idempotency_key  text not null,
  note             text,
  created_at       timestamptz not null default now(),
  constraint credit_transfers_amount_chk check (amount > 0 and fee >= 0),
  constraint credit_transfers_self_chk check (sender_id <> recipient_id),
  constraint credit_transfers_note_len_chk check (note is null or char_length(note) <= 120)
);
create unique index if not exists credit_transfers_idem_idx on public.credit_transfers (sender_id, idempotency_key);
create index if not exists credit_transfers_sender_idx on public.credit_transfers (sender_id, created_at desc);
create index if not exists credit_transfers_recipient_idx on public.credit_transfers (recipient_id, created_at desc);
create index if not exists credit_transfers_created_idx on public.credit_transfers (created_at desc);
alter table public.credit_transfers enable row level security;
revoke all on public.credit_transfers from public, anon, authenticated;
grant all on public.credit_transfers to service_role;
comment on table public.credit_transfers is 'Member-to-member credit transfers (0193). Written only by transfer_credits(). Service role only.';

-- the ledger learns three kinds: what left, what arrived, and the fee
alter table public.ai_product_ledger drop constraint if exists ai_product_ledger_kind_chk;
alter table public.ai_product_ledger add constraint ai_product_ledger_kind_chk
  check (kind in ('recharge', 'processing_charge', 'refund', 'adjustment', 'reversal', 'bonus', 'grant', 'withdrawal', 'withdrawal_reversal', 'transfer_out', 'transfer_in', 'transfer_fee'));
alter table public.ai_product_ledger drop constraint if exists ai_product_ledger_sign_chk;
alter table public.ai_product_ledger add constraint ai_product_ledger_sign_chk check (
  (kind in ('recharge', 'refund', 'bonus', 'grant', 'withdrawal_reversal', 'transfer_in') and delta_cents > 0)
  or (kind in ('processing_charge', 'reversal', 'withdrawal', 'transfer_out', 'transfer_fee') and delta_cents < 0)
  or (kind = 'adjustment' and delta_cents <> 0)
);

-- a member's wallet number, made once on first need
create or replace function public.ensure_wallet_number(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_num text;
  v_try integer := 0;
begin
  select account_number into v_num from public.wallet_accounts where user_id = p_user;
  if v_num is not null then return v_num; end if;
  loop
    v_try := v_try + 1;
    -- first digit 1-9 so the number never loses a leading zero anywhere it is retyped
    v_num := (1 + floor(random() * 9))::integer::text || lpad(floor(random() * 1000000000)::bigint::text, 9, '0');
    begin
      insert into public.wallet_accounts (user_id, account_number) values (p_user, v_num);
      return v_num;
    exception when unique_violation then
      select account_number into v_num from public.wallet_accounts where user_id = p_user;
      if v_num is not null then return v_num; end if;
      if v_try > 8 then raise; end if;
    end;
  end loop;
end;
$$;

create or replace function public.transfer_credits(p_sender uuid, p_account_number text, p_amount integer, p_fee integer, p_idempotency text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_recipient uuid;
  v_existing  record;
  v_s_bal     bigint;
  v_s_wd      bigint;
  v_s_cur     text;
  v_r_cur     text;
  v_r_bal     bigint;
  v_total     bigint := p_amount::bigint + p_fee::bigint;
  v_wpart     bigint;
  v_id        uuid;
  v_s_after   bigint;
begin
  if p_sender is null or p_amount is null or p_amount <= 0 or p_fee is null or p_fee < 0 or coalesce(p_idempotency, '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- the same request again answers what it did the first time - never a second transfer
  select id, amount, fee, recipient_id into v_existing from public.credit_transfers where sender_id = p_sender and idempotency_key = p_idempotency;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'transfer_id', v_existing.id, 'amount', v_existing.amount, 'fee', v_existing.fee);
  end if;
  select user_id into v_recipient from public.wallet_accounts where account_number = p_account_number;
  if v_recipient is null then return jsonb_build_object('ok', false, 'reason', 'no_account'); end if;
  if v_recipient = p_sender then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  if exists (select 1 from public.reward_profiles where user_id = p_sender and restricted) then return jsonb_build_object('ok', false, 'reason', 'restricted'); end if;

  -- both wallets exist, then lock them in a FIXED order so two opposite transfers can never deadlock
  insert into public.ai_product_balances (user_id, product, balance_cents, currency) values (v_recipient, 'character_replace', 0, 'CREDIT') on conflict (user_id, product) do nothing;
  perform 1 from public.ai_product_balances where product = 'character_replace' and user_id in (p_sender, v_recipient) order by user_id for update;

  select balance_cents, withdrawable_cents, currency into v_s_bal, v_s_wd, v_s_cur from public.ai_product_balances where user_id = p_sender and product = 'character_replace';
  select balance_cents, currency into v_r_bal, v_r_cur from public.ai_product_balances where user_id = v_recipient and product = 'character_replace';
  if v_s_cur is distinct from 'CREDIT' or v_r_cur is distinct from 'CREDIT' then return jsonb_build_object('ok', false, 'reason', 'no_wallet'); end if;
  if v_s_bal < v_total then return jsonb_build_object('ok', false, 'reason', 'insufficient', 'balance', v_s_bal, 'needed', v_total); end if;

  insert into public.credit_transfers (sender_id, recipient_id, amount, fee, idempotency_key, note)
  values (p_sender, v_recipient, p_amount, p_fee, p_idempotency, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (sender_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id, amount, fee into v_existing from public.credit_transfers where sender_id = p_sender and idempotency_key = p_idempotency;
    return jsonb_build_object('ok', true, 'duplicate', true, 'transfer_id', v_existing.id, 'amount', v_existing.amount, 'fee', v_existing.fee);
  end if;

  -- the sender: non-withdrawable credits first, like every spend
  v_wpart := greatest(0, v_total - (v_s_bal - v_s_wd));
  update public.ai_product_balances set balance_cents = balance_cents - v_total, withdrawable_cents = withdrawable_cents - v_wpart, updated_at = now()
   where user_id = p_sender and product = 'character_replace' returning balance_cents into v_s_after;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, metadata, withdrawable_part)
  values (p_sender, 'character_replace', 'transfer_out', 'settled', -p_amount, v_s_after + p_fee, 'CREDIT', 'transfer:' || v_id::text, 'Sent to wallet ' || right(p_account_number, 4),
          jsonb_build_object('transfer_id', v_id, 'recipient_id', v_recipient), least(v_wpart, p_amount));
  if p_fee > 0 then
    insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, metadata, withdrawable_part)
    values (p_sender, 'character_replace', 'transfer_fee', 'settled', -p_fee, v_s_after, 'CREDIT', 'transfer-fee:' || v_id::text, 'Transfer fee',
            jsonb_build_object('transfer_id', v_id), greatest(0, v_wpart - p_amount));
  end if;

  -- the recipient: the amount, as USABLE credits
  update public.ai_product_balances set balance_cents = balance_cents + p_amount, updated_at = now()
   where user_id = v_recipient and product = 'character_replace' returning balance_cents into v_r_bal;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, metadata, credit_class, withdrawable_part)
  values (v_recipient, 'character_replace', 'transfer_in', 'settled', p_amount, v_r_bal, 'CREDIT', 'transfer:' || v_id::text, 'Received credits',
          jsonb_build_object('transfer_id', v_id, 'sender_id', p_sender), 'usable', 0);

  return jsonb_build_object('ok', true, 'transfer_id', v_id, 'recipient_id', v_recipient, 'amount', p_amount, 'fee', p_fee, 'balance_after', v_s_after, 'recipient_balance_after', v_r_bal);
end;
$$;

-- an open wallet sees a received transfer at once - the member reads only their own row (0154 policy)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ai_product_balances') then
    execute 'alter publication supabase_realtime add table public.ai_product_balances';
  end if;
end $$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.ensure_wallet_number(uuid)',
    'public.transfer_credits(uuid, text, integer, integer, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
