-- ═══════════════════════════════════════════════════════════════════════════
--  0155 — ONE FRENZ AI BALANCE: the AI wallet moves into the product wallet
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-09-14: "I don't want it to keep showing the Ai clean, I want the
-- Ai clean balance should be added to the character replace and the one
-- balance should be the character replace and it should be in the balance and
-- usage button."
--
-- Part 3 (0154) gave Character Replace its own wallet beside the AI Clean one,
-- and the two showed as two figures. AI Clean is gone (2026-09-13), so its
-- wallet has no product left to spend on. This moves every remaining AI
-- balance INTO the Character Replace wallet, once, with a ledger row on both
-- sides — and from this migration on, every reader and every writer in the
-- application uses the product wallet only. `ai_balances` is frozen at zero;
-- it is not dropped, so the old ledger stays readable for support.
--
-- ── Idempotent by construction ──────────────────────────────────────────────
-- The product-ledger row carries the reference `migrate_ai_balance_<user>`,
-- and (user, product, kind, reference) is unique. A re-run inserts nothing,
-- and the balance upsert below is driven by the rows that WERE inserted, so
-- the money can never be moved twice.
--
-- ── The old ledger gets a matching row ──────────────────────────────────────
-- `ai_balance_ledger.kind` was checked against four values; `migrated_out`
-- (negative) is added so the AI wallet's own statement shows where the money
-- went instead of ending on a balance that silently became zero.

alter table public.ai_balance_ledger drop constraint if exists ai_balance_ledger_kind_chk;
alter table public.ai_balance_ledger add constraint ai_balance_ledger_kind_chk
  check (kind in ('topup', 'admin_credit', 'job_charge', 'job_refund', 'migrated_out'));

alter table public.ai_balance_ledger drop constraint if exists ai_balance_ledger_sign_chk;
alter table public.ai_balance_ledger add constraint ai_balance_ledger_sign_chk check (
  (kind in ('topup', 'admin_credit', 'job_refund') and delta_cents > 0)
  or (kind in ('job_charge', 'migrated_out') and delta_cents < 0)
);

comment on table public.ai_balances is
  'RETIRED 2026-09-14 (0155): every balance was moved into ai_product_balances (product character_replace), which is the one Frenz AI balance. Kept, at zero, so the old ledger stays readable. Nothing in the application writes it any more.';

do $$
declare
  v_currency text;
  r record;
  v_after bigint;
begin
  select coalesce(value ->> 'frenzAiCurrency', 'NGN') into v_currency
    from public.settings where key = 'landing';
  if v_currency is null then v_currency := 'NGN'; end if;

  for r in
    select b.user_id, b.balance_cents
      from public.ai_balances b
     where b.balance_cents > 0
     order by b.user_id
  loop
    -- Lock the member's product row (creating it if absent) so the read-add-write
    -- below is serialised against the application's own functions.
    insert into public.ai_product_balances (user_id, product, balance_cents, currency)
    values (r.user_id, 'character_replace', 0, v_currency)
    on conflict (user_id, product) do nothing;

    select balance_cents into v_after
      from public.ai_product_balances
     where user_id = r.user_id and product = 'character_replace'
       for update;

    -- The once-only row. If it already exists, this member was migrated on an
    -- earlier run: skip them entirely.
    begin
      insert into public.ai_product_ledger
        (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, metadata)
      values
        (r.user_id, 'character_replace', 'adjustment', 'settled', r.balance_cents, v_after + r.balance_cents,
         v_currency, 'migrate_ai_balance_' || r.user_id::text,
         'Moved from your Frenz AI balance',
         jsonb_build_object('migration', '0155', 'from', 'ai_balances'));
    exception when unique_violation then
      continue;
    end;

    update public.ai_product_balances
       set balance_cents = v_after + r.balance_cents, updated_at = now()
     where user_id = r.user_id and product = 'character_replace';

    -- The old wallet's statement shows the move, and the old balance ends at 0.
    insert into public.ai_balance_ledger (user_id, kind, delta_cents, balance_after_cents, note)
    values (r.user_id, 'migrated_out', -r.balance_cents, 0, 'Moved to your Character Replace balance');

    update public.ai_balances
       set balance_cents = 0, updated_at = now()
     where user_id = r.user_id;
  end loop;
end $$;
