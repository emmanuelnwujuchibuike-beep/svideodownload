-- ═══════════════════════════════════════════════════════════════════════════
--  0202 — deposited credits: withdrawable and sendable, at their own fee and rate (2026-10-09)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "deposited credits can be sent to others and withdrawn, but with a
-- certain charge and rate different from others." In the app the withdrawable
-- part is called Credits and the rest Tokens.
--
--   ai_product_balances.deposited_cents   the part of withdrawable_cents that came
--                                         from a paid deposit. Always 0 <= deposited
--                                         <= withdrawable <= balance.
--   credit_product_balance()              0184's writer, copied whole. A recharge
--                                         (a paid deposit, in credits) now also adds
--                                         to withdrawable and deposited. Pack BONUS
--                                         credits are a separate 'bonus' row and stay
--                                         Tokens.
--   balance trigger                       every debit (spend, withdraw, send, adjust)
--                                         keeps deposited within withdrawable, so
--                                         credits are spent EARNED-FIRST and nothing
--                                         else needed changing.
--   transfer_credits(…, p_class)          0199's 7-argument form (as applied, cc33ad0),
--                                         copied whole. The deposited part of a Credits
--                                         transfer stays deposited for the recipient.
--                                         Its revoke/grant run inside the final DO
--                                         block: 0199 ran them as plain statements
--                                         after its $$ body, which the runner has been
--                                         seen to skip, so this re-closes the function
--                                         to the browser either way.
--
-- The rates and fees are the server's (lib/rewards/config.ts withdrawals.deposited,
-- lib/ai/credits/wallet-config.ts transfers.depositedFeePercent). Deposits made
-- before this migration stay Tokens: nothing is reclassified after the fact.
-- Cashing out still needs the member's withdrawal approval (0191).
-- No semicolon inside any quoted string (the 0186 lesson). Functions and DO blocks last.

alter table public.ai_product_balances add column if not exists deposited_cents bigint not null default 0;
alter table public.ai_product_balances drop constraint if exists ai_product_balances_deposited_chk;
alter table public.ai_product_balances add constraint ai_product_balances_deposited_chk check (deposited_cents >= 0 and deposited_cents <= withdrawable_cents);
comment on column public.ai_product_balances.deposited_cents is 'The part of withdrawable_cents that came from a paid deposit (0202). Withdrawn and sent at its own rate and fee. Spent after earned credits.';

create or replace function public.clamp_deposited_cents() returns trigger
language plpgsql as $$
begin
  new.deposited_cents := least(greatest(coalesce(new.deposited_cents, 0), 0), greatest(new.withdrawable_cents, 0));
  return new;
end;
$$;

create or replace function public.credit_product_balance(
  p_user_id   uuid,
  p_product   text,
  p_amount    bigint,
  p_kind      text,
  p_reference text,
  p_currency  text default 'CREDIT',
  p_note      text default null,
  p_admin_id  uuid default null,
  p_metadata  jsonb default null
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
  v_wallet  text;
  v_dep     bigint := 0;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'credit must be positive';
  end if;
  if p_kind not in ('recharge', 'refund', 'bonus', 'grant') then
    raise exception 'not a credit kind: %', p_kind;
  end if;
  if p_reference is null or length(p_reference) = 0 then
    raise exception 'a credit needs a reference';
  end if;
  select currency into v_wallet from public.ai_product_balances where user_id = p_user_id and product = p_product;
  if v_wallet is not null and v_wallet <> p_currency then
    raise exception 'wallet unit mismatch: wallet is %, credit is %', v_wallet, p_currency;
  end if;
  -- The idempotency check IS the insert, and it comes first (see 0149).
  insert into public.ai_product_ledger
    (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, actor_admin_id, metadata)
  values (p_user_id, p_product, p_kind, 'settled', p_amount, 0, p_currency, p_reference, p_note, p_admin_id, p_metadata)
  on conflict (user_id, product, kind, reference) where reference is not null do nothing;
  if not found then
    select balance_cents into v_balance from public.ai_product_balances where user_id = p_user_id and product = p_product;
    return coalesce(v_balance, 0);
  end if;
  -- 0202: a paid deposit (a recharge, in credits) lands as withdrawable AND deposited
  v_dep := case when p_kind = 'recharge' and p_currency = 'CREDIT' then p_amount else 0 end;
  insert into public.ai_product_balances (user_id, product, balance_cents, currency, updated_at, withdrawable_cents, deposited_cents)
  values (p_user_id, p_product, p_amount, p_currency, now(), v_dep, v_dep)
  on conflict (user_id, product) do update
    set balance_cents = public.ai_product_balances.balance_cents + excluded.balance_cents,
        withdrawable_cents = public.ai_product_balances.withdrawable_cents + excluded.withdrawable_cents,
        deposited_cents = public.ai_product_balances.deposited_cents + excluded.deposited_cents,
        updated_at = now()
  returning balance_cents into v_balance;
  update public.ai_product_ledger
     set balance_after_cents = v_balance, updated_at = now(),
         credit_class = case when v_dep > 0 then 'purchased' else credit_class end,
         withdrawable_part = case when v_dep > 0 then v_dep else withdrawable_part end
   where user_id = p_user_id and product = p_product and kind = p_kind and reference = p_reference;
  return v_balance;
end;
$$;

create or replace function public.transfer_credits(
  p_sender uuid, p_account_number text, p_amount integer, p_fee integer, p_idempotency text, p_note text, p_class text
) returns jsonb
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
  v_avail     bigint;
  v_wd        boolean := p_class = 'withdrawable';
  v_id        uuid;
  v_s_after   bigint;
  v_s_dep     bigint;
  v_dep_out   bigint := 0;
  v_dep_in    bigint := 0;
begin
  if p_sender is null or p_amount is null or p_amount <= 0 or p_fee is null or p_fee < 0 or coalesce(p_idempotency, '') = ''
     or p_class is null or p_class not in ('usable', 'withdrawable') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- the same request again answers what it did the first time - never a second transfer
  select id, amount, fee, recipient_id, credit_class into v_existing from public.credit_transfers where sender_id = p_sender and idempotency_key = p_idempotency;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'transfer_id', v_existing.id, 'amount', v_existing.amount, 'fee', v_existing.fee, 'credit_class', v_existing.credit_class);
  end if;
  select user_id into v_recipient from public.wallet_accounts where account_number = p_account_number;
  if v_recipient is null then return jsonb_build_object('ok', false, 'reason', 'no_account'); end if;
  if v_recipient = p_sender then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  if exists (select 1 from public.reward_profiles where user_id = p_sender and restricted) then return jsonb_build_object('ok', false, 'reason', 'restricted'); end if;

  -- both wallets exist, then lock them in a FIXED order so two opposite transfers can never deadlock
  insert into public.ai_product_balances (user_id, product, balance_cents, currency) values (v_recipient, 'character_replace', 0, 'CREDIT') on conflict (user_id, product) do nothing;
  perform 1 from public.ai_product_balances where product = 'character_replace' and user_id in (p_sender, v_recipient) order by user_id for update;

  select balance_cents, withdrawable_cents, deposited_cents, currency into v_s_bal, v_s_wd, v_s_dep, v_s_cur from public.ai_product_balances where user_id = p_sender and product = 'character_replace';
  select balance_cents, currency into v_r_bal, v_r_cur from public.ai_product_balances where user_id = v_recipient and product = 'character_replace';
  if v_s_cur is distinct from 'CREDIT' or v_r_cur is distinct from 'CREDIT' then return jsonb_build_object('ok', false, 'reason', 'no_wallet'); end if;
  -- only the chosen kind pays: amount and fee
  v_avail := case when v_wd then v_s_wd else v_s_bal - v_s_wd end;
  if v_avail < v_total then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'credit_class', p_class, 'available', v_avail, 'needed', v_total);
  end if;

  insert into public.credit_transfers (sender_id, recipient_id, amount, fee, idempotency_key, note, credit_class)
  values (p_sender, v_recipient, p_amount, p_fee, p_idempotency, nullif(btrim(coalesce(p_note, '')), ''), p_class)
  on conflict (sender_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id, amount, fee, credit_class into v_existing from public.credit_transfers where sender_id = p_sender and idempotency_key = p_idempotency;
    return jsonb_build_object('ok', true, 'duplicate', true, 'transfer_id', v_existing.id, 'amount', v_existing.amount, 'fee', v_existing.fee, 'credit_class', v_existing.credit_class);
  end if;

  -- 0202: credits are spent earned-first. The AMOUNT is taken first, so its share beyond the
  -- earned credits came from a deposit and stays deposited for the recipient. The fee is taken
  -- after it, from what is left (lib/ai/credits/wallet-config.ts transferFeeFor prices the same way).
  if v_wd then
    v_dep_out := greatest(0, v_total - (v_s_wd - v_s_dep));
    v_dep_in := greatest(0, p_amount::bigint - (v_s_wd - v_s_dep));
  end if;

  -- the sender: the chosen kind only
  update public.ai_product_balances
     set balance_cents = balance_cents - v_total,
         withdrawable_cents = withdrawable_cents - case when v_wd then v_total else 0 end,
         deposited_cents = deposited_cents - v_dep_out,
         updated_at = now()
   where user_id = p_sender and product = 'character_replace' returning balance_cents into v_s_after;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, metadata, credit_class, withdrawable_part)
  values (p_sender, 'character_replace', 'transfer_out', 'settled', -p_amount, v_s_after + p_fee, 'CREDIT', 'transfer:' || v_id::text, 'Sent to wallet ' || right(p_account_number, 4),
          jsonb_build_object('transfer_id', v_id, 'recipient_id', v_recipient, 'credit_class', p_class, 'deposited', v_dep_out), p_class, case when v_wd then p_amount else 0 end);
  if p_fee > 0 then
    insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, metadata, credit_class, withdrawable_part)
    values (p_sender, 'character_replace', 'transfer_fee', 'settled', -p_fee, v_s_after, 'CREDIT', 'transfer-fee:' || v_id::text, 'Transfer fee',
            jsonb_build_object('transfer_id', v_id, 'credit_class', p_class), p_class, case when v_wd then p_fee else 0 end);
  end if;

  -- the recipient: the same kind
  update public.ai_product_balances
     set balance_cents = balance_cents + p_amount,
         withdrawable_cents = withdrawable_cents + case when v_wd then p_amount else 0 end,
         deposited_cents = deposited_cents + v_dep_in,
         updated_at = now()
   where user_id = v_recipient and product = 'character_replace' returning balance_cents into v_r_bal;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, metadata, credit_class, withdrawable_part)
  values (v_recipient, 'character_replace', 'transfer_in', 'settled', p_amount, v_r_bal, 'CREDIT', 'transfer:' || v_id::text,
          case when v_wd then 'Received withdrawable credits' else 'Received credits' end,
          jsonb_build_object('transfer_id', v_id, 'sender_id', p_sender, 'credit_class', p_class, 'deposited', v_dep_in), p_class, case when v_wd then p_amount else 0 end);

  return jsonb_build_object('ok', true, 'transfer_id', v_id, 'recipient_id', v_recipient, 'amount', p_amount, 'fee', p_fee, 'credit_class', p_class,
                            'balance_after', v_s_after, 'recipient_balance_after', v_r_bal);
end;
$$;

do $$
begin
  execute 'drop trigger if exists ai_product_balances_deposited_clamp on public.ai_product_balances';
  execute 'create trigger ai_product_balances_deposited_clamp before insert or update on public.ai_product_balances for each row execute function public.clamp_deposited_cents()';
  execute 'revoke all on function public.transfer_credits(uuid, text, integer, integer, text, text, text) from public, anon, authenticated';
  execute 'grant execute on function public.transfer_credits(uuid, text, integer, integer, text, text, text) to service_role';
end $$;
