-- ═══════════════════════════════════════════════════════════════════════════
--  0160 — A REFUND NEVER CROSSES A CURRENCY (Part 10, 2026-09-20)
-- ═══════════════════════════════════════════════════════════════════════════
-- Found during the production QA pass, reading the ledger around the USD
-- switch (0159). `refund_product_charge` gives back `-delta_cents` of the
-- processing_charge row by adding it to the member's balance — and it never
-- looked at the ROW's currency against the WALLET's. Every reservation in
-- flight on 2026-09-20 had settled or been refunded before the switch, so
-- nothing was mis-credited; but a charge reserved in kobo and refunded after
-- a wallet moved to cents would have credited ~1,335× the money.
--
-- The guard: when the charge row's currency is not the balance row's, the
-- function writes nothing and returns the balance unchanged, with a WARNING
-- in the database log. The job's failure copy already reads the ledger
-- ("Your balance refund is being processed" while the charge stays
-- `reserved`), and an operator settles it by hand through the audited
-- adjustment — with the rate of the day, which SQL does not have.
--
-- Same signature, so every caller (lib/ai/character-replace/wallet.ts) is
-- unchanged; the revoke/grant is re-issued because CREATE OR REPLACE keeps
-- the existing ACL but a fresh database would not have one.

create or replace function public.refund_product_charge(
  p_user_id uuid,
  p_product text,
  p_job_id  uuid,
  p_note    text default null
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charged  bigint;
  v_currency text;
  v_wallet   text;
  v_balance  bigint;
begin
  select -delta_cents, currency into v_charged, v_currency
    from public.ai_product_ledger
   where user_id = p_user_id and product = p_product and kind = 'processing_charge'
     and reference = p_job_id::text and status in ('reserved', 'settled');
  if v_charged is null or v_charged <= 0 then
    select balance_cents into v_balance from public.ai_product_balances where user_id = p_user_id and product = p_product;
    return coalesce(v_balance, 0);
  end if;
  -- 🔴 The currency of the charge must be the currency of the wallet it goes back into.
  select currency, balance_cents into v_wallet, v_balance
    from public.ai_product_balances where user_id = p_user_id and product = p_product;
  if v_wallet is not null and coalesce(v_currency, v_wallet) <> v_wallet then
    raise warning 'refund_product_charge: job % charged in % but the wallet is % — nothing written; settle by adjustment', p_job_id, v_currency, v_wallet;
    return coalesce(v_balance, 0);
  end if;
  -- The refund row's uniqueness is the "never twice": a second call hits the
  -- index and writes nothing, and the balance does not move again.
  insert into public.ai_product_ledger
    (user_id, product, kind, status, delta_cents, balance_after_cents, currency, job_id, reference, note)
  values (p_user_id, p_product, 'refund', 'settled', v_charged, 0, coalesce(v_currency, v_wallet, 'NGN'), p_job_id, p_job_id::text, p_note)
  on conflict (user_id, product, kind, reference) where reference is not null do nothing;
  if not found then
    select balance_cents into v_balance from public.ai_product_balances where user_id = p_user_id and product = p_product;
    return coalesce(v_balance, 0);
  end if;
  update public.ai_product_balances
     set balance_cents = balance_cents + v_charged, updated_at = now()
   where user_id = p_user_id and product = p_product
  returning balance_cents into v_balance;
  update public.ai_product_ledger
     set balance_after_cents = coalesce(v_balance, v_charged), updated_at = now()
   where user_id = p_user_id and product = p_product and kind = 'refund' and reference = p_job_id::text;
  update public.ai_product_ledger
     set status = 'refunded', updated_at = now()
   where user_id = p_user_id and product = p_product and kind = 'processing_charge' and reference = p_job_id::text;
  return coalesce(v_balance, 0);
end;
$$;

do $$
begin
  execute 'revoke all on function public.refund_product_charge(uuid, text, uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.refund_product_charge(uuid, text, uuid, text) to service_role';
end $$;
