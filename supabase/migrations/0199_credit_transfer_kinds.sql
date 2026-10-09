-- ═══════════════════════════════════════════════════════════════════════════
--  0199 — credit transfers keep their KIND (2026-10-08)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "Non withdrawal credits sent to an account that is qualified for
-- withdraw will not be able to be withdrawn, withdrawal credits and non
-- withdrawal credits should be differentiated when sending credits and when
-- received it should be differentiated."
--
-- 0193 sent "non-withdrawable first, then withdrawable" and always CREDITED the
-- recipient as usable. Now the sender chooses which kind to send and the
-- recipient receives exactly that kind:
--
--   'usable'        taken ONLY from the sender's non-withdrawable credits
--                   (amount + fee), arrives non-withdrawable — even for a
--                   member approved for withdrawals. It can never become cash.
--   'withdrawable'  taken ONLY from the sender's withdrawable credits
--                   (amount + fee), arrives withdrawable. No new cash is made:
--                   the same credits were already cashable by the sender.
--
-- Everything else is 0193 unchanged: idempotency, the restriction check, the
-- fixed lock order, three ledger lines. No semicolon inside any quoted string.

alter table public.credit_transfers add column if not exists credit_class text not null default 'usable';
alter table public.credit_transfers drop constraint if exists credit_transfers_class_chk;
alter table public.credit_transfers add constraint credit_transfers_class_chk check (credit_class in ('usable', 'withdrawable'));

-- one signature only (a defaulted extra argument would make named calls ambiguous)
drop function if exists public.transfer_credits(uuid, text, integer, integer, text, text);

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

  select balance_cents, withdrawable_cents, currency into v_s_bal, v_s_wd, v_s_cur from public.ai_product_balances where user_id = p_sender and product = 'character_replace';
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

  -- the sender: the chosen kind only
  update public.ai_product_balances
     set balance_cents = balance_cents - v_total,
         withdrawable_cents = withdrawable_cents - case when v_wd then v_total else 0 end,
         updated_at = now()
   where user_id = p_sender and product = 'character_replace' returning balance_cents into v_s_after;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, metadata, credit_class, withdrawable_part)
  values (p_sender, 'character_replace', 'transfer_out', 'settled', -p_amount, v_s_after + p_fee, 'CREDIT', 'transfer:' || v_id::text, 'Sent to wallet ' || right(p_account_number, 4),
          jsonb_build_object('transfer_id', v_id, 'recipient_id', v_recipient, 'credit_class', p_class), p_class, case when v_wd then p_amount else 0 end);
  if p_fee > 0 then
    insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, metadata, credit_class, withdrawable_part)
    values (p_sender, 'character_replace', 'transfer_fee', 'settled', -p_fee, v_s_after, 'CREDIT', 'transfer-fee:' || v_id::text, 'Transfer fee',
            jsonb_build_object('transfer_id', v_id, 'credit_class', p_class), p_class, case when v_wd then p_fee else 0 end);
  end if;

  -- the recipient: the same kind
  update public.ai_product_balances
     set balance_cents = balance_cents + p_amount,
         withdrawable_cents = withdrawable_cents + case when v_wd then p_amount else 0 end,
         updated_at = now()
   where user_id = v_recipient and product = 'character_replace' returning balance_cents into v_r_bal;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, metadata, credit_class, withdrawable_part)
  values (v_recipient, 'character_replace', 'transfer_in', 'settled', p_amount, v_r_bal, 'CREDIT', 'transfer:' || v_id::text,
          case when v_wd then 'Received withdrawable credits' else 'Received credits' end,
          jsonb_build_object('transfer_id', v_id, 'sender_id', p_sender, 'credit_class', p_class), p_class, case when v_wd then p_amount else 0 end);

  return jsonb_build_object('ok', true, 'transfer_id', v_id, 'recipient_id', v_recipient, 'amount', p_amount, 'fee', p_fee, 'credit_class', p_class,
                            'balance_after', v_s_after, 'recipient_balance_after', v_r_bal);
end;
$$;

revoke all on function public.transfer_credits(uuid, text, integer, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.transfer_credits(uuid, text, integer, integer, text, text, text) to service_role;
