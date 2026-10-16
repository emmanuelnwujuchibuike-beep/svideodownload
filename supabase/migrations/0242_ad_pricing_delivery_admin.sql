-- ═══════════════════════════════════════════════════════════════════════════
--  0242 — Advertising Pricing & Delivery: admin controls, escalation instead of
--         silent closure, audited interventions, delivery monitor (2026-10-12)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner brief "ADVERTISING SYSTEM UPGRADE, Part 3". On top of 0240/0241:
--
--   pricing     fixed_enabled (new fixed-period SALES only - running campaigns
--               are untouched), a minimum checkout amount, volume tiers
--               (a lower rate from a number of views up), a placement rate
--               still wins over a tier.
--   guarantee   the policies are SOLD with the campaign (price snapshot):
--               does an advertiser's own pause earn an extension, what a
--               suspension does (close with a refund, or hold for an admin),
--               and what happens when the extensions run out. The default
--               for the last is REVIEW: a promise is never closed silently -
--               the delivery waits in phase review for an admin, who extends
--               it or closes it with the undelivered share owed.
--   admin       ad_admin_resolve_delivery (extend / close with refund) and
--               ad_admin_adjust_delivery (a reason-coded correction of the
--               credited count, logged in ad_delivery_adjustments). Nothing
--               marks a campaign fulfilled except the credited count
--               reaching its target. Every action writes ad_campaign_events
--               with the admin as actor.
--   monitor     ad_admin_delivery_summary / _list / _detail and
--               ad_admin_capacity: indexed reads of the delivery table and
--               the daily counters - never the raw event table.
--
-- Runner rules: no semicolon inside any single-quoted string, plain DDL first,
-- dollar-quoted blocks last, triggers and grants inside DO blocks, idempotent.

alter table public.ad_platform_settings add column if not exists fixed_enabled boolean not null default true;
alter table public.ad_platform_settings add column if not exists views_min_checkout_minor integer not null default 0;
alter table public.ad_platform_settings add column if not exists views_volume_tiers jsonb not null default '[]'::jsonb;
alter table public.ad_platform_settings add column if not exists views_extend_when_advertiser_paused boolean not null default true;
alter table public.ad_platform_settings add column if not exists views_suspension_policy text not null default 'close_refund';
alter table public.ad_platform_settings add column if not exists views_on_exhausted text not null default 'review';
alter table public.ad_platform_settings add column if not exists views_review_after_extensions integer not null default 0;
alter table public.ad_platform_settings drop constraint if exists ad_platform_settings_views2_chk;
alter table public.ad_platform_settings add constraint ad_platform_settings_views2_chk check (
  views_min_checkout_minor between 0 and 100000000
  and jsonb_typeof(views_volume_tiers) = 'array'
  and views_suspension_policy in ('close_refund', 'hold_review')
  and views_on_exhausted in ('review', 'close_refund')
  and views_review_after_extensions between 0 and 52);
-- at least one way to buy must stay on sale
alter table public.ad_platform_settings drop constraint if exists ad_platform_settings_models_chk;
alter table public.ad_platform_settings add constraint ad_platform_settings_models_chk check (fixed_enabled or views_enabled);

comment on column public.ad_platform_settings.fixed_enabled is '0242: fixed-period campaigns on sale. Off stops NEW sales only - running campaigns and their extensions are untouched.';
comment on column public.ad_platform_settings.views_volume_tiers is '0242: [{"min_views": n, "rate_per_1000_minor": c}] - from n views up the rate is c (a placement rate still wins).';
comment on column public.ad_platform_settings.views_on_exhausted is '0242: when the free extensions run out - review (an admin decides, the default) or close_refund.';

-- review: the extensions ran out (or a suspension is held) and an admin decides
alter table public.ad_campaign_delivery drop constraint if exists ad_campaign_delivery_phase_chk;
alter table public.ad_campaign_delivery add constraint ad_campaign_delivery_phase_chk check (phase in ('initial', 'extended', 'review', 'fulfilled', 'shortfall'));
alter table public.ad_campaign_delivery add column if not exists escalated_at timestamptz;
alter table public.ad_campaign_delivery add column if not exists last_credit_at timestamptz;
alter table public.ad_campaign_delivery add column if not exists admin_extra_days integer not null default 0;
create index if not exists ad_campaign_delivery_phase_idx on public.ad_campaign_delivery (phase, updated_at desc);

create table if not exists public.ad_delivery_adjustments (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.ad_campaigns (id) on delete cascade,
  admin_id     uuid references auth.users (id) on delete set null,
  delta        integer not null,
  reason_code  text not null,
  note         text not null,
  before_views integer not null,
  after_views  integer not null,
  created_at   timestamptz not null default now(),
  constraint ad_delivery_adjustments_reason_chk check (reason_code in ('invalid_traffic_removed', 'verified_dispute_credit', 'processing_error_correction')),
  constraint ad_delivery_adjustments_delta_chk check (delta <> 0),
  constraint ad_delivery_adjustments_note_chk check (length(btrim(note)) between 5 and 500)
);
create index if not exists ad_delivery_adjustments_campaign_idx on public.ad_delivery_adjustments (campaign_id, created_at desc);
alter table public.ad_delivery_adjustments enable row level security;
revoke insert, update, delete, truncate on public.ad_delivery_adjustments from anon, authenticated;
drop policy if exists "ad delivery adjustments admin" on public.ad_delivery_adjustments;
create policy "ad delivery adjustments admin" on public.ad_delivery_adjustments for select using ((select public.is_admin()));
comment on table public.ad_delivery_adjustments is '0242: every manual correction of a credited views count - who, why (a reason code and a note), before and after. Admin-read, written only by ad_admin_adjust_delivery.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── the rate for a target: the placement's own, else the best volume tier reached, else the default ──
create or replace function public.ad_views_rate(p_placement uuid, p_target integer) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.views_rate_per_1000_minor from public.ad_placements p where p.id = p_placement),
    (select min((t ->> 'rate_per_1000_minor')::integer)
       from public.ad_platform_settings s, jsonb_array_elements(s.views_volume_tiers) t
      where s.id and (t ->> 'min_views')::integer <= p_target),
    (select s.views_rate_per_1000_minor from public.ad_platform_settings s where s.id));
$$;

-- ── the views price (0240's, three changes: the tier rate, the minimum checkout, and the delivery policies sold with it) ──
create or replace function public.ad_views_price_for(p_placement uuid, p_duration uuid, p_target integer, p_currency text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s             public.ad_platform_settings%rowtype;
  v_pl_enabled  boolean;
  v_pl_views    boolean;
  v_fmt_enabled boolean;
  v_rate        integer;
  v_days        integer;
  v_d_enabled   boolean;
  v_d_views     boolean;
  v_total       bigint;
  v_cap         jsonb;
begin
  select * into s from public.ad_platform_settings where id;
  if not coalesce(s.views_enabled, false) then return jsonb_build_object('ok', false, 'reason', 'views_pricing_disabled'); end if;
  if p_currency is distinct from 'USD' then return jsonb_build_object('ok', false, 'reason', 'currency_unsupported'); end if;
  select p.enabled, p.views_enabled, f.enabled into v_pl_enabled, v_pl_views, v_fmt_enabled
    from public.ad_placements p join public.ad_formats f on f.code = p.format_code where p.id = p_placement;
  if not coalesce(v_pl_enabled, false) then return jsonb_build_object('ok', false, 'reason', 'placement_disabled'); end if;
  if not coalesce(v_fmt_enabled, false) then return jsonb_build_object('ok', false, 'reason', 'format_disabled'); end if;
  if not coalesce(v_pl_views, false) then return jsonb_build_object('ok', false, 'reason', 'views_not_offered'); end if;
  select duration_days, enabled, views_enabled into v_days, v_d_enabled, v_d_views from public.ad_durations where id = p_duration;
  if not coalesce(v_d_enabled, false) or not coalesce(v_d_views, false) then return jsonb_build_object('ok', false, 'reason', 'duration_disabled'); end if;
  if p_target is null or p_target < s.views_min_target then return jsonb_build_object('ok', false, 'reason', 'target_too_small', 'min', s.views_min_target); end if;
  if p_target > s.views_max_target then return jsonb_build_object('ok', false, 'reason', 'target_too_large', 'max', s.views_max_target); end if;
  if p_target % s.views_target_step <> 0 then return jsonb_build_object('ok', false, 'reason', 'target_step', 'step', s.views_target_step); end if;
  v_rate := public.ad_views_rate(p_placement, p_target);
  -- integer money only: cents per 1,000 views x views / 1,000, rounded DOWN to the cent
  v_total := (p_target::bigint * v_rate) / 1000;
  if v_total <= 0 then return jsonb_build_object('ok', false, 'reason', 'no_price'); end if;
  if v_total < s.views_min_checkout_minor then return jsonb_build_object('ok', false, 'reason', 'below_min_checkout', 'min_minor', s.views_min_checkout_minor); end if;
  v_cap := public.ad_views_capacity(p_placement, p_target, v_days);
  if v_cap ->> 'decision' = 'refuse' then return jsonb_build_object('ok', false, 'reason', 'over_capacity', 'capacity', v_cap); end if;
  return jsonb_build_object(
    'ok', true, 'pricing_model', 'views_based', 'currency', p_currency,
    'list_price', v_total, 'discount_percent', 0, 'total', v_total,
    'duration_days', v_days, 'extra_days', 0, 'pricing_plan_id', null, 'promotion_id', null, 'quoted_at', now(),
    'target_views', p_target, 'rate_per_1000_minor', v_rate,
    'terms', jsonb_build_object('auto_extend', s.views_auto_extend, 'extension_days', s.views_extension_days,
                                'max_extensions', s.views_max_extensions, 'extension_fee_minor', 0,
                                'extend_when_advertiser_paused', s.views_extend_when_advertiser_paused,
                                'suspension_policy', s.views_suspension_policy, 'on_exhausted', s.views_on_exhausted),
    'capacity', v_cap);
end;
$$;

-- ── the one quote entry point (0240's, one change: fixed-period sales can be switched off) ──
create or replace function public.ad_campaign_quote(p_campaign uuid, p_currency text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_placement uuid;
  v_duration  uuid;
  v_model     text;
  v_target    integer;
begin
  select c.placement_id, c.duration_id, c.pricing_model, c.target_views into v_placement, v_duration, v_model, v_target
    from public.ad_campaigns c where c.id = p_campaign;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_model = 'views_based' then return public.ad_views_price_for(v_placement, v_duration, v_target, p_currency); end if;
  -- new sales only: an extension of a running campaign goes through ad_extension_quote, untouched
  if not coalesce((select fixed_enabled from public.ad_platform_settings where id), true) then
    return jsonb_build_object('ok', false, 'reason', 'fixed_pricing_disabled');
  end if;
  return public.ad_price_for(v_placement, v_duration, p_currency);
end;
$$;

-- ── one qualifying view (0240's, one change: the time of the last credit, for the monitor) ──
create or replace function public.ad_views_credit(p_campaign uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_done   integer;
  v_target integer;
begin
  update public.ad_campaign_delivery
     set delivered_views = delivered_views + 1, updated_at = now(), last_credit_at = now()
   where campaign_id = p_campaign and phase in ('initial', 'extended') and delivered_views < target_views
  returning delivered_views, target_views into v_done, v_target;
  if not found then return false; end if;
  if v_done >= v_target then perform public.ad_views_fulfil(p_campaign); end if;
  return true;
end;
$$;

-- ── one campaign at its deadline (0240's, with the policies SOLD with it) ──
--    · an advertiser's own pause earns an extension only if the terms say so
--    · a suspension closes with a refund, or is held for an admin (terms)
--    · extensions run out: REVIEW by default - an admin extends or closes it.
--      A promise is never closed silently.
create or replace function public.ad_views_deadline(p_campaign uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d        public.ad_campaign_delivery%rowtype;
  c        public.ad_campaigns%rowtype;
  s        public.ad_platform_settings%rowtype;
  v_terms  jsonb;
  v_adv    text;
  v_why    text;
  v_end    timestamptz;
  v_short  integer;
  v_owed   bigint;
  v_hold   boolean;
begin
  select * into d from public.ad_campaign_delivery where campaign_id = p_campaign for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_views'); end if;
  if d.phase not in ('initial', 'extended') then return jsonb_build_object('ok', true, 'action', 'closed'); end if;
  select * into c from public.ad_campaigns where id = p_campaign for update;
  if c.end_at is null or c.end_at > now() then return jsonb_build_object('ok', true, 'action', 'not_due'); end if;
  if d.delivered_views >= d.target_views then
    perform public.ad_views_fulfil(p_campaign);
    return jsonb_build_object('ok', true, 'action', 'fulfilled');
  end if;
  if c.status not in ('active', 'paused') then return jsonb_build_object('ok', true, 'action', 'not_running', 'status', c.status); end if;

  select * into s from public.ad_platform_settings where id;
  v_terms := coalesce(c.price_snapshot -> 'terms', '{}'::jsonb);
  select status into v_adv from public.advertisers where id = c.advertiser_id;
  v_why := case
    when not d.auto_extend then 'auto_extend_off'
    when v_adv is distinct from 'active' then 'advertiser_not_active'
    when c.status = 'paused' and c.status_reason is distinct from 'advertiser_paused' then 'suspended'
    when c.status = 'paused' and not coalesce((v_terms ->> 'extend_when_advertiser_paused')::boolean, s.views_extend_when_advertiser_paused) then 'advertiser_paused'
    when not exists (select 1 from public.ad_creatives cr
                      where cr.campaign_id = c.id and cr.status = 'active' and cr.validation_status = 'valid'
                        and cr.url_validation_status <> 'blocked') then 'creative_not_valid'
    when d.extensions_used >= d.max_extensions then 'extensions_exhausted'
    else null
  end;

  if v_why is null then
    v_end := greatest(c.end_at, now()) + make_interval(days => d.extension_days);
    update public.ad_campaigns set end_at = v_end where id = p_campaign;
    update public.ad_campaign_delivery
       set phase = 'extended', extensions_used = extensions_used + 1, updated_at = now()
     where campaign_id = p_campaign;
    insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_role, reason)
    values (p_campaign, 'delivery_extended', c.status, c.status, 'system',
            (d.target_views - d.delivered_views)::text || ' views remaining, extension ' || (d.extensions_used + 1)::text);
    return jsonb_build_object('ok', true, 'action', 'extended', 'end_at', v_end, 'remaining', d.target_views - d.delivered_views);
  end if;

  -- held for a person: the extensions ran out (default), or a suspension under the hold policy
  v_hold := (v_why = 'extensions_exhausted' and coalesce(v_terms ->> 'on_exhausted', s.views_on_exhausted) = 'review')
         or (v_why in ('suspended', 'advertiser_not_active', 'creative_not_valid') and coalesce(v_terms ->> 'suspension_policy', s.views_suspension_policy) = 'hold_review');
  if v_hold then
    update public.ad_campaign_delivery
       set phase = 'review', escalated_at = now(), close_reason = v_why, updated_at = now()
     where campaign_id = p_campaign;
    insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_role, reason)
    values (p_campaign, 'delivery_review', c.status, c.status, 'system', v_why || ', ' || (d.target_views - d.delivered_views)::text || ' views short')
    ;
    return jsonb_build_object('ok', true, 'action', 'review', 'reason', v_why);
  end if;

  -- closed short, and the undelivered share is owed back (an admin pays or waives it, Part 7)
  v_short := d.target_views - d.delivered_views;
  v_owed := case when c.refund_status = 'none' and coalesce(c.total_amount_minor, 0) > 0
                 then floor(c.total_amount_minor::numeric * v_short / d.target_views)::bigint else 0 end;
  update public.ad_campaign_delivery
     set phase = 'shortfall', shortfall_views = v_short, closed_at = now(), close_reason = v_why, updated_at = now()
   where campaign_id = p_campaign;
  update public.ad_campaigns
     set status = 'expired', status_reason = 'delivery_' || v_why,
         refund_status = case when v_owed > 0 then 'owed' else refund_status end,
         refund_owed_minor = case when v_owed > 0 then v_owed else refund_owed_minor end
   where id = p_campaign;
  insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_role, reason)
  values (p_campaign, 'delivery_shortfall', c.status, 'expired', 'system', v_why || ', ' || v_short::text || ' views short');
  return jsonb_build_object('ok', true, 'action', 'shortfall', 'reason', v_why, 'shortfall', v_short, 'owed', v_owed);
end;
$$;

-- ── an admin resolves a delivery: extend it (from review, or any open one), or close it with the undelivered share owed ──
create or replace function public.ad_admin_resolve_delivery(p_campaign uuid, p_admin uuid, p_action text, p_days integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d       public.ad_campaign_delivery%rowtype;
  c       public.ad_campaigns%rowtype;
  v_end   timestamptz;
  v_short integer;
  v_owed  bigint;
begin
  if p_action not in ('extend', 'close_refund') then return jsonb_build_object('ok', false, 'reason', 'bad_action'); end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then return jsonb_build_object('ok', false, 'reason', 'reason_required'); end if;
  select * into d from public.ad_campaign_delivery where campaign_id = p_campaign for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_views'); end if;
  if d.phase not in ('initial', 'extended', 'review') then return jsonb_build_object('ok', false, 'reason', 'closed', 'phase', d.phase); end if;
  select * into c from public.ad_campaigns where id = p_campaign for update;

  if p_action = 'extend' then
    if p_days is null or p_days < 1 or p_days > 90 then return jsonb_build_object('ok', false, 'reason', 'bad_days'); end if;
    if c.status not in ('active', 'paused') then return jsonb_build_object('ok', false, 'reason', 'not_running', 'status', c.status); end if;
    v_end := greatest(coalesce(c.end_at, now()), now()) + make_interval(days => p_days);
    update public.ad_campaigns set end_at = v_end where id = p_campaign;
    update public.ad_campaign_delivery
       set phase = 'extended', admin_extra_days = admin_extra_days + p_days, escalated_at = null, close_reason = null, updated_at = now()
     where campaign_id = p_campaign;
    insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role, reason)
    values (p_campaign, 'delivery_admin_extended', c.status, c.status, p_admin, 'admin', p_days::text || ' days: ' || left(btrim(p_reason), 280));
    return jsonb_build_object('ok', true, 'action', 'extended', 'end_at', v_end);
  end if;

  v_short := d.target_views - d.delivered_views;
  v_owed := case when c.refund_status = 'none' and coalesce(c.total_amount_minor, 0) > 0
                 then floor(c.total_amount_minor::numeric * v_short / d.target_views)::bigint else 0 end;
  update public.ad_campaign_delivery
     set phase = 'shortfall', shortfall_views = v_short, closed_at = now(), close_reason = 'admin_closed', updated_at = now()
   where campaign_id = p_campaign;
  update public.ad_campaigns
     set status = case when status in ('active', 'paused') then 'expired' else status end,
         status_reason = 'delivery_admin_closed',
         refund_status = case when v_owed > 0 then 'owed' else refund_status end,
         refund_owed_minor = case when v_owed > 0 then v_owed else refund_owed_minor end
   where id = p_campaign;
  insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role, reason)
  values (p_campaign, 'delivery_admin_closed', c.status, 'expired', p_admin, 'admin', v_short::text || ' views short: ' || left(btrim(p_reason), 280));
  return jsonb_build_object('ok', true, 'action', 'closed', 'shortfall', v_short, 'owed', v_owed);
end;
$$;

-- ── a reason-coded correction of the credited count (never a free edit; never past the target or below zero) ──
create or replace function public.ad_admin_adjust_delivery(p_campaign uuid, p_admin uuid, p_delta integer, p_reason_code text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d       public.ad_campaign_delivery%rowtype;
  v_after integer;
begin
  if p_delta is null or p_delta = 0 then return jsonb_build_object('ok', false, 'reason', 'bad_delta'); end if;
  if p_reason_code not in ('invalid_traffic_removed', 'verified_dispute_credit', 'processing_error_correction') then return jsonb_build_object('ok', false, 'reason', 'bad_reason'); end if;
  -- removing invalid traffic can only lower the count, a dispute credit can only raise it
  if (p_reason_code = 'invalid_traffic_removed' and p_delta > 0) or (p_reason_code = 'verified_dispute_credit' and p_delta < 0) then
    return jsonb_build_object('ok', false, 'reason', 'delta_contradicts_reason');
  end if;
  if p_note is null or length(btrim(p_note)) < 5 then return jsonb_build_object('ok', false, 'reason', 'reason_required'); end if;
  select * into d from public.ad_campaign_delivery where campaign_id = p_campaign for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_views'); end if;
  if d.phase not in ('initial', 'extended', 'review') then return jsonb_build_object('ok', false, 'reason', 'closed', 'phase', d.phase); end if;
  v_after := d.delivered_views + p_delta;
  if v_after < 0 or v_after > d.target_views then return jsonb_build_object('ok', false, 'reason', 'out_of_range', 'delivered', d.delivered_views, 'target', d.target_views); end if;
  update public.ad_campaign_delivery set delivered_views = v_after, updated_at = now() where campaign_id = p_campaign;
  insert into public.ad_delivery_adjustments (campaign_id, admin_id, delta, reason_code, note, before_views, after_views)
  values (p_campaign, p_admin, p_delta, p_reason_code, left(btrim(p_note), 500), d.delivered_views, v_after);
  insert into public.ad_campaign_events (campaign_id, kind, actor_id, actor_role, reason)
  values (p_campaign, 'delivery_adjusted', p_admin, 'admin', p_reason_code || ' ' || p_delta::text || ': ' || left(btrim(p_note), 240));
  -- the only way to fulfilment stays the count reaching the target
  if v_after >= d.target_views then perform public.ad_views_fulfil(p_campaign); end if;
  return jsonb_build_object('ok', true, 'before', d.delivered_views, 'after', v_after);
end;
$$;

-- ── monitor: the cards (one pass over the delivery table + an indexed day range of the counters) ──
create or replace function public.ad_admin_delivery_summary(p_from date, p_to date, p_soon_hours integer) returns jsonb
language sql stable security definer set search_path = public as $$
  with d as (
    select d.*, c.status, c.end_at, c.placement_id from public.ad_campaign_delivery d join public.ad_campaigns c on c.id = d.campaign_id
  ), s as (select * from public.ad_platform_settings where id)
  select jsonb_build_object(
    'active', (select count(*) from d where phase in ('initial', 'extended', 'review') and status in ('active', 'paused')),
    'initial', (select count(*) from d where phase = 'initial'),
    'extended', (select count(*) from d where phase = 'extended'),
    'review', (select count(*) from d where phase = 'review'),
    'outstanding_views', (select coalesce(sum(target_views - delivered_views), 0) from d where phase in ('initial', 'extended', 'review')),
    'fulfilled', (select count(*) from d where phase = 'fulfilled'),
    'shortfall', (select count(*) from d where phase = 'shortfall'),
    'deadline_soon', (select count(*) from d where phase = 'initial' and end_at > now() and end_at <= now() + make_interval(hours => greatest(1, least(coalesce(p_soon_hours, 48), 336)))),
    'overdue', (select count(*) from d where phase in ('extended', 'review')),
    'needs_attention', (select count(*) from d, s where phase = 'review'
                          or (phase = 'extended' and s.views_review_after_extensions > 0 and extensions_used >= s.views_review_after_extensions)),
    'low_delivery', (select count(*) from d where phase in ('initial', 'extended') and status = 'active'
                       and coalesce(last_credit_at, created_at) < now() - interval '24 hours'),
    'views_in_period', (select coalesce(sum(st.impressions), 0) from public.ad_campaign_daily_stats st
                         join public.ad_campaigns c on c.id = st.campaign_id
                        where c.pricing_model = 'views_based' and st.day between coalesce(p_from, current_date - 7) and coalesce(p_to, current_date)),
    'at', now());
$$;

-- ── monitor: one page of campaigns, filtered in the database ──
create or replace function public.ad_admin_delivery_list(p_filters jsonb, p_limit integer, p_offset integer) returns jsonb
language sql stable security definer set search_path = public as $$
  with f as (select coalesce(p_filters, '{}'::jsonb) as j), base as (
    select c.id, c.name, c.status, c.status_reason, c.pricing_model, c.target_views, c.total_amount_minor, c.currency,
           c.created_at, c.start_at, c.end_at, c.payment_verified_at, c.version,
           p.code as placement_code, p.name as placement_name, a.id as advertiser_id, a.business_name,
           d.phase, d.delivered_views, d.initial_end_at, d.extensions_used, d.max_extensions, d.admin_extra_days,
           d.last_credit_at, d.escalated_at, d.close_reason,
           case when d.target_views > 0 then d.delivered_views::numeric / d.target_views else null end as progress
      from public.ad_campaigns c
      join public.ad_placements p on p.id = c.placement_id
      join public.advertisers a on a.id = c.advertiser_id
      left join public.ad_campaign_delivery d on d.campaign_id = c.id, f
     where c.payment_verified_at is not null
       and (f.j ->> 'model' is null or c.pricing_model = f.j ->> 'model')
       and (f.j ->> 'status' is null or c.status = f.j ->> 'status')
       and (f.j ->> 'phase' is null or d.phase = f.j ->> 'phase')
       and (f.j ->> 'placement' is null or p.code = f.j ->> 'placement')
       and (f.j ->> 'advertiser' is null or a.business_name ilike '%' || (f.j ->> 'advertiser') || '%')
       and (f.j ->> 'created_from' is null or c.created_at >= (f.j ->> 'created_from')::timestamptz)
       and (f.j ->> 'created_to' is null or c.created_at < (f.j ->> 'created_to')::timestamptz)
       and (f.j ->> 'deadline_before' is null or d.initial_end_at < (f.j ->> 'deadline_before')::timestamptz)
       and (f.j ->> 'progress_below' is null or (d.target_views > 0 and d.delivered_views::numeric / d.target_views < (f.j ->> 'progress_below')::numeric))
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'rows', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at desc)
                        from (select * from base order by created_at desc
                               limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0))) b), '[]'::jsonb));
$$;

-- ── one campaign: its delivery, the last credit, 14 days of counters, adjustments and recent audit ──
create or replace function public.ad_admin_delivery_detail(p_campaign uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'delivery', (select to_jsonb(d) from public.ad_campaign_delivery d where d.campaign_id = p_campaign),
    'creatives', coalesce((select jsonb_agg(jsonb_build_object('id', cr.id, 'status', cr.status, 'validation', cr.validation_status,
                                                               'link', cr.url_validation_status, 'moderation', cr.moderation_status))
                             from public.ad_creatives cr where cr.campaign_id = p_campaign and cr.status <> 'removed'), '[]'::jsonb),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', x.day, 'views', x.v, 'filtered', x.bad) order by x.day desc)
                        from (select st.day, sum(st.impressions) as v, sum(st.invalid_impressions) as bad
                                from public.ad_campaign_daily_stats st
                               where st.campaign_id = p_campaign and st.day >= current_date - 14
                               group by st.day) x), '[]'::jsonb),
    'adjustments', coalesce((select jsonb_agg(to_jsonb(j) order by j.created_at desc)
                               from (select * from public.ad_delivery_adjustments where campaign_id = p_campaign order by created_at desc limit 20) j), '[]'::jsonb),
    'open_flags', (select count(*) from public.ad_risk_flags rf where rf.campaign_id = p_campaign and rf.status = 'open'),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc)
                          from (select kind, from_status, to_status, actor_role, reason, created_at
                                  from public.ad_campaign_events where campaign_id = p_campaign order by created_at desc limit 30) e), '[]'::jsonb));
$$;

-- ── capacity and health per placement: measured figures and labelled estimates ──
create or replace function public.ad_admin_capacity() returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (select * from public.ad_platform_settings where id),
  win as (select (now() at time zone 'utc')::date - (select views_capacity_window_days from s) as d0, (now() at time zone 'utc')::date as d1),
  supply as (
    select st.placement_code, count(distinct st.day) as days_seen, sum(st.impressions) as views,
           sum(st.impressions) filter (where c.pricing_model = 'views_based') as guaranteed_views
      from public.ad_campaign_daily_stats st join public.ad_campaigns c on c.id = st.campaign_id, win
     where st.day >= win.d0 and st.day < win.d1
     group by st.placement_code
  ),
  open_d as (
    select p.code, count(*) as open_n, sum(d.target_views - d.delivered_views) as outstanding,
           count(*) filter (where d.phase in ('extended', 'review')) as late_n
      from public.ad_campaign_delivery d join public.ad_campaigns c on c.id = d.campaign_id join public.ad_placements p on p.id = c.placement_id
     where d.phase in ('initial', 'extended', 'review')
     group by p.code
  ),
  closed_d as (
    select count(*) filter (where phase = 'fulfilled') as fulfilled_n,
           count(*) filter (where phase = 'shortfall') as short_n,
           count(*) filter (where phase in ('fulfilled', 'shortfall') and extensions_used > 0) as extended_n,
           avg(extract(epoch from (coalesce(fulfilled_at, closed_at) - initial_end_at)) / 86400.0)
             filter (where phase in ('fulfilled', 'shortfall') and extensions_used > 0) as avg_ext_days
      from public.ad_campaign_delivery
  )
  select jsonb_build_object(
    'window_days', (select views_capacity_window_days from s),
    'placements', coalesce((select jsonb_agg(jsonb_build_object(
        'code', p.code, 'name', p.name,
        'daily_views', case when coalesce(sp.days_seen, 0) > 0 then round(sp.views::numeric / sp.days_seen) end,
        'history_days', coalesce(sp.days_seen, 0),
        'guaranteed_share', case when coalesce(sp.views, 0) > 0 then round(coalesce(sp.guaranteed_views, 0)::numeric / sp.views, 3) end,
        'open_campaigns', coalesce(o.open_n, 0),
        'outstanding_views', coalesce(o.outstanding, 0),
        'late_campaigns', coalesce(o.late_n, 0),
        'estimated_days', case when coalesce(sp.days_seen, 0) > 0 and sp.views > 0 and coalesce(o.outstanding, 0) > 0
                               then ceil(o.outstanding / (sp.views::numeric / sp.days_seen)) end) order by p.sort_order)
      from public.ad_placements p
      left join supply sp on sp.placement_code = p.code
      left join open_d o on o.code = p.code
     where p.enabled), '[]'::jsonb),
    'completion_rate', (select case when fulfilled_n + short_n > 0 then round(fulfilled_n::numeric / (fulfilled_n + short_n), 3) end from closed_d),
    'extension_rate', (select case when fulfilled_n + short_n > 0 then round(extended_n::numeric / (fulfilled_n + short_n), 3) end from closed_d),
    'avg_extension_days', (select round(avg_ext_days::numeric, 1) from closed_d),
    'closed_campaigns', (select fulfilled_n + short_n from closed_d),
    'at', now());
$$;

-- ── activation (0240's), one change: a delivery held for review waits for the admin ──
create or replace function public.activate_ad_campaign(p_campaign uuid, p_actor uuid, p_actor_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c            public.ad_campaigns%rowtype;
  v_adv        text;
  v_pl_enabled boolean;
  v_fmt_code   text;
  v_fmt_on     boolean;
  v_slots      integer;
  v_slot       integer;
  v_flags      text[] := '{}'::text[];
  v_start      timestamptz;
  v_end        timestamptz;
  v_count      integer;
  v_first      boolean;
begin
  if p_actor_role not in ('system', 'admin') then return jsonb_build_object('ok', false, 'reason', 'not_permitted'); end if;
  select * into c from public.ad_campaigns where id = p_campaign for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if c.status = 'active' then return jsonb_build_object('ok', true, 'already_active', true); end if;
  if c.status not in ('paid', 'validating', 'paused') then return jsonb_build_object('ok', false, 'reason', 'bad_status', 'status', c.status); end if;
  if c.payment_verified_at is null then return jsonb_build_object('ok', false, 'reason', 'payment_unverified'); end if;
  v_first := c.status in ('paid', 'validating');

  select status into v_adv from public.advertisers where id = c.advertiser_id;
  if v_adv is distinct from 'active' then v_flags := v_flags || 'advertiser_not_active'::text; end if;

  select p.enabled, p.format_code, f.enabled, coalesce(f.slot_count, s.default_slot_count)
    into v_pl_enabled, v_fmt_code, v_fmt_on, v_slots
    from public.ad_placements p
    join public.ad_formats f on f.code = p.format_code
    cross join public.ad_platform_settings s
   where p.id = c.placement_id;
  if not coalesce(v_pl_enabled, false) then v_flags := v_flags || 'placement_disabled'::text; end if;
  if not coalesce(v_fmt_on, false) then v_flags := v_flags || 'format_disabled'::text; end if;

  select count(*) into v_count from public.ad_creatives where campaign_id = p_campaign and status = 'active';
  if v_count = 0 then v_flags := v_flags || 'no_creative'::text; end if;
  if exists (select 1 from public.ad_creatives where campaign_id = p_campaign and status = 'active' and format_code <> v_fmt_code) then
    v_flags := v_flags || 'format_mismatch'::text;
  end if;
  if exists (select 1 from public.ad_creatives where campaign_id = p_campaign and status = 'active' and validation_status = 'pending') then
    v_flags := v_flags || 'validation_pending'::text;
  end if;
  if exists (select 1 from public.ad_creatives where campaign_id = p_campaign and status = 'active' and validation_status in ('invalid', 'blocked')) then
    v_flags := v_flags || 'creative_invalid'::text;
  end if;
  if exists (select 1 from public.ad_creatives where campaign_id = p_campaign and status = 'active' and url_validation_status = 'blocked') then
    v_flags := v_flags || 'destination_not_valid'::text;
  end if;
  -- 0210: a safety 'review' no longer holds activation (owner: go live automatically) - it stays in the admin queue
  -- 0240: a views target the capacity check sent to a person waits for an admin (an admin's own activation is the approval)
  if v_first and p_actor_role = 'system' and c.pricing_model = 'views_based'
     and (c.price_snapshot -> 'capacity' ->> 'decision') = 'review' then
    v_flags := v_flags || 'capacity_review'::text;
  end if;

  -- 0242: a delivery held for an admin is never resumed or expired here - the admin resolves it
  if c.pricing_model = 'views_based' and exists (select 1 from public.ad_campaign_delivery where campaign_id = p_campaign and phase = 'review') then
    return jsonb_build_object('ok', false, 'reason', 'delivery_review');
  end if;

  -- 0240: a views campaign resumed after its deadline is extended, fulfilled or closed by the delivery rule first
  if not v_first and c.pricing_model = 'views_based' and c.end_at is not null and c.end_at <= now() then
    perform public.ad_views_deadline(p_campaign);
    select * into c from public.ad_campaigns where id = p_campaign;
    if c.status not in ('active', 'paused') then return jsonb_build_object('ok', false, 'reason', c.status); end if;
  end if;

  if not v_first and c.end_at is not null and c.end_at <= now() then
    update public.ad_campaigns set status = 'expired' where id = p_campaign;
    insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role)
    values (p_campaign, 'campaign_expired', c.status, 'expired', p_actor, p_actor_role);
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if cardinality(v_flags) = 0 and v_first then
    -- a free slot: one that is open, or whose holder is no longer live
    perform pg_advisory_xact_lock(hashtext('ad-slots:' || c.placement_id::text));
    select n into v_slot
      from generate_series(1, v_slots) n
     where not exists (
       select 1 from public.ad_slots sl
         join public.ad_campaigns o on o.id = sl.campaign_id
        where sl.placement_id = c.placement_id and sl.slot_number = n and o.id <> p_campaign
          and o.status in ('paid', 'validating', 'active', 'paused')
          and (o.end_at is null or o.end_at > now()))
       and not exists (
       select 1 from public.ad_slots sl
        where sl.placement_id = c.placement_id and sl.slot_number = n and sl.status = 'disabled')
     order by n
     limit 1;
    if v_slot is null then v_flags := v_flags || 'placement_full'::text; end if;
  end if;

  if cardinality(v_flags) > 0 then
    -- 0204: a PAUSED campaign that fails a check stays paused with its reasons.
    -- 0195 moved it to validating, and the next activation then treated it as
    -- new - a second slot and fresh dates. Only a first activation waits in validating.
    if v_first and c.status <> 'validating' then
      update public.ad_campaigns set status = 'validating', review_flags = v_flags where id = p_campaign;
    else
      update public.ad_campaigns set review_flags = v_flags where id = p_campaign;
    end if;
    insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role, reason)
    values (p_campaign, 'flagged', c.status, case when v_first then 'validating' else c.status end, p_actor, p_actor_role, array_to_string(v_flags, ','));
    return jsonb_build_object('ok', false, 'reason', 'flagged', 'flags', to_jsonb(v_flags));
  end if;

  if v_first then
    insert into public.ad_slots (placement_id, slot_number, campaign_id, status)
    values (c.placement_id, v_slot, p_campaign, 'assigned')
    on conflict (placement_id, slot_number) do update set campaign_id = excluded.campaign_id, status = 'assigned', updated_at = now();
    -- auto_start: live the moment it is valid. Otherwise at its scheduled start, never in the past.
    v_start := case when c.auto_start or c.start_at is null then now() else greatest(now(), c.start_at) end;
    v_end := v_start + make_interval(days => coalesce(c.duration_days, 0) + coalesce(c.extra_days, 0));
    update public.ad_campaigns
       set status = 'active', start_at = v_start, end_at = v_end, activated_at = now(), review_flags = '{}'::text[],
           started_at = case when v_start <= now() then now() end
     where id = p_campaign;
  else
    update public.ad_campaigns set status = 'active', review_flags = '{}'::text[] where id = p_campaign;
  end if;
  insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role)
  values (p_campaign, case when v_first then 'activated' else 'resumed' end, c.status, 'active', p_actor, p_actor_role);
  if v_first and v_start <= now() then
    insert into public.ad_campaign_events (campaign_id, kind, to_status, actor_role) values (p_campaign, 'campaign_started', 'active', 'system');
  end if;
  return jsonb_build_object('ok', true, 'slot', v_slot, 'start_at', coalesce(v_start, c.start_at), 'end_at', coalesce(v_end, c.end_at));
end;
$$;

-- ── the public menu (0240's), one change: fixed sales on/off, the minimum checkout and the volume tiers ──
create or replace function public.ad_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'v', 1,
    'settings', (select jsonb_build_object(
        'ads_enabled', s.ads_enabled, 'applications_open', s.applications_open,
        'multi_placement_enabled', s.multi_placement_enabled,
        'max_placements_per_application', s.max_placements_per_application,
        'display_currency', s.display_currency, 'default_slot_count', s.default_slot_count,
        'views_enabled', s.views_enabled, 'views_rate_per_1000_minor', s.views_rate_per_1000_minor,
        'views_min_target', s.views_min_target, 'views_max_target', s.views_max_target, 'views_target_step', s.views_target_step,
        'views_auto_extend', s.views_auto_extend, 'views_extension_days', s.views_extension_days, 'views_max_extensions', s.views_max_extensions,
        'fixed_enabled', s.fixed_enabled, 'views_min_checkout_minor', s.views_min_checkout_minor, 'views_volume_tiers', s.views_volume_tiers)
      from public.ad_platform_settings s where s.id),
    'formats', coalesce((select jsonb_agg(jsonb_build_object(
        'code', f.code, 'name', f.name, 'description', f.description, 'recommendation', f.recommendation,
        'media_types', f.media_types, 'width', f.width, 'height', f.height,
        'rotation_seconds', f.rotation_seconds, 'max_duration_seconds', f.max_duration_seconds,
        'max_file_bytes', f.max_file_bytes, 'max_width', f.max_width, 'max_height', f.max_height,
        'min_width', f.min_width, 'min_height', f.min_height,
        'aspect_ratio', f.aspect_ratio, 'aspect_tolerance', f.aspect_tolerance,
        'delivery_long_edge', f.delivery_long_edge, 'image_quality', f.image_quality,
        'max_upload_bytes', f.max_upload_bytes) order by f.sort_order)
      from public.ad_formats f where f.enabled), '[]'::jsonb),
    'placements', coalesce((select jsonb_agg(jsonb_build_object(
        'code', p.code, 'name', p.name, 'description', p.description,
        'format_code', p.format_code, 'page_scope', p.page_scope,
        'views_enabled', p.views_enabled, 'views_rate_per_1000_minor', p.views_rate_per_1000_minor) order by p.sort_order)
      from public.ad_placements p join public.ad_formats f on f.code = p.format_code
     where p.enabled and f.enabled), '[]'::jsonb),
    'durations', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name, 'days', d.duration_days, 'views_enabled', d.views_enabled) order by d.sort_order, d.duration_days)
      from public.ad_durations d where d.enabled), '[]'::jsonb),
    'prices', coalesce((select jsonb_agg(jsonb_build_object(
        'placement_code', p.code, 'duration_id', pr.duration_id, 'currency', pr.currency, 'price_minor', pr.price_minor))
      from public.ad_pricing_plans pr
      join public.ad_placements p on p.id = pr.placement_id and p.enabled
      join public.ad_durations d on d.id = pr.duration_id and d.enabled
     where pr.enabled), '[]'::jsonb),
    'promotions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pm.id, 'name', pm.name, 'description', pm.description,
        'placement_code', (select p.code from public.ad_placements p where p.id = pm.placement_id),
        'duration_id', pm.duration_id, 'extra_days', pm.extra_days, 'discount_percent', pm.discount_percent,
        'ends_at', pm.ends_at, 'created_at', pm.created_at))
      from public.ad_promotions pm
     where pm.enabled and (pm.starts_at is null or pm.starts_at <= now()) and (pm.ends_at is null or pm.ends_at > now())), '[]'::jsonb),
    'at', now()
  );
$$;

-- ─────────────────────── grants ───────────────────────
do $$
declare fn text;
begin
  -- the admin's functions and every re-created one: the server alone (routes check is_admin before calling)
  foreach fn in array array[
    'public.ad_views_rate(uuid, integer)',
    'public.ad_views_price_for(uuid, uuid, integer, text)',
    'public.ad_campaign_quote(uuid, text)',
    'public.ad_views_credit(uuid)',
    'public.ad_views_deadline(uuid)',
    'public.activate_ad_campaign(uuid, uuid, text)',
    'public.ad_admin_resolve_delivery(uuid, uuid, text, integer, text)',
    'public.ad_admin_adjust_delivery(uuid, uuid, integer, text, text)',
    'public.ad_admin_delivery_summary(date, date, integer)',
    'public.ad_admin_delivery_list(jsonb, integer, integer)',
    'public.ad_admin_delivery_detail(uuid)',
    'public.ad_admin_capacity()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
  grant execute on function public.ad_catalog() to anon, authenticated;
end $$;
