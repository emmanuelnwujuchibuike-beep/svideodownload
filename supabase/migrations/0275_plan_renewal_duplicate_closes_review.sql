-- 0275 — a renewal that was ALREADY applied closes its open review (Part 3.3.2, 2026-10-23)
--
-- Part 3.3.1 finding L3: apply_plan_renewal (0274) answered "duplicate" for a transaction already in plan_renewals but left
-- that transaction's open review (dedupe key renewal:<provider>:<transaction id>) open — an admin who pressed "Apply" after
-- the webhook or the cron had applied it saw a success while the review stayed in the queue. Now BOTH duplicate exits close
-- that review as 'applied' ("already applied") in the same transaction, before answering "duplicate".
--
-- Nothing else changes: the same row lock (FOR UPDATE) taken first, the same identity / plan / contract checks, the same
-- unique ledger key (provider, transaction_id) and ON CONFLICT backstop, no second period. Concurrent admin requests and
-- duplicate webhook deliveries serialise on the member row lock, and the review update is idempotent (open reviews only).
--
-- Depends on 0274. Run by hand AFTER 0274. Safe to run twice (create or replace; grants re-applied).

create or replace function public.plan_renewal_duplicate(p_provider text, p_transaction_id text, p_admin uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  -- the transaction is already in the ledger: its open review (if any) is settled — as applied, by whoever applied it
  update public.plan_billing_reviews
     set status = 'applied', resolution_note = coalesce(resolution_note, 'already applied'), resolved_by = coalesce(resolved_by, p_admin), resolved_at = coalesce(resolved_at, now()), updated_at = now()
   where dedupe_key = 'renewal:' || p_provider || ':' || p_transaction_id and status = 'open';
  return jsonb_build_object('result', 'duplicate');
end;
$$;

create or replace function public.apply_plan_renewal(
  p_provider text,
  p_transaction_id text,
  p_target text,
  p_user_id uuid,
  p_subscription_ref text,
  p_plan_code text,
  p_amount_minor bigint,
  p_currency text,
  p_source text,
  p_admin uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_provider text;
  v_ref text;
  v_plan text;
  v_amount bigint;
  v_currency text;
  v_interval text;
  v_end timestamptz;
  v_status text;
  v_base timestamptz;
  v_new timestamptz;
  v_id uuid;
begin
  if p_provider is distinct from 'flutterwave' or p_transaction_id !~ '^[0-9]{1,20}$'
     or p_target not in ('ai_subscription', 'site_subscription') or p_user_id is null
     or coalesce(p_subscription_ref, '') = '' or p_amount_minor is null or p_amount_minor <= 0
     or coalesce(p_currency, '') !~ '^[A-Z]{3}$' or p_source not in ('webhook', 'reconcile', 'admin') then
    return jsonb_build_object('result', 'invalid');
  end if;

  -- the subscription row, LOCKED: every renewal, expiry and activation of this member serialises here
  if p_target = 'ai_subscription' then
    select provider, subscription_ref, plan_code, contract_amount_minor, contract_currency, contract_interval, current_period_end, status
      into v_provider, v_ref, v_plan, v_amount, v_currency, v_interval, v_end, v_status
      from public.ai_subscriptions where user_id = p_user_id for update;
  else
    select provider, subscription_ref, plan_code, contract_amount_minor, contract_currency, contract_interval, current_period_end, status::text
      into v_provider, v_ref, v_plan, v_amount, v_currency, v_interval, v_end, v_status
      from public.subscriptions where user_id = p_user_id for update;
  end if;
  if not found then return jsonb_build_object('result', 'no_subscription'); end if;

  -- the same transaction again (a redelivery, the cron after the webhook, a retry after an unclear answer)
  if exists (select 1 from public.plan_renewals where provider = p_provider and transaction_id = p_transaction_id) then
    return public.plan_renewal_duplicate(p_provider, p_transaction_id, p_admin);
  end if;

  -- identity and contract, read under the lock — never the caller's word for them
  if v_provider is distinct from p_provider or v_ref is distinct from p_subscription_ref then
    return jsonb_build_object('result', 'identity_mismatch');
  end if;
  if p_plan_code is not null and v_plan is distinct from p_plan_code then
    return jsonb_build_object('result', 'plan_mismatch');
  end if;
  if v_amount is null or v_currency is null or plan_interval(v_interval) is null then
    return jsonb_build_object('result', 'no_contract');
  end if;
  if v_amount <> p_amount_minor or v_currency <> p_currency then
    return jsonb_build_object('result', 'contract_mismatch');
  end if;

  -- one period from the later of the paid-through time and now (a late renewal never loses the member time)
  v_base := greatest(coalesce(v_end, now()), now());
  v_new := v_base + plan_interval(v_interval);

  insert into public.plan_renewals (provider, transaction_id, target, user_id, subscription_ref, plan_code, amount_minor, currency, period_end_before, period_end_after, source, applied_by)
  values (p_provider, p_transaction_id, p_target, p_user_id, p_subscription_ref, v_plan, p_amount_minor, p_currency, v_end, v_new, p_source, p_admin)
  on conflict (provider, transaction_id) do nothing
  returning id into v_id;
  if v_id is null then return public.plan_renewal_duplicate(p_provider, p_transaction_id, p_admin); end if;

  if p_target = 'ai_subscription' then
    update public.ai_subscriptions
       set current_period_start = v_base, current_period_end = v_new, status = 'active',
           last_reference = 'flw_tx_' || p_transaction_id, updated_at = now()
     where user_id = p_user_id;
  else
    update public.subscriptions
       set current_period_end = v_new, status = 'active', last_reference = 'flw_tx_' || p_transaction_id, updated_at = now()
     where user_id = p_user_id;
    update public.profiles set role = 'pro' where id = p_user_id and role = 'user';
  end if;

  -- a renewal an admin applied from the review queue closes that review in the same transaction
  update public.plan_billing_reviews
     set status = 'applied', resolved_by = p_admin, resolved_at = now(), updated_at = now()
   where dedupe_key = 'renewal:' || p_provider || ':' || p_transaction_id and status = 'open';

  return jsonb_build_object('result', 'applied', 'period_end_before', v_end, 'period_end_after', v_new);
end;
$$;

do $$
begin
  execute 'revoke all on function public.plan_renewal_duplicate(text, text, uuid) from public, anon, authenticated';
  execute 'grant execute on function public.plan_renewal_duplicate(text, text, uuid) to service_role';
  execute 'revoke all on function public.apply_plan_renewal(text, text, text, uuid, text, text, bigint, text, text, uuid) from public, anon, authenticated';
  execute 'grant execute on function public.apply_plan_renewal(text, text, text, uuid, text, text, bigint, text, text, uuid) to service_role';
end $$;
