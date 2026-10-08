-- 0198 · Ad Platform Part 6 — the advertiser dashboard: live edits,
-- advertiser pause/resume, campaign extensions, owner-scoped summaries.
--
-- Reuses, never duplicates: the same campaigns, creatives, quotes, attempt
-- ledger (ai_topup_attempts), providers, webhooks and settle. A live edit keeps
-- the campaign id, payment record, slot, start and end. An extension keeps all
-- of that too and moves only the end, once, after a VERIFIED payment.
-- Every write function is service-role only (the advertiser routes call them
-- after checking the session); the two read functions are owner-scoped and
-- callable by the member straight from the browser (no Vercel function).

-- ─────────────────────── 1 · staged (replacement) creatives ───────────────────────
-- A replacement for a LIVE campaign is 'staged' until it passes validation.
-- Nothing serves a staged creative: ad_serving_snapshot ships status 'active'
-- only, and activate_ad_campaign counts 'active' only.
alter table public.ad_creatives drop constraint if exists ad_creatives_status_chk;
alter table public.ad_creatives add constraint ad_creatives_status_chk check (status in ('active', 'paused', 'removed', 'staged'));

-- ─────────────────────── 2 · swap a validated replacement in, atomically ───────────────────────
create or replace function public.ad_swap_creative(p_campaign uuid, p_user uuid, p_new uuid, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c        record;
  n        record;
  v_fmt    text;
  v_ver    integer;
begin
  select ca.*, a.user_id as owner_id, a.status as adv_status into c
    from public.ad_campaigns ca join public.advertisers a on a.id = ca.advertiser_id
   where ca.id = p_campaign for update of ca;
  if not found or c.owner_id is distinct from p_user then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_expected_version is not null and c.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'stale', 'version', c.version);
  end if;
  if c.adv_status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'advertiser_not_active'); end if;
  if c.status not in ('active', 'paused', 'paid', 'validating') then return jsonb_build_object('ok', false, 'reason', 'not_editable', 'status', c.status); end if;
  if c.end_at is not null and c.end_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  -- a creative a person blocked is a decision, not something an edit can undo
  if exists (select 1 from public.ad_creatives where campaign_id = p_campaign and status = 'active' and validation_status = 'blocked') then
    return jsonb_build_object('ok', false, 'reason', 'blocked');
  end if;
  select * into n from public.ad_creatives where id = p_new and campaign_id = p_campaign for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if n.status <> 'staged' or n.validation_status <> 'valid' or n.url_validation_status <> 'valid' then
    return jsonb_build_object('ok', false, 'reason', 'not_ready');
  end if;
  select p.format_code into v_fmt from public.ad_placements p where p.id = c.placement_id;
  if n.format_code is distinct from v_fmt then return jsonb_build_object('ok', false, 'reason', 'format_mismatch'); end if;

  -- one transaction: the old creative leaves and the new one arrives together.
  -- The old row and its file are KEPT (status 'removed') for the audit.
  update public.ad_creatives set status = 'removed', updated_at = now()
   where campaign_id = p_campaign and status = 'active' and id <> p_new;
  update public.ad_creatives set status = 'active', updated_at = now() where id = p_new;
  update public.ad_campaigns set updated_at = now() where id = p_campaign returning version into v_ver;
  insert into public.ad_campaign_events (campaign_id, kind, actor_id, actor_role, reason)
  values (p_campaign, 'creative_replaced', p_user, 'advertiser', p_new::text);
  return jsonb_build_object('ok', true, 'version', v_ver);
end;
$$;

-- ─────────────────────── 3 · edit the live creative's words and link ───────────────────────
-- The destination arrives already checked by the route (syntax + the admin
-- blocklist, never fetched); null fields stay as they are.
create or replace function public.ad_edit_creative_details(
  p_campaign uuid, p_user uuid, p_expected_version integer, p_headline text, p_description text, p_destination text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c       record;
  v_ver   integer;
  v_n     integer;
  v_what  text[] := '{}'::text[];
begin
  select ca.*, a.user_id as owner_id, a.status as adv_status into c
    from public.ad_campaigns ca join public.advertisers a on a.id = ca.advertiser_id
   where ca.id = p_campaign for update of ca;
  if not found or c.owner_id is distinct from p_user then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_expected_version is not null and c.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'stale', 'version', c.version);
  end if;
  if c.adv_status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'advertiser_not_active'); end if;
  if c.status not in ('active', 'paused', 'paid', 'validating') then return jsonb_build_object('ok', false, 'reason', 'not_editable', 'status', c.status); end if;
  if c.end_at is not null and c.end_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if exists (select 1 from public.ad_creatives where campaign_id = p_campaign and status = 'active' and validation_status = 'blocked') then
    return jsonb_build_object('ok', false, 'reason', 'blocked');
  end if;
  if p_headline is not null then v_what := v_what || 'headline'::text; end if;
  if p_description is not null then v_what := v_what || 'description'::text; end if;
  if p_destination is not null then v_what := v_what || 'destination'::text; end if;
  if cardinality(v_what) = 0 then return jsonb_build_object('ok', false, 'reason', 'nothing_to_change'); end if;

  update public.ad_creatives
     set headline = case when p_headline is null then headline else nullif(p_headline, '') end,
         description = case when p_description is null then description else nullif(p_description, '') end,
         destination_url = coalesce(p_destination, destination_url),
         url_validation_status = case when p_destination is null then url_validation_status else 'valid' end,
         url_block_reason = case when p_destination is null then url_block_reason else null end,
         url_validated_at = case when p_destination is null then url_validated_at else now() end,
         updated_at = now()
   where campaign_id = p_campaign and status = 'active';
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('ok', false, 'reason', 'no_creative'); end if;
  update public.ad_campaigns set updated_at = now() where id = p_campaign returning version into v_ver;
  insert into public.ad_campaign_events (campaign_id, kind, actor_id, actor_role, reason)
  values (p_campaign, 'creative_edited', p_user, 'advertiser', array_to_string(v_what, ','));
  return jsonb_build_object('ok', true, 'version', v_ver, 'changed', to_jsonb(v_what));
end;
$$;

-- ─────────────────────── 4 · advertiser pause / resume ───────────────────────
-- Pause: active → paused, marked as the ADVERTISER's pause. Resume: only that
-- pause (an admin or safety pause is not the advertiser's to lift), through
-- activate_ad_campaign, which re-checks payment, advertiser, placement,
-- format, creative, destination and expiry exactly as for an admin.
create or replace function public.ad_advertiser_pause(p_campaign uuid, p_user uuid, p_pause boolean, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c     record;
  v_ver integer;
  r     jsonb;
begin
  select ca.*, a.user_id as owner_id into c
    from public.ad_campaigns ca join public.advertisers a on a.id = ca.advertiser_id
   where ca.id = p_campaign for update of ca;
  if not found or c.owner_id is distinct from p_user then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_expected_version is not null and c.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'stale', 'version', c.version);
  end if;
  if p_pause then
    if c.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'not_live', 'status', c.status); end if;
    update public.ad_campaigns set status = 'paused', status_reason = 'advertiser_paused' where id = p_campaign returning version into v_ver;
    insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role, reason)
    values (p_campaign, 'paused', 'active', 'paused', p_user, 'advertiser', 'advertiser_paused');
    return jsonb_build_object('ok', true, 'status', 'paused', 'version', v_ver);
  end if;
  if c.status <> 'paused' then return jsonb_build_object('ok', false, 'reason', 'not_paused', 'status', c.status); end if;
  if c.status_reason is distinct from 'advertiser_paused' then return jsonb_build_object('ok', false, 'reason', 'paused_by_frenzsave'); end if;
  r := public.activate_ad_campaign(p_campaign, p_user, 'system');
  if coalesce((r ->> 'ok')::boolean, false) then
    update public.ad_campaigns set status_reason = null where id = p_campaign;
    insert into public.ad_campaign_events (campaign_id, kind, actor_id, actor_role, reason)
    values (p_campaign, 'resumed_by_advertiser', p_user, 'advertiser', null);
  end if;
  return r;
end;
$$;

-- ─────────────────────── 5 · extensions ───────────────────────
create table if not exists public.ad_campaign_extensions (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references public.ad_campaigns (id) on delete cascade,
  user_id            uuid not null references auth.users (id) on delete cascade,
  duration_id        uuid not null references public.ad_durations (id),
  days               integer not null,
  extra_days         integer not null default 0,
  currency           text not null,
  total_minor        bigint not null,
  pricing_plan_id    uuid,
  promotion_id       uuid,
  status             text not null default 'pending',
  payment_reference  text unique,
  old_end_at         timestamptz,
  new_end_at         timestamptz,
  applied_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint ad_campaign_extensions_status_chk check (status in ('pending', 'applied', 'held', 'cancelled')),
  constraint ad_campaign_extensions_days_chk check (days > 0 and extra_days >= 0),
  constraint ad_campaign_extensions_total_chk check (total_minor >= 0)
);
create index if not exists ad_campaign_extensions_campaign_idx on public.ad_campaign_extensions (campaign_id, created_at desc);
create unique index if not exists ad_campaign_extensions_one_pending_idx on public.ad_campaign_extensions (campaign_id) where status = 'pending';
alter table public.ad_campaign_extensions enable row level security;
revoke insert, update, delete, truncate on public.ad_campaign_extensions from anon, authenticated;
drop policy if exists "ad extensions own or admin" on public.ad_campaign_extensions;
create policy "ad extensions own or admin" on public.ad_campaign_extensions
  for select using (user_id = (select auth.uid()) or (select public.is_admin()));

alter table public.ad_payment_quotes add column if not exists kind text not null default 'application';
alter table public.ad_payment_quotes add column if not exists extension_id uuid references public.ad_campaign_extensions (id) on delete set null;
alter table public.ad_payment_quotes drop constraint if exists ad_payment_quotes_kind_chk;
alter table public.ad_payment_quotes add constraint ad_payment_quotes_kind_chk check (kind in ('application', 'extension'));

-- the price for a placement × duration, from admin rows only — ONE rule,
-- used by a new campaign's quote and by an extension's
create or replace function public.ad_price_for(p_placement uuid, p_duration uuid, p_currency text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_pl_enabled  boolean;
  v_fmt_enabled boolean;
  v_days        integer;
  v_d_enabled   boolean;
  v_plan        uuid;
  v_price       bigint;
  v_promo       uuid;
  v_discount    numeric := 0;
  v_extra       integer := 0;
  v_total       bigint;
begin
  select p.enabled, f.enabled into v_pl_enabled, v_fmt_enabled
    from public.ad_placements p join public.ad_formats f on f.code = p.format_code where p.id = p_placement;
  if not coalesce(v_pl_enabled, false) then return jsonb_build_object('ok', false, 'reason', 'placement_disabled'); end if;
  if not coalesce(v_fmt_enabled, false) then return jsonb_build_object('ok', false, 'reason', 'format_disabled'); end if;
  select duration_days, enabled into v_days, v_d_enabled from public.ad_durations where id = p_duration;
  if not coalesce(v_d_enabled, false) then return jsonb_build_object('ok', false, 'reason', 'duration_disabled'); end if;
  select id, price_minor into v_plan, v_price from public.ad_pricing_plans
   where placement_id = p_placement and duration_id = p_duration and currency = p_currency and enabled;
  if v_plan is null then return jsonb_build_object('ok', false, 'reason', 'no_price'); end if;
  select id, discount_percent, extra_days into v_promo, v_discount, v_extra from public.ad_promotions
   where enabled
     and (placement_id is null or placement_id = p_placement)
     and (duration_id is null or duration_id = p_duration)
     and (starts_at is null or starts_at <= now())
     and (ends_at is null or ends_at > now())
   order by discount_percent desc, extra_days desc, created_at
   limit 1;
  v_discount := coalesce(v_discount, 0);
  v_extra := coalesce(v_extra, 0);
  -- the discount is rounded DOWN, so the total is never below the advertised rate
  v_total := greatest(0, v_price - floor(v_price * v_discount / 100)::bigint);
  return jsonb_build_object(
    'ok', true, 'currency', p_currency, 'list_price', v_price, 'discount_percent', v_discount,
    'total', v_total, 'duration_days', v_days, 'extra_days', v_extra,
    'pricing_plan_id', v_plan, 'promotion_id', v_promo, 'quoted_at', now());
end;
$$;

-- unchanged behaviour, now through the one price rule
create or replace function public.ad_campaign_quote(p_campaign uuid, p_currency text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_placement uuid;
  v_duration  uuid;
begin
  select c.placement_id, c.duration_id into v_placement, v_duration from public.ad_campaigns c where c.id = p_campaign;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return public.ad_price_for(v_placement, v_duration, p_currency);
end;
$$;

-- a server-authoritative extension quote: the price is the database's, the
-- quote is the only amount the checkout accepts, one open per campaign
create or replace function public.ad_extension_quote(p_user uuid, p_campaign uuid, p_duration uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c      record;
  v_p    jsonb;
  v_ext  uuid;
  v_q    uuid;
  v_ttl  integer;
  v_exp  timestamptz;
  v_days integer;
  v_extra integer;
begin
  select ca.*, a.user_id as owner_id, a.status as adv_status into c
    from public.ad_campaigns ca join public.advertisers a on a.id = ca.advertiser_id
   where ca.id = p_campaign for update of ca;
  if not found or c.owner_id is distinct from p_user then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if c.adv_status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'advertiser_not_active'); end if;
  if c.status not in ('active', 'paused') or c.payment_verified_at is null or c.end_at is null or c.end_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'not_extendable', 'status', c.status);
  end if;
  if exists (select 1 from public.ad_creatives where campaign_id = p_campaign and status = 'active' and validation_status = 'blocked') then
    return jsonb_build_object('ok', false, 'reason', 'blocked');
  end if;
  if exists (select 1 from public.ai_topup_attempts where purpose = 'ad_campaign' and item_id = p_campaign::text and status in ('pending', 'verification_required')) then
    return jsonb_build_object('ok', false, 'reason', 'payment_open');
  end if;
  v_p := public.ad_price_for(c.placement_id, p_duration, 'USD');
  if not coalesce((v_p ->> 'ok')::boolean, false) then return v_p; end if;
  v_days := (v_p ->> 'duration_days')::integer;
  v_extra := (v_p ->> 'extra_days')::integer;

  update public.ad_campaign_extensions set status = 'cancelled', updated_at = now() where campaign_id = p_campaign and status = 'pending';
  insert into public.ad_campaign_extensions (campaign_id, user_id, duration_id, days, extra_days, currency, total_minor, pricing_plan_id, promotion_id)
  values (p_campaign, p_user, p_duration, v_days, v_extra, 'USD', (v_p ->> 'total')::bigint,
          nullif(v_p ->> 'pricing_plan_id', '')::uuid, nullif(v_p ->> 'promotion_id', '')::uuid)
  returning id into v_ext;

  select coalesce(quote_ttl_minutes, 30) into v_ttl from public.ad_platform_settings where id;
  v_exp := now() + make_interval(mins => coalesce(v_ttl, 30));
  update public.ad_payment_quotes set status = 'superseded' where application_id = p_campaign and status = 'open';
  insert into public.ad_payment_quotes (application_id, user_id, currency, total_minor, lines, expires_at, kind, extension_id)
  values (p_campaign, p_user, 'USD', (v_p ->> 'total')::bigint,
          jsonb_build_array(jsonb_build_object('kind', 'extension', 'campaignId', p_campaign, 'durationDays', v_days, 'extraDays', v_extra,
            'list', (v_p ->> 'list_price')::bigint, 'discountPercent', (v_p ->> 'discount_percent')::numeric, 'total', (v_p ->> 'total')::bigint,
            'promotionId', v_p ->> 'promotion_id')),
          v_exp, 'extension', v_ext)
  returning id into v_q;
  return jsonb_build_object('ok', true, 'quoteId', v_q, 'extensionId', v_ext, 'expiresAt', v_exp, 'currency', 'USD',
    'total', (v_p ->> 'total')::bigint, 'list', (v_p ->> 'list_price')::bigint, 'discountPercent', (v_p ->> 'discount_percent')::numeric,
    'days', v_days, 'extraDays', v_extra, 'currentEndAt', c.end_at, 'newEndAt', c.end_at + make_interval(days => v_days + v_extra));
end;
$$;

-- applied by settle, inside its lock, exactly once per extension
create or replace function public.ad_apply_extension(p_reference text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e     record;
  c     record;
  v_new timestamptz;
begin
  select * into e from public.ad_campaign_extensions where payment_reference = p_reference for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_extension'); end if;
  if e.status = 'applied' then return jsonb_build_object('ok', true, 'already', true, 'new_end_at', e.new_end_at); end if;
  select * into c from public.ad_campaigns where id = e.campaign_id for update;
  if c.status in ('active', 'paused') and c.end_at is not null and c.end_at > now() then
    v_new := c.end_at + make_interval(days => e.days + e.extra_days);
    update public.ad_campaigns set end_at = v_new where id = c.id;
    update public.ad_campaign_extensions set status = 'applied', old_end_at = c.end_at, new_end_at = v_new, applied_at = now(), updated_at = now() where id = e.id;
    insert into public.ad_campaign_events (campaign_id, kind, actor_role, reason)
    values (c.id, 'extended', 'system', (e.days + e.extra_days)::text || ' days ' || p_reference);
    return jsonb_build_object('ok', true, 'campaign_id', c.id, 'new_end_at', v_new);
  end if;
  -- paid, but the campaign ended or was stopped in between: the money is real,
  -- so a person decides (refund or a renewal) — never silently lost or applied
  update public.ad_campaign_extensions set status = 'held', updated_at = now() where id = e.id;
  insert into public.ad_campaign_events (campaign_id, kind, actor_role, reason)
  values (c.id, 'extension_held', 'system', c.status || ' ' || p_reference);
  return jsonb_build_object('ok', false, 'reason', 'held', 'campaign_id', c.id);
end;
$$;

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

  -- 0198: an EXTENSION of a paid campaign (p_application = that campaign). The
  -- campaign keeps its id, payment record, slot and start; only the pending
  -- extension row and a new attempt are written here.
  if v_q.kind = 'extension' then
    perform 1 from public.ad_campaign_extensions where id = v_q.extension_id for update;
    if not exists (
      select 1 from public.ad_campaign_extensions e join public.ad_campaigns c on c.id = e.campaign_id
       where e.id = v_q.extension_id and e.campaign_id = p_application and e.user_id = p_user and e.status = 'pending'
         and c.status in ('active', 'paused') and c.payment_verified_at is not null and c.end_at > now()) then
      return jsonb_build_object('ok', false, 'reason', 'not_extendable');
    end if;
    select reference into v_open from public.ai_topup_attempts
     where purpose = 'ad_campaign' and item_id = p_application::text and status in ('pending', 'verification_required');
    if v_open is not null then return jsonb_build_object('ok', false, 'reason', 'payment_open', 'reference', v_open); end if;
    insert into public.ai_topup_attempts (reference, user_id, amount_cents, currency, status, provider, purpose, item_id,
                                          quote_id, provider_currency, provider_amount, fx_minor_per_usd, fx_at, metadata)
    values (p_reference, p_user, p_amount_usd, 'USD', 'pending', p_provider, 'ad_campaign', p_application::text,
            p_quote, p_provider_currency, p_provider_amount, p_fx, case when p_fx is null then null else now() end,
            coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('extension_id', v_q.extension_id));
    update public.ad_campaign_extensions set payment_reference = p_reference, updated_at = now() where id = v_q.extension_id;
    insert into public.ad_campaign_events (campaign_id, kind, actor_id, actor_role, reason)
    values (p_application, 'extension_payment_started', p_user, 'advertiser', p_provider || ' ' || p_reference);
    return jsonb_build_object('ok', true, 'reference', p_reference, 'extension', true);
  end if;

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
    if exists (select 1 from public.ad_payment_quotes where id = v_a.quote_id and kind = 'extension') then
      return jsonb_build_object('ok', true, 'already', true, 'extension', true);
    end if;
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

  -- 0198: an extension payment extends ITS campaign — once (the attempt above
  -- is already 'success', so a duplicate webhook returns 'already' before here)
  if exists (select 1 from public.ad_payment_quotes where id = v_a.quote_id and kind = 'extension') then
    return jsonb_build_object('ok', true, 'extension', public.ad_apply_extension(p_reference));
  end if;

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

-- ─────────────────────── 6 · the advertiser's own summaries (browser → Postgres) ───────────────────────
-- Owner-scoped by auth.uid(); aggregates only (daily stats, never raw events);
-- nothing about other advertisers, visitors, fraud signals or platform totals.
create or replace function public.ad_my_summary(p_from date default null) returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (
    select c.id, c.status from public.ad_campaigns c join public.advertisers a on a.id = c.advertiser_id
     where a.user_id = auth.uid() and c.status <> 'cancelled'
  ), stats as (
    select coalesce(sum(s.impressions), 0) as impressions, coalesce(sum(s.clicks), 0) as clicks,
           coalesce(sum(s.reward_completes), 0) as reward_completes, coalesce(sum(s.video_completes), 0) as video_completes
      from public.ad_campaign_daily_stats s where s.campaign_id in (select id from mine) and (p_from is null or s.day >= p_from)
  ), spend as (
    select coalesce(sum(t.amount_cents), 0) as usd_cents from public.ai_topup_attempts t
     where t.user_id = auth.uid() and t.purpose = 'ad_campaign' and t.status = 'success'
  )
  select jsonb_build_object(
    'total', (select count(*) from mine),
    'live', (select count(*) from mine where status = 'active'),
    'awaiting_payment', (select count(*) from mine where status in ('draft', 'awaiting_payment', 'payment_processing')),
    'validating', (select count(*) from mine where status in ('paid', 'validating')),
    'paused', (select count(*) from mine where status = 'paused'),
    'expired', (select count(*) from mine where status = 'expired'),
    'impressions', (select impressions from stats), 'clicks', (select clicks from stats),
    'reward_completes', (select reward_completes from stats), 'video_completes', (select video_completes from stats),
    'spend_usd_cents', (select usd_cents from spend));
$$;

create or replace function public.ad_my_payments(p_limit integer default 50, p_offset integer default 0) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb) from (
    select t.reference, t.provider, t.status, t.amount_cents as usd_cents, t.currency,
           t.provider_amount, t.provider_currency, t.paid_amount, t.paid_currency,
           t.created_at, t.verified_at, t.refunded_amount, t.refunded_at,
           q.kind, (q.lines -> 0 ->> 'promotionId') as promotion_id, (q.lines -> 0 ->> 'extraDays')::integer as bonus_days,
           coalesce(ce.campaign_id, (select c.id from public.ad_campaigns c where c.payment_reference = t.reference limit 1)) as campaign_id
      from public.ai_topup_attempts t
      left join public.ad_payment_quotes q on q.id = t.quote_id
      left join public.ad_campaign_extensions ce on ce.payment_reference = t.reference
     where t.user_id = auth.uid() and t.purpose = 'ad_campaign'
     order by t.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0)
  ) x;
$$;

-- ─────────────────────── grants ───────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.ad_swap_creative(uuid, uuid, uuid, integer)',
    'public.ad_edit_creative_details(uuid, uuid, integer, text, text, text)',
    'public.ad_advertiser_pause(uuid, uuid, boolean, integer)',
    'public.ad_price_for(uuid, uuid, text)',
    'public.ad_extension_quote(uuid, uuid, uuid)',
    'public.ad_apply_extension(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
  foreach fn in array array['public.ad_my_summary(date)', 'public.ad_my_payments(integer, integer)'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;
