-- 0274 — Flutterwave recurring billing: subscription identity, an atomic renewal ledger, a review queue (Part 3.3, 2026-10-23)
--
-- The Part 3.2 audit found a Flutterwave plan renewal was matched to a member by EMAIL and TODAY's plan price, with no
-- durable once-per-transaction record and an app-level "check, then update". This migration adds what the corrected code
-- needs — nothing is removed, no existing row changes meaning:
--
--   1. The CONTRACT on each Flutterwave subscription row: the Flutterwave subscription id (subscription_ref, already a
--      column), the payment-plan id (plan_code — new on `subscriptions`), and the contracted amount / currency / interval
--      read from the verified FIRST charge. A renewal is compared with THIS, never with whatever the admin configures later.
--      All nullable: every Paystack row (and every row before 0274) stays exactly valid.
--   2. `plan_renewals` — one row per Flutterwave transaction that extended a plan. UNIQUE (provider, transaction_id): a
--      transaction extends a plan at most once, whatever path (webhook, cron, admin) and however often it is delivered.
--   3. `plan_billing_reviews` — what could not be settled automatically (a renewal whose subscription could not be
--      proven, an unconfirmed activation, an unresolved cancellation, an old subscription still charging after an
--      upgrade). UNIQUE dedupe_key: the webhook and the cron never queue the same thing twice.
--   4. apply_plan_renewal(...) — the ONLY writer of a renewal: in ONE transaction it locks the subscription row, checks
--      the stored identity (provider, subscription id, plan) and the contract (amount, currency), claims the transaction in
--      plan_renewals and extends the period from the later of the paid-through time and now. Two renewals of one
--      subscription serialise on the row lock (neither is lost); the same transaction twice hits the unique key ("duplicate").
--      It never touches cancel_at_period_end (a member's cancel survives a renewal that was already in flight).
--   5. expire_flutterwave_site_plan(user) — closes a Pro / Business plan only if, UNDER THE ROW LOCK, its paid period
--      (plus the 3-day renewal grace, none after a cancellation) is still over: a renewal that landed after the sweep read
--      the row wins. Status past_due (lapsed) or canceled (cancelled and ended); the role back to user (never an admin).
--
-- Both tables: RLS on, no policy, no grants to anon/authenticated — service role only (like 0272). They hold ids, amounts
-- and reasons; never card data, never a raw email. Depends on 0004, 0167 and 0273 (subscriptions.last_reference).
-- Run by hand AFTER 0271, 0272 and 0273. Safe to run twice.

-- ── 1 · the contract on each subscription row ─────────────────────────────────────────────────────────────────────────
alter table public.ai_subscriptions add column if not exists contract_amount_minor bigint;
alter table public.ai_subscriptions add column if not exists contract_currency text;
alter table public.ai_subscriptions add column if not exists contract_interval text;

alter table public.subscriptions add column if not exists plan_code text;
alter table public.subscriptions add column if not exists contract_amount_minor bigint;
alter table public.subscriptions add column if not exists contract_currency text;
alter table public.subscriptions add column if not exists contract_interval text;

alter table public.ai_subscriptions drop constraint if exists ai_subscriptions_contract_chk;
alter table public.ai_subscriptions
  add constraint ai_subscriptions_contract_chk check (
    (contract_amount_minor is null or contract_amount_minor > 0)
    and (contract_currency is null or contract_currency ~ '^[A-Z]{3}$')
    and (contract_interval is null or contract_interval in ('daily', 'weekly', 'monthly', 'quarterly', 'bi-annually', 'yearly'))
  ) not valid;
alter table public.ai_subscriptions validate constraint ai_subscriptions_contract_chk;

alter table public.subscriptions drop constraint if exists subscriptions_contract_chk;
alter table public.subscriptions
  add constraint subscriptions_contract_chk check (
    (contract_amount_minor is null or contract_amount_minor > 0)
    and (contract_currency is null or contract_currency ~ '^[A-Z]{3}$')
    and (contract_interval is null or contract_interval in ('daily', 'weekly', 'monthly', 'quarterly', 'bi-annually', 'yearly'))
  ) not valid;
alter table public.subscriptions validate constraint subscriptions_contract_chk;

-- a Flutterwave subscription belongs to ONE member row (ai_subscriptions.subscription_ref is already unique since 0167;
-- `subscriptions` gets the same guarantee for Flutterwave rows only — older Paystack rows are not touched by it)
create unique index if not exists subscriptions_flutterwave_ref_uniq
  on public.subscriptions (subscription_ref) where provider = 'flutterwave' and subscription_ref is not null;

comment on column public.subscriptions.plan_code is 'The provider''s payment-plan id this subscription was bought on (0274, Flutterwave rows). Paystack rows keep it null.';
comment on column public.subscriptions.contract_amount_minor is 'What each renewal must charge, in minor units — from the verified first charge (0274). Not the admin''s current price.';
comment on column public.ai_subscriptions.contract_amount_minor is 'What each renewal must charge, in minor units — from the verified first charge (0274). Not the admin''s current price.';

-- ── 2 · the renewal ledger ────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.plan_renewals (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null,
  transaction_id     text not null,
  target             text not null,
  user_id            uuid not null references auth.users (id) on delete cascade,
  subscription_ref   text not null,
  plan_code          text,
  amount_minor       bigint not null,
  currency           text not null,
  period_end_before  timestamptz,
  period_end_after   timestamptz not null,
  source             text not null,
  applied_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint plan_renewals_provider_chk check (provider in ('flutterwave')),
  constraint plan_renewals_tx_chk check (transaction_id ~ '^[0-9]{1,20}$'),
  constraint plan_renewals_target_chk check (target in ('ai_subscription', 'site_subscription')),
  constraint plan_renewals_money_chk check (amount_minor > 0 and currency ~ '^[A-Z]{3}$'),
  constraint plan_renewals_source_chk check (source in ('webhook', 'reconcile', 'admin')),
  constraint plan_renewals_tx_uniq unique (provider, transaction_id)
);
create index if not exists plan_renewals_user_idx on public.plan_renewals (user_id, created_at desc);
comment on table public.plan_renewals is
  'One row per provider transaction that extended a plan (0274). UNIQUE (provider, transaction_id): a transaction extends a plan at most once. Written only by apply_plan_renewal. Service role only.';

-- ── 3 · the review queue ──────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.plan_billing_reviews (
  id                 uuid primary key default gen_random_uuid(),
  dedupe_key         text not null,
  kind               text not null,
  reason             text not null,
  provider           text not null default 'flutterwave',
  transaction_id     text,
  target             text,
  user_id            uuid references auth.users (id) on delete set null,
  subscription_ref   text,
  plan_code          text,
  amount_minor       bigint,
  currency           text,
  status             text not null default 'open',
  resolution_note    text,
  resolved_by        uuid references auth.users (id) on delete set null,
  resolved_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint plan_billing_reviews_kind_chk check (kind in ('renewal', 'activation', 'cancellation', 'upgrade')),
  constraint plan_billing_reviews_status_chk check (status in ('open', 'applied', 'resolved', 'dismissed')),
  constraint plan_billing_reviews_target_chk check (target is null or target in ('ai_subscription', 'site_subscription')),
  constraint plan_billing_reviews_tx_chk check (transaction_id is null or transaction_id ~ '^[0-9]{1,20}$'),
  constraint plan_billing_reviews_dedupe_uniq unique (dedupe_key)
);
create index if not exists plan_billing_reviews_open_idx on public.plan_billing_reviews (status, created_at desc);
comment on table public.plan_billing_reviews is
  'Flutterwave plan billing that could not be settled automatically (0274): unproven renewals, unconfirmed activations and cancellations, an old subscription still charging after an upgrade. Shown in Admin → Flutterwave. Service role only.';

alter table public.plan_renewals enable row level security;
alter table public.plan_billing_reviews enable row level security;
revoke all on public.plan_renewals from public, anon, authenticated;
revoke all on public.plan_billing_reviews from public, anon, authenticated;
grant all on public.plan_renewals to service_role;
grant all on public.plan_billing_reviews to service_role;

-- ── 4 · the one writer of a renewal ───────────────────────────────────────────────────────────────────────────────────
create or replace function public.plan_interval(p text) returns interval
language sql immutable set search_path = public as $$
  select case p
    when 'daily' then interval '1 day'
    when 'weekly' then interval '7 days'
    when 'monthly' then interval '1 month'
    when 'quarterly' then interval '3 months'
    when 'bi-annually' then interval '6 months'
    when 'yearly' then interval '1 year'
  end
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
    return jsonb_build_object('result', 'duplicate');
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
  if v_id is null then return jsonb_build_object('result', 'duplicate'); end if;

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

-- ── 5 · expiry that cannot overwrite a renewal ────────────────────────────────────────────────────────────────────────
create or replace function public.expire_flutterwave_site_plan(p_user_id uuid, p_grace interval default interval '3 days')
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_end timestamptz;
  v_status text;
  v_cancel boolean;
  v_cutoff timestamptz;
begin
  select current_period_end, status::text, cancel_at_period_end into v_end, v_status, v_cancel
    from public.subscriptions where user_id = p_user_id and provider = 'flutterwave' for update;
  if not found then return 'no_subscription'; end if;
  if v_status not in ('active', 'trialing') then return 'not_active'; end if;
  -- re-read UNDER THE LOCK: a renewal committed after the sweep's query moved current_period_end forward
  v_cutoff := case when v_cancel then v_end else v_end + p_grace end;
  if v_end is not null and now() <= v_cutoff then return 'not_expired'; end if;
  update public.subscriptions
     set status = (case when v_cancel then 'canceled' else 'past_due' end)::public.subscription_status, updated_at = now()
   where user_id = p_user_id;
  update public.profiles set role = 'user' where id = p_user_id and role = 'pro';
  return 'expired';
end;
$$;

do $$
begin
  execute 'revoke all on function public.apply_plan_renewal(text, text, text, uuid, text, text, bigint, text, text, uuid) from public, anon, authenticated';
  execute 'grant execute on function public.apply_plan_renewal(text, text, text, uuid, text, text, bigint, text, text, uuid) to service_role';
  execute 'revoke all on function public.expire_flutterwave_site_plan(uuid, interval) from public, anon, authenticated';
  execute 'grant execute on function public.expire_flutterwave_site_plan(uuid, interval) to service_role';
end $$;
