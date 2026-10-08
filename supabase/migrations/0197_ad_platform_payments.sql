-- ═══════════════════════════════════════════════════════════════════════════
--  0197 — ADS PAID THROUGH THE EXISTING RAILS (Part 3 of the ad platform, 2026-10-08)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- No second payment system. An ad payment is a row in ai_topup_attempts (the
-- one attempt ledger for Paystack AND Bachs since 0186) with purpose
-- ad_campaign, its webhook deliveries are rows in payment_provider_events
-- (0186), the provider is chosen by lib/payments/router.ts, and the naira
-- amount comes from the existing FX service. What this adds:
--
--   1. the attempt learns what an ad payment must remember: the quote it was
--      opened against, the provider amount and currency and the rate, the
--      exact Bachs request (an uncertain write is recovered by repeating it
--      UNCHANGED with the same Idempotency-Key - docs.bachs.io/guides/idempotency),
--      the provider charge id (refunds and disputes are keyed by it), and the
--      refund / dispute record. Its status gains the states a payment can
--      really be in: verification_required, mismatch, refunded,
--      partially_refunded, chargeback, expired.
--   2. ad_payment_quotes - the commercial snapshot an advertiser pays. An admin
--      price change after checkout began never touches an open quote.
--   3. settings: an emergency payment switch, the quote lifetime, and what a
--      refund or a chargeback does to a campaign.
--   4. the functions that move money state, each one transaction, each one
--      idempotent: begin, release, settle (verified payment to paid campaigns),
--      reverse (refund or chargeback), and the reconciliation view.
--   5. Part 1 shortcuts that Part 3 replaces are DROPPED: the single-campaign
--      card settle (superseded by the application settle) and the wallet
--      payment (owner, Part 3: ads are not paid from AI credits).
--
-- Runner rules: no semicolon inside a quoted string, functions LAST.

-- ═══ 1 · the attempt ledger, extended ═══════════════════════════════════════
alter table public.ai_topup_attempts add column if not exists quote_id uuid;
alter table public.ai_topup_attempts add column if not exists provider_currency text;
alter table public.ai_topup_attempts add column if not exists provider_amount bigint;
alter table public.ai_topup_attempts add column if not exists fx_minor_per_usd bigint;
alter table public.ai_topup_attempts add column if not exists fx_at timestamptz;
alter table public.ai_topup_attempts add column if not exists checkout_url text;
alter table public.ai_topup_attempts add column if not exists provider_request jsonb;
alter table public.ai_topup_attempts add column if not exists charge_id text;
alter table public.ai_topup_attempts add column if not exists verified_at timestamptz;
alter table public.ai_topup_attempts add column if not exists paid_amount bigint;
alter table public.ai_topup_attempts add column if not exists paid_currency text;
alter table public.ai_topup_attempts add column if not exists refunded_amount bigint;
alter table public.ai_topup_attempts add column if not exists refunded_at timestamptz;
alter table public.ai_topup_attempts add column if not exists reversal_reason text;
alter table public.ai_topup_attempts add column if not exists disputed_at timestamptz;
alter table public.ai_topup_attempts add column if not exists status_reason text;
alter table public.ai_topup_attempts add column if not exists metadata jsonb;

alter table public.ai_topup_attempts drop constraint if exists ai_topup_attempts_status_chk;
alter table public.ai_topup_attempts add constraint ai_topup_attempts_status_chk check (status in (
  'pending', 'success', 'failed', 'abandoned',
  'verification_required', 'mismatch', 'refunded', 'partially_refunded', 'chargeback', 'expired'));

-- one open ad payment per application: a double tap, two tabs or a retry
-- storm can never open two checkouts for one campaign
create unique index if not exists ai_topup_attempts_ad_open_idx
  on public.ai_topup_attempts (item_id)
  where purpose = 'ad_campaign' and status in ('pending', 'verification_required');
-- one provider charge is one payment
create unique index if not exists ai_topup_attempts_charge_idx
  on public.ai_topup_attempts (provider, charge_id) where charge_id is not null;
create index if not exists ai_topup_attempts_ad_admin_idx
  on public.ai_topup_attempts (created_at desc) where purpose = 'ad_campaign';

-- ═══ 2 · the quote ═══════════════════════════════════════════════════════════
create table if not exists public.ad_payment_quotes (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.ad_campaigns (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  currency        text not null,
  total_minor     bigint not null,
  lines           jsonb not null,
  status          text not null default 'open',
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  used_at         timestamptz,
  constraint ad_payment_quotes_status_chk check (status in ('open', 'used', 'superseded', 'expired')),
  constraint ad_payment_quotes_total_chk check (total_minor >= 0),
  constraint ad_payment_quotes_currency_chk check (currency in ('CREDIT', 'USD', 'NGN'))
);
create index if not exists ad_payment_quotes_app_idx on public.ad_payment_quotes (application_id, created_at desc);
create unique index if not exists ad_payment_quotes_one_open_idx on public.ad_payment_quotes (application_id) where status = 'open';

alter table public.ad_payment_quotes enable row level security;
revoke insert, update, delete, truncate on public.ad_payment_quotes from anon, authenticated;
drop policy if exists "ad quotes own or admin" on public.ad_payment_quotes;
create policy "ad quotes own or admin" on public.ad_payment_quotes
  for select using (user_id = (select auth.uid()) or (select public.is_admin()));

alter table public.ai_topup_attempts drop constraint if exists ai_topup_attempts_quote_fk;
alter table public.ai_topup_attempts add constraint ai_topup_attempts_quote_fk foreign key (quote_id) references public.ad_payment_quotes (id) on delete set null;

-- ═══ 3 · admin switches ══════════════════════════════════════════════════════
alter table public.ad_platform_settings add column if not exists payments_enabled boolean not null default true;
alter table public.ad_platform_settings add column if not exists quote_ttl_minutes integer not null default 30;
alter table public.ad_platform_settings add column if not exists checkout_honour_hours integer not null default 24;
alter table public.ad_platform_settings add column if not exists refund_after_start text not null default 'remove';
alter table public.ad_platform_settings add column if not exists chargeback_action text not null default 'pause';
alter table public.ad_platform_settings drop constraint if exists ad_platform_settings_pay_chk;
alter table public.ad_platform_settings add constraint ad_platform_settings_pay_chk check (
  quote_ttl_minutes between 5 and 1440
  and checkout_honour_hours between 1 and 168
  and refund_after_start in ('remove', 'pause', 'keep')
  and chargeback_action in ('pause', 'remove'));

comment on table public.ad_payment_quotes is 'The price an advertiser was shown and pays (0197): per-campaign lines from ad_campaign_quote, the total, and an expiry. An admin price change never edits an open quote. One open quote per application.';
comment on column public.ai_topup_attempts.provider_request is 'Bachs only (0197): the exact checkout request sent with Idempotency-Key = reference, kept so an uncertain write is recovered by repeating it unchanged - never by a new key.';
comment on column public.ai_topup_attempts.charge_id is 'The provider charge id once paid (0197). Refund and dispute webhooks name the charge, not our reference.';

-- ═════════════════════════════════════════════════════════════════════════════
--  FUNCTIONS LAST
-- ═════════════════════════════════════════════════════════════════════════════

drop function if exists public.settle_ad_campaign_payment(text);
drop function if exists public.pay_ad_campaign_with_credits(uuid, uuid);

-- ── begin: one transaction checks the quote and the campaigns, records the
--    attempt, and puts the application into payment_processing. The provider
--    is called only AFTER this returns ok. ──
create or replace function public.ad_payment_begin(
  p_user uuid, p_application uuid, p_quote uuid, p_reference text, p_provider text,
  p_amount_usd bigint, p_provider_currency text, p_provider_amount bigint, p_fx bigint, p_metadata jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner    uuid;
  v_q        record;
  v_total    bigint;
  v_bad      integer;
  v_open     text;
  v_settings record;
begin
  select * into v_settings from public.ad_platform_settings where id;
  if not coalesce(v_settings.payments_enabled, false) then return jsonb_build_object('ok', false, 'reason', 'payments_disabled'); end if;
  select a.user_id into v_owner from public.ad_campaigns c join public.advertisers a on a.id = c.advertiser_id where c.id = p_application;
  if v_owner is distinct from p_user then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  -- every campaign of the application, locked, in the same order everywhere
  perform 1 from public.ad_campaigns where application_id = p_application order by id for update;

  select * into v_q from public.ad_payment_quotes where id = p_quote and application_id = p_application and user_id = p_user;
  if not found then return jsonb_build_object('ok', false, 'reason', 'quote_invalid'); end if;
  if v_q.status <> 'open' then return jsonb_build_object('ok', false, 'reason', 'quote_invalid'); end if;
  if v_q.expires_at <= now() then
    update public.ad_payment_quotes set status = 'expired' where id = p_quote;
    return jsonb_build_object('ok', false, 'reason', 'quote_expired');
  end if;
  if v_q.currency <> 'USD' or v_q.total_minor <> p_amount_usd then return jsonb_build_object('ok', false, 'reason', 'quote_invalid'); end if;

  -- the campaigns still carry the quoted prices, rules and no verified payment
  select count(*) filter (where status not in ('awaiting_payment', 'payment_processing') or payment_verified_at is not null or rules_accepted_at is null),
         coalesce(sum(total_amount_minor), -1)
    into v_bad, v_total
    from public.ad_campaigns where application_id = p_application;
  if v_bad > 0 then return jsonb_build_object('ok', false, 'reason', 'not_payable'); end if;
  if v_total <> v_q.total_minor then return jsonb_build_object('ok', false, 'reason', 'quote_invalid'); end if;

  select reference into v_open from public.ai_topup_attempts
   where purpose = 'ad_campaign' and item_id = p_application::text and status in ('pending', 'verification_required');
  if v_open is not null then return jsonb_build_object('ok', false, 'reason', 'payment_open', 'reference', v_open); end if;

  insert into public.ai_topup_attempts (reference, user_id, amount_cents, currency, status, provider, purpose, item_id,
                                        quote_id, provider_currency, provider_amount, fx_minor_per_usd, fx_at, metadata)
  values (p_reference, p_user, p_amount_usd, 'USD', 'pending', p_provider, 'ad_campaign', p_application::text,
          p_quote, p_provider_currency, p_provider_amount, p_fx, case when p_fx is null then null else now() end, p_metadata);

  update public.ad_campaigns
     set status = 'payment_processing', payment_reference = p_reference, payment_method = p_provider
   where application_id = p_application;
  insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role, reason)
  select id, 'payment_started', 'awaiting_payment', 'payment_processing', p_user, 'advertiser', p_provider || ' ' || p_reference
    from public.ad_campaigns where application_id = p_application;
  return jsonb_build_object('ok', true, 'reference', p_reference);
end;
$$;

-- ── release: a payment that did not happen (checkout not created, failed,
--    abandoned, expired) - the attempt keeps its history, the application is
--    payable again. A paid attempt is never released. ──
create or replace function public.ad_payment_release(p_reference text, p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_a record;
begin
  if p_status not in ('failed', 'abandoned', 'expired', 'verification_required', 'mismatch') then
    return jsonb_build_object('ok', false, 'reason', 'bad_status');
  end if;
  select * into v_a from public.ai_topup_attempts where reference = p_reference and purpose = 'ad_campaign' for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_a.status not in ('pending', 'verification_required') then
    return jsonb_build_object('ok', true, 'unchanged', true, 'status', v_a.status);
  end if;
  update public.ai_topup_attempts set status = p_status, status_reason = left(p_reason, 200), updated_at = now() where reference = p_reference;
  -- held states keep the application in payment_processing: money may have moved
  if p_status in ('failed', 'abandoned', 'expired') then
    update public.ad_campaigns set status = 'awaiting_payment'
     where application_id = v_a.item_id::uuid and payment_reference = p_reference
       and status = 'payment_processing' and payment_verified_at is null;
  end if;
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

-- ── settle: a VERIFIED provider report (the webhook after its signature, or
--    the verify-on-return after asking the provider) turns into paid
--    campaigns, once. Amount, currency, provider, purpose and the checkout
--    window are checked here, inside the lock. ──
create or replace function public.ad_payment_settle(
  p_reference text, p_provider text, p_paid_amount bigint, p_paid_currency text,
  p_charge_id text, p_external_id text, p_full_payment_asserted boolean, p_via text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_a       record;
  v_honour  integer;
  v_ok      boolean;
  v_reason  text;
  v_ids     uuid[];
begin
  select * into v_a from public.ai_topup_attempts where reference = p_reference for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_a.purpose <> 'ad_campaign' then return jsonb_build_object('ok', false, 'reason', 'not_an_ad_payment'); end if;
  if v_a.provider <> p_provider then return jsonb_build_object('ok', false, 'reason', 'provider_mismatch'); end if;
  if v_a.status = 'success' then
    select array_agg(id) into v_ids from public.ad_campaigns where application_id = v_a.item_id::uuid and payment_reference = p_reference;
    return jsonb_build_object('ok', true, 'already', true, 'campaign_ids', to_jsonb(v_ids));
  end if;
  if v_a.status in ('refunded', 'partially_refunded', 'chargeback') then return jsonb_build_object('ok', false, 'reason', 'reversed'); end if;
  if p_external_id is not null and v_a.external_id is not null and p_external_id <> v_a.external_id then
    v_reason := 'checkout_mismatch';
  end if;

  -- the amount: in the currency we asked the provider for, or in USD, or
  -- (Bachs, which converts USD at its own page) the provider's own assertion
  -- that the session was paid in full - collection.underpaid is a different event
  v_ok := false;
  if v_reason is null then
    if upper(coalesce(p_paid_currency, '')) = upper(coalesce(v_a.provider_currency, v_a.currency)) then
      v_ok := p_paid_amount is not null and p_paid_amount + 1 >= coalesce(v_a.provider_amount, v_a.amount_cents);
    elsif upper(coalesce(p_paid_currency, '')) = 'USD' then
      v_ok := p_paid_amount is not null and p_paid_amount + 1 >= v_a.amount_cents;
    elsif p_provider = 'bachs' and p_full_payment_asserted then
      v_ok := true;
    end if;
    if not v_ok then v_reason := case when upper(coalesce(p_paid_currency, '')) in (upper(coalesce(v_a.provider_currency, v_a.currency)), 'USD') then 'amount_short' else 'currency_mismatch' end; end if;
  end if;

  if v_reason is not null then
    update public.ai_topup_attempts
       set status = 'mismatch', status_reason = v_reason, paid_amount = p_paid_amount, paid_currency = p_paid_currency,
           charge_id = coalesce(p_charge_id, charge_id), updated_at = now()
     where reference = p_reference;
    insert into public.ad_campaign_events (campaign_id, kind, actor_role, reason)
    select id, 'payment_mismatch', 'system', v_reason || ' ' || p_reference
      from public.ad_campaigns where application_id = v_a.item_id::uuid and payment_reference = p_reference;
    return jsonb_build_object('ok', false, 'reason', 'mismatch', 'detail', v_reason);
  end if;

  -- paid long after the checkout opened: the money is real but the deal is
  -- stale - hold it for a person, never activate at an old price blindly
  select checkout_honour_hours into v_honour from public.ad_platform_settings where id;
  if v_a.created_at < now() - make_interval(hours => coalesce(v_honour, 24)) then
    update public.ai_topup_attempts
       set status = 'verification_required', status_reason = 'paid_after_checkout_window', paid_amount = p_paid_amount,
           paid_currency = p_paid_currency, charge_id = coalesce(p_charge_id, charge_id), updated_at = now()
     where reference = p_reference;
    return jsonb_build_object('ok', false, 'reason', 'held', 'detail', 'paid_after_checkout_window');
  end if;

  update public.ai_topup_attempts
     set status = 'success', verified_at = now(), paid_at = coalesce(paid_at, now()), paid_amount = p_paid_amount,
         paid_currency = p_paid_currency, charge_id = coalesce(p_charge_id, charge_id),
         external_id = coalesce(external_id, p_external_id), status_reason = null, updated_at = now(),
         gateway_response = left(coalesce(p_via, 'verified'), 200)
   where reference = p_reference;
  update public.ad_payment_quotes set status = 'used', used_at = now() where id = v_a.quote_id and status in ('open', 'expired');

  update public.ad_campaigns
     set status = 'paid', payment_verified_at = now()
   where application_id = v_a.item_id::uuid and payment_reference = p_reference
     and status in ('awaiting_payment', 'payment_processing') and payment_verified_at is null;
  select array_agg(id) into v_ids from public.ad_campaigns where application_id = v_a.item_id::uuid and payment_reference = p_reference;
  insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_role, reason)
  select unnest(v_ids), 'paid', 'payment_processing', 'paid', 'system', p_provider || ' ' || p_reference;
  return jsonb_build_object('ok', true, 'campaign_ids', to_jsonb(v_ids));
end;
$$;

-- ── reverse: a refund or a chargeback against a paid ad payment. The money
--    record is updated, and the campaign follows the admin's policy:
--    never started → removed · refund after start → refund_after_start ·
--    chargeback → chargeback_action. A partial refund records the money and
--    leaves the campaign to the admin. ──
create or replace function public.ad_payment_reverse(p_reference text, p_kind text, p_amount bigint, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_a      record;
  v_s      record;
  v_status text;
  v_partial boolean;
  c        record;
  v_action text;
begin
  if p_kind not in ('refund', 'chargeback', 'chargeback_won') then return jsonb_build_object('ok', false, 'reason', 'bad_kind'); end if;
  select * into v_a from public.ai_topup_attempts where reference = p_reference and purpose = 'ad_campaign' for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into v_s from public.ad_platform_settings where id;

  if p_kind = 'chargeback_won' then
    if v_a.status = 'chargeback' then
      update public.ai_topup_attempts set status = 'success', status_reason = 'dispute won', updated_at = now() where reference = p_reference;
    end if;
    return jsonb_build_object('ok', true, 'status', 'success');
  end if;

  v_partial := p_kind = 'refund' and p_amount is not null and p_amount + 1 < coalesce(v_a.paid_amount, v_a.provider_amount, v_a.amount_cents);
  v_status := case when p_kind = 'chargeback' then 'chargeback' when v_partial then 'partially_refunded' else 'refunded' end;
  if v_a.status = v_status then return jsonb_build_object('ok', true, 'already', true); end if;
  if v_a.status not in ('success', 'partially_refunded', 'chargeback', 'refunded') then
    return jsonb_build_object('ok', false, 'reason', 'not_paid', 'status', v_a.status);
  end if;

  update public.ai_topup_attempts
     set status = v_status,
         refunded_amount = case when p_kind = 'refund' then coalesce(p_amount, paid_amount, provider_amount, amount_cents) else refunded_amount end,
         refunded_at = case when p_kind = 'refund' then now() else refunded_at end,
         disputed_at = case when p_kind = 'chargeback' then now() else disputed_at end,
         reversal_reason = left(p_reason, 200), updated_at = now()
   where reference = p_reference;

  if v_partial then return jsonb_build_object('ok', true, 'status', v_status, 'campaigns', 'unchanged'); end if;

  for c in select id, status, started_at from public.ad_campaigns
            where application_id = v_a.item_id::uuid and payment_reference = p_reference
              and status in ('paid', 'validating', 'active', 'paused') for update loop
    v_action := case
      when c.started_at is null then 'remove'
      when p_kind = 'chargeback' then v_s.chargeback_action
      else v_s.refund_after_start end;
    if v_action = 'remove' then
      update public.ad_campaigns set status = 'removed', status_reason = p_kind where id = c.id;
    elsif v_action = 'pause' and c.status = 'active' then
      update public.ad_campaigns set status = 'paused', status_reason = p_kind where id = c.id;
    end if;
    insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_role, reason)
    values (c.id, 'payment_' || p_kind, c.status,
            case v_action when 'remove' then 'removed' when 'pause' then case when c.status = 'active' then 'paused' else c.status end else c.status end,
            'system', left(coalesce(p_reason, p_kind), 200));
  end loop;
  return jsonb_build_object('ok', true, 'status', v_status);
end;
$$;

-- ── reconciliation: every inconsistency a person should look at, never fixed silently ──
create or replace function public.ad_payment_inconsistencies() returns table (
  kind text, reference text, application_id uuid, campaign_id uuid, detail text, since timestamptz
)
language sql stable security definer set search_path = public as $$
  -- a campaign serving or paid without a verified payment (the table forbids it - this proves it)
  select 'campaign_unverified', c.payment_reference, c.application_id, c.id, c.status, c.updated_at
    from public.ad_campaigns c
   where c.status in ('paid', 'validating', 'active', 'paused') and c.payment_verified_at is null
  union all
  -- verified money whose campaign never went live (activation failed or was flagged)
  select 'paid_not_live', a.reference, a.item_id::uuid, c.id, c.status || coalesce(' ' || array_to_string(c.review_flags, ','), ''), a.verified_at
    from public.ai_topup_attempts a
    join public.ad_campaigns c on c.application_id = a.item_id::uuid and c.payment_reference = a.reference
   where a.purpose = 'ad_campaign' and a.status = 'success' and c.status in ('paid', 'validating')
  union all
  -- live or paid campaigns whose money was reversed
  select 'reversed_but_live', a.reference, a.item_id::uuid, c.id, a.status, a.updated_at
    from public.ai_topup_attempts a
    join public.ad_campaigns c on c.application_id = a.item_id::uuid and c.payment_reference = a.reference
   where a.purpose = 'ad_campaign' and a.status in ('refunded', 'chargeback') and c.status = 'active'
  union all
  -- attempts that need a person: uncertain, mismatched, paid late
  select a.status, a.reference, a.item_id::uuid, null::uuid, coalesce(a.status_reason, ''), a.updated_at
    from public.ai_topup_attempts a
   where a.purpose = 'ad_campaign' and a.status in ('verification_required', 'mismatch')
  union all
  -- checkouts still pending long after they opened (the provider may know better)
  select 'stale_pending', a.reference, a.item_id::uuid, null::uuid, a.provider, a.created_at
    from public.ai_topup_attempts a
   where a.purpose = 'ad_campaign' and a.status = 'pending' and a.created_at < now() - interval '2 hours';
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.ad_payment_begin(uuid, uuid, uuid, text, text, bigint, text, bigint, bigint, jsonb)',
    'public.ad_payment_release(text, text, text)',
    'public.ad_payment_settle(text, text, bigint, text, text, text, boolean, text)',
    'public.ad_payment_reverse(text, text, bigint, text)',
    'public.ad_payment_inconsistencies()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
