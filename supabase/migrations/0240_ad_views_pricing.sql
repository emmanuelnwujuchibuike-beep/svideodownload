-- ═══════════════════════════════════════════════════════════════════════════
--  0240 — views-based campaigns with guaranteed delivery (2026-10-12)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner brief "FRENZSAVE ADVERTISING SYSTEM UPGRADE, Part 1": a campaign is
-- sold either for a fixed period (unchanged) or for a number of qualifying
-- views, delivered in an initial period and extended FREE until the target is
-- met. Built on what exists (docs/AD_PLATFORM.md, Part 9):
--
--   price       ad_campaign_quote branches on the campaign's pricing_model.
--               ad_views_price_for is the views rule: integer cents, the rate
--               per 1,000 views from the placement (else the global default),
--               target bounds and step from ad_platform_settings. Submit,
--               the quote row and ad_payment_begin/settle are untouched, so a
--               views campaign pays exactly like a fixed one.
--   counting    the qualifying impression track_ad_events already decides
--               (>=50 % on screen for 1 s, risk rules, event-id dedupe) is
--               credited ONCE to ad_campaign_delivery, under a row lock and
--               never past the target.
--   lifecycle   ad_campaigns_sync_lifecycle (serving-route CDN miss) and the
--               hourly housekeeping run ad_views_deadlines: at the deadline a
--               campaign is fulfilled, extended free, or closed short with the
--               undelivered share owed back.
--   status      one new campaign status, completed (target reached).
--
-- Runner rules: no semicolon inside any single-quoted string, plain DDL first,
-- every dollar-quoted block LAST, triggers and grants inside DO blocks,
-- every statement idempotent.

-- ═══ 1 · ADMIN SETTINGS (no deploy to change any of them) ════════════════════

alter table public.ad_platform_settings add column if not exists views_enabled boolean not null default false;
alter table public.ad_platform_settings add column if not exists views_rate_per_1000_minor integer not null default 30;
alter table public.ad_platform_settings add column if not exists views_min_target integer not null default 1000;
alter table public.ad_platform_settings add column if not exists views_max_target integer not null default 1000000;
alter table public.ad_platform_settings add column if not exists views_target_step integer not null default 1000;
alter table public.ad_platform_settings add column if not exists views_auto_extend boolean not null default true;
alter table public.ad_platform_settings add column if not exists views_extension_days integer not null default 7;
alter table public.ad_platform_settings add column if not exists views_max_extensions integer not null default 8;
alter table public.ad_platform_settings add column if not exists views_capacity_policy text not null default 'review';
alter table public.ad_platform_settings add column if not exists views_capacity_window_days integer not null default 14;
alter table public.ad_platform_settings drop constraint if exists ad_platform_settings_views_chk;
alter table public.ad_platform_settings add constraint ad_platform_settings_views_chk check (
  views_rate_per_1000_minor between 1 and 10000000
  and views_min_target between 1 and 100000000
  and views_max_target between views_min_target and 100000000
  and views_target_step between 1 and 1000000
  and views_extension_days between 1 and 90
  and views_max_extensions between 0 and 52
  and views_capacity_policy in ('allow', 'review', 'block')
  and views_capacity_window_days between 1 and 90);

comment on column public.ad_platform_settings.views_rate_per_1000_minor is '0240: default USD cents per 1,000 qualifying views. A placement may override it (ad_placements.views_rate_per_1000_minor).';
comment on column public.ad_platform_settings.views_capacity_policy is '0240: allow = sell regardless, review = an unknown or over-capacity target waits for an admin, block = an over-capacity target is refused.';

-- placement-specific rates, and which placements and periods sell views
alter table public.ad_placements add column if not exists views_enabled boolean not null default true;
alter table public.ad_placements add column if not exists views_rate_per_1000_minor integer;
alter table public.ad_placements drop constraint if exists ad_placements_views_rate_chk;
alter table public.ad_placements add constraint ad_placements_views_rate_chk check (views_rate_per_1000_minor is null or views_rate_per_1000_minor between 1 and 10000000);
alter table public.ad_durations add column if not exists views_enabled boolean not null default true;

-- ═══ 2 · THE CAMPAIGN: its model and target (frozen once paid, see the guard) ═

alter table public.ad_campaigns add column if not exists pricing_model text not null default 'fixed_period';
alter table public.ad_campaigns add column if not exists target_views integer;
alter table public.ad_campaigns drop constraint if exists ad_campaigns_pricing_model_chk;
alter table public.ad_campaigns add constraint ad_campaigns_pricing_model_chk check (
  (pricing_model = 'fixed_period' and target_views is null)
  or (pricing_model = 'views_based' and target_views is not null and target_views > 0));

alter table public.ad_campaigns drop constraint if exists ad_campaigns_status_chk;
alter table public.ad_campaigns add constraint ad_campaigns_status_chk check (status in (
  'draft', 'awaiting_payment', 'payment_processing', 'paid', 'validating',
  'active', 'paused', 'expired', 'completed', 'rejected', 'cancelled', 'removed'));

-- ═══ 3 · DELIVERY: the guaranteed-views ledger, one row per views campaign ═══

create table if not exists public.ad_campaign_delivery (
  campaign_id      uuid primary key references public.ad_campaigns (id) on delete cascade,
  target_views     integer not null,
  delivered_views  integer not null default 0,
  phase            text not null default 'initial',
  initial_end_at   timestamptz not null,
  auto_extend      boolean not null,
  extension_days   integer not null,
  max_extensions   integer not null,
  extensions_used  integer not null default 0,
  fulfilled_at     timestamptz,
  closed_at        timestamptz,
  close_reason     text,
  shortfall_views  integer,
  notified_key     text not null default 'initial:0',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ad_campaign_delivery_target_chk check (target_views > 0),
  constraint ad_campaign_delivery_count_chk check (delivered_views between 0 and target_views),
  constraint ad_campaign_delivery_phase_chk check (phase in ('initial', 'extended', 'fulfilled', 'shortfall')),
  constraint ad_campaign_delivery_ext_chk check (extension_days between 1 and 90 and max_extensions between 0 and 52 and extensions_used between 0 and max_extensions)
);
create index if not exists ad_campaign_delivery_open_idx on public.ad_campaign_delivery (campaign_id) where phase in ('initial', 'extended');
create index if not exists ad_campaign_delivery_notify_idx on public.ad_campaign_delivery (updated_at) where notified_key <> 'initial:0';
-- capacity reads one placement's recent days (never a scan of raw events)
create index if not exists ad_campaign_daily_stats_placement_day_idx on public.ad_campaign_daily_stats (placement_code, day);

alter table public.ad_campaign_delivery enable row level security;
revoke insert, update, delete, truncate on public.ad_campaign_delivery from anon, authenticated;
drop policy if exists "ad delivery own or admin" on public.ad_campaign_delivery;
create policy "ad delivery own or admin" on public.ad_campaign_delivery
  for select using (
    (select public.is_admin())
    or campaign_id in (select c.id from public.ad_campaigns c join public.advertisers a on a.id = c.advertiser_id
                        where a.user_id = (select auth.uid())));

comment on table public.ad_campaign_delivery is '0240: the guaranteed-views contract of a views campaign. delivered_views counts qualifying impressions credited by track_ad_events, capped at the target. Written only by security-definer functions.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── status moves: completed is reached only from a live or paused campaign (catalog.ts holds the same map) ──
create or replace function public.ad_campaign_transition_allowed(p_from text, p_to text) returns boolean
language sql immutable set search_path = public as $$
  select case p_from
    when 'draft'              then p_to in ('awaiting_payment', 'cancelled', 'removed')
    when 'awaiting_payment'   then p_to in ('draft', 'payment_processing', 'cancelled', 'removed')
    when 'payment_processing' then p_to in ('awaiting_payment', 'cancelled', 'removed')
    when 'paid'               then p_to in ('validating', 'rejected', 'removed')
    when 'validating'         then p_to in ('rejected', 'removed')
    when 'active'             then p_to in ('paused', 'expired', 'completed', 'removed')
    when 'paused'             then p_to in ('expired', 'completed', 'removed')
    when 'expired'            then p_to in ('removed')
    when 'completed'          then p_to in ('removed')
    when 'rejected'           then p_to in ('removed')
    when 'cancelled'          then p_to in ('removed')
    else false
  end;
$$;

-- ── capacity: can the placement plausibly deliver this target? An estimate from
--    measured history, never a promise. Reads completed UTC days of the
--    placement's daily counters (indexed) and the open guaranteed obligations. ──
create or replace function public.ad_views_capacity(p_placement uuid, p_target integer, p_days integer) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s              public.ad_platform_settings%rowtype;
  v_code         text;
  v_today        date := (now() at time zone 'utc')::date;
  v_days_seen    integer;
  v_views        bigint;
  v_daily        numeric;
  v_outstanding  bigint;
  v_window       integer;
  v_est          integer;
  v_fit          text;
  v_decision     text;
begin
  select * into s from public.ad_platform_settings where id;
  select code into v_code from public.ad_placements where id = p_placement;
  select count(distinct st.day), coalesce(sum(st.impressions), 0) into v_days_seen, v_views
    from public.ad_campaign_daily_stats st
   where st.placement_code = v_code and st.day >= v_today - s.views_capacity_window_days and st.day < v_today;
  v_daily := case when v_days_seen > 0 then v_views::numeric / v_days_seen else 0 end;

  -- open guarantees on this placement: running deliveries, plus paid ones not live yet
  select coalesce(sum(d.target_views - d.delivered_views), 0) into v_outstanding
    from public.ad_campaign_delivery d join public.ad_campaigns c on c.id = d.campaign_id
   where c.placement_id = p_placement and d.phase in ('initial', 'extended');
  v_outstanding := v_outstanding + coalesce((
    select sum(c.target_views) from public.ad_campaigns c
     where c.placement_id = p_placement and c.pricing_model = 'views_based' and c.status in ('paid', 'validating')
       and not exists (select 1 from public.ad_campaign_delivery d where d.campaign_id = c.id)), 0);

  v_window := p_days + s.views_max_extensions * s.views_extension_days;
  if v_daily <= 0 then
    v_est := null;
    v_fit := 'unknown';
  else
    v_est := ceil((v_outstanding + p_target) / v_daily)::integer;
    v_fit := case when v_est <= p_days then 'within_period' when v_est <= v_window then 'needs_extension' else 'over_capacity' end;
  end if;
  v_decision := case s.views_capacity_policy
    when 'allow' then 'accept'
    when 'block' then case v_fit when 'over_capacity' then 'refuse' when 'unknown' then 'review' else 'accept' end
    else case when v_fit in ('unknown', 'over_capacity') then 'review' else 'accept' end
  end;
  return jsonb_build_object(
    'daily_views', round(v_daily), 'history_days', v_days_seen, 'outstanding_views', v_outstanding,
    'estimated_days', v_est, 'window_days', v_window, 'fit', v_fit, 'decision', v_decision, 'policy', s.views_capacity_policy);
end;
$$;

-- ── the views price, decided by the database from admin rows only ──
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
  -- rates are USD cents (quotes are USD since 0198)
  if p_currency is distinct from 'USD' then return jsonb_build_object('ok', false, 'reason', 'currency_unsupported'); end if;
  select p.enabled, p.views_enabled, f.enabled, coalesce(p.views_rate_per_1000_minor, s.views_rate_per_1000_minor)
    into v_pl_enabled, v_pl_views, v_fmt_enabled, v_rate
    from public.ad_placements p join public.ad_formats f on f.code = p.format_code where p.id = p_placement;
  if not coalesce(v_pl_enabled, false) then return jsonb_build_object('ok', false, 'reason', 'placement_disabled'); end if;
  if not coalesce(v_fmt_enabled, false) then return jsonb_build_object('ok', false, 'reason', 'format_disabled'); end if;
  if not coalesce(v_pl_views, false) then return jsonb_build_object('ok', false, 'reason', 'views_not_offered'); end if;
  select duration_days, enabled, views_enabled into v_days, v_d_enabled, v_d_views from public.ad_durations where id = p_duration;
  if not coalesce(v_d_enabled, false) or not coalesce(v_d_views, false) then return jsonb_build_object('ok', false, 'reason', 'duration_disabled'); end if;
  if p_target is null or p_target < s.views_min_target then return jsonb_build_object('ok', false, 'reason', 'target_too_small', 'min', s.views_min_target); end if;
  if p_target > s.views_max_target then return jsonb_build_object('ok', false, 'reason', 'target_too_large', 'max', s.views_max_target); end if;
  if p_target % s.views_target_step <> 0 then return jsonb_build_object('ok', false, 'reason', 'target_step', 'step', s.views_target_step); end if;
  -- integer money only: cents per 1,000 views x views / 1,000, rounded DOWN to the cent
  v_total := (p_target::bigint * v_rate) / 1000;
  if v_total <= 0 then return jsonb_build_object('ok', false, 'reason', 'no_price'); end if;
  v_cap := public.ad_views_capacity(p_placement, p_target, v_days);
  if v_cap ->> 'decision' = 'refuse' then return jsonb_build_object('ok', false, 'reason', 'over_capacity', 'capacity', v_cap); end if;
  return jsonb_build_object(
    'ok', true, 'pricing_model', 'views_based', 'currency', p_currency,
    'list_price', v_total, 'discount_percent', 0, 'total', v_total,
    'duration_days', v_days, 'extra_days', 0, 'pricing_plan_id', null, 'promotion_id', null, 'quoted_at', now(),
    'target_views', p_target, 'rate_per_1000_minor', v_rate,
    'terms', jsonb_build_object('auto_extend', s.views_auto_extend, 'extension_days', s.views_extension_days,
                                'max_extensions', s.views_max_extensions, 'extension_fee_minor', 0),
    'capacity', v_cap);
end;
$$;

-- ── the one quote entry point: a views campaign takes the views rule, every other campaign the 0198 rule ──
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
  return public.ad_price_for(v_placement, v_duration, p_currency);
end;
$$;

-- ── the delivery row opens when a views campaign first goes live, with the terms it was SOLD on ──
create or replace function public.ad_views_open_delivery() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s public.ad_platform_settings%rowtype;
begin
  if new.pricing_model = 'views_based' and new.status = 'active' and new.end_at is not null then
    select * into s from public.ad_platform_settings where id;
    insert into public.ad_campaign_delivery (campaign_id, target_views, initial_end_at, auto_extend, extension_days, max_extensions)
    values (new.id, new.target_views, new.end_at,
            coalesce((new.price_snapshot -> 'terms' ->> 'auto_extend')::boolean, s.views_auto_extend),
            coalesce((new.price_snapshot -> 'terms' ->> 'extension_days')::integer, s.views_extension_days),
            coalesce((new.price_snapshot -> 'terms' ->> 'max_extensions')::integer, s.views_max_extensions))
    on conflict (campaign_id) do nothing;
  end if;
  return null;
end;
$$;

-- ── target reached: fulfilled, stops serving (status completed). Idempotent. ──
create or replace function public.ad_views_fulfil(p_campaign uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d public.ad_campaign_delivery%rowtype;
  c public.ad_campaigns%rowtype;
begin
  select * into d from public.ad_campaign_delivery where campaign_id = p_campaign for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_views'); end if;
  if d.phase = 'fulfilled' then return jsonb_build_object('ok', true, 'already', true); end if;
  if d.delivered_views < d.target_views then return jsonb_build_object('ok', false, 'reason', 'target_not_reached'); end if;
  select * into c from public.ad_campaigns where id = p_campaign for update;
  update public.ad_campaign_delivery
     set phase = 'fulfilled', fulfilled_at = now(), closed_at = now(), updated_at = now()
   where campaign_id = p_campaign;
  if c.status in ('active', 'paused') then
    update public.ad_campaigns set status = 'completed', status_reason = 'target_reached' where id = p_campaign;
    insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_role, reason)
    values (p_campaign, 'target_reached', c.status, 'completed', 'system', d.target_views::text || ' views delivered');
  end if;
  return jsonb_build_object('ok', true, 'action', 'fulfilled');
end;
$$;

-- ── one qualifying view: credited under the delivery row lock, never past the target ──
create or replace function public.ad_views_credit(p_campaign uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_done   integer;
  v_target integer;
begin
  update public.ad_campaign_delivery
     set delivered_views = delivered_views + 1, updated_at = now()
   where campaign_id = p_campaign and phase in ('initial', 'extended') and delivered_views < target_views
  returning delivered_views, target_views into v_done, v_target;
  if not found then return false; end if;
  if v_done >= v_target then perform public.ad_views_fulfil(p_campaign); end if;
  return true;
end;
$$;

-- ── one campaign at its deadline: fulfilled, extended free, or closed short ──
--    Extension: only while auto-extend is on, extensions remain, the advertiser
--    is active, the creative is valid with an unblocked link, and the campaign
--    is live or paused BY THE ADVERTISER. An admin pause, a suspension or a
--    policy block never earns an extension - that campaign closes at its
--    deadline, so no suspension can extend a campaign without bound.
create or replace function public.ad_views_deadline(p_campaign uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d       public.ad_campaign_delivery%rowtype;
  c       public.ad_campaigns%rowtype;
  v_adv   text;
  v_why   text;
  v_end   timestamptz;
  v_short integer;
  v_owed  bigint;
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

  select status into v_adv from public.advertisers where id = c.advertiser_id;
  v_why := case
    when not d.auto_extend then 'auto_extend_off'
    when d.extensions_used >= d.max_extensions then 'extensions_exhausted'
    when v_adv is distinct from 'active' then 'advertiser_not_active'
    when c.status = 'paused' and c.status_reason is distinct from 'advertiser_paused' then 'suspended'
    when not exists (select 1 from public.ad_creatives cr
                      where cr.campaign_id = c.id and cr.status = 'active' and cr.validation_status = 'valid'
                        and cr.url_validation_status <> 'blocked') then 'creative_not_valid'
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

  -- no free extension: closed short, and the undelivered share is owed back (an admin pays or waives it, Part 7)
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

-- ── every views campaign at its deadline (bounded batch; one failure never stops the rest) ──
create or replace function public.ad_views_deadlines() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r       record;
  v       jsonb;
  n_ext   integer := 0;
  n_ful   integer := 0;
  n_short integer := 0;
begin
  for r in
    select d.campaign_id from public.ad_campaign_delivery d join public.ad_campaigns c on c.id = d.campaign_id
     where d.phase in ('initial', 'extended') and c.end_at <= now()
     order by c.end_at limit 200
  loop
    begin
      v := public.ad_views_deadline(r.campaign_id);
      if v ->> 'action' = 'extended' then n_ext := n_ext + 1;
      elsif v ->> 'action' = 'fulfilled' then n_ful := n_ful + 1;
      elsif v ->> 'action' = 'shortfall' then n_short := n_short + 1;
      end if;
    exception when others then
      raise warning 'ad_views_deadline skipped: % %', sqlstate, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('extended', n_ext, 'fulfilled', n_ful, 'shortfall', n_short);
end;
$$;

-- ── lifecycle (0195's, two changes): views deadlines first, and the plain
--    time expiry applies to fixed-period campaigns only ──
create or replace function public.ad_campaigns_sync_lifecycle() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_expired integer := 0;
  v_started integer := 0;
  v_pruned  integer := 0;
  v_views   jsonb;
begin
  v_views := public.ad_views_deadlines();

  with due as (
    select id, status from public.ad_campaigns
     where status in ('active', 'paused') and end_at <= now() and pricing_model = 'fixed_period'
     for update skip locked
  ), upd as (
    update public.ad_campaigns c set status = 'expired' from due where c.id = due.id
    returning c.id, due.status as from_status
  )
  insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_role)
  select id, 'campaign_expired', from_status, 'expired', 'system' from upd;
  get diagnostics v_expired = row_count;

  with st as (
    update public.ad_campaigns set started_at = now()
     where status = 'active' and started_at is null and start_at <= now()
    returning id
  )
  insert into public.ad_campaign_events (campaign_id, kind, to_status, actor_role)
  select id, 'campaign_started', 'active', 'system' from st;
  get diagnostics v_started = row_count;

  delete from public.ad_events where event_id in (
    select event_id from public.ad_events where created_at < now() - interval '35 days' limit 5000);
  get diagnostics v_pruned = row_count;

  return jsonb_build_object('expired', v_expired, 'started', v_started, 'pruned', v_pruned, 'views', v_views);
end;
$$;

-- ── advertiser notices for delivery changes, claimed once each (hourly housekeeping sends them) ──
create or replace function public.ad_views_claim_notices(p_limit integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_out jsonb;
begin
  with due as (
    select d.campaign_id from public.ad_campaign_delivery d
     where d.notified_key is distinct from (d.phase || ':' || d.extensions_used::text)
       and (d.phase <> 'initial')
     order by d.updated_at limit greatest(1, least(coalesce(p_limit, 50), 200))
     for update skip locked
  ), upd as (
    update public.ad_campaign_delivery d
       set notified_key = d.phase || ':' || d.extensions_used::text
      from due where d.campaign_id = due.campaign_id
    returning d.campaign_id, d.phase, d.target_views, d.delivered_views, d.shortfall_views, d.extensions_used
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'campaign_id', u.campaign_id, 'phase', u.phase, 'target_views', u.target_views,
           'delivered_views', u.delivered_views, 'shortfall_views', u.shortfall_views,
           'end_at', c.end_at, 'refund_owed', c.refund_status = 'owed')), '[]'::jsonb)
    into v_out
    from upd u join public.ad_campaigns c on c.id = u.campaign_id;
  return v_out;
end;
$$;

-- ── the guard (0195's), one change: the pricing model and the target views are frozen with the payment ──
create or replace function public.ad_campaigns_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_adv text;
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
    -- the money record is written once and never rewritten
    if old.payment_verified_at is not null and (
         new.payment_verified_at is distinct from old.payment_verified_at
      or new.payment_reference is distinct from old.payment_reference
      or new.total_amount_minor is distinct from old.total_amount_minor
      or new.currency is distinct from old.currency
      -- 0240: what was bought is frozen with the payment
      or new.pricing_model is distinct from old.pricing_model
      or new.target_views is distinct from old.target_views) then
      raise exception 'ad campaign payment record is immutable';
    end if;
  end if;
  if new.status = 'active' then
    if new.payment_verified_at is null then
      raise exception 'ad campaign cannot be active without a verified payment';
    end if;
    select status into v_adv from public.advertisers where id = new.advertiser_id;
    if v_adv is distinct from 'active' then
      raise exception 'ad campaign cannot be active while its advertiser is %', coalesce(v_adv, 'missing');
    end if;
    if new.start_at is null or new.end_at is null then
      raise exception 'ad campaign cannot be active without a start and an end';
    end if;
  end if;
  return new;
end;
$$;

-- ── activation (0210's), two changes: the capacity hold, and the delivery rule on a late resume ──
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

-- ── refund owed (0204's), one change: a views campaign owes its undelivered share ──
create or replace function public.ad_refund_owed(p_campaign uuid) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare
  c        record;
  v_total  numeric;
  v_left   numeric;
  v_t      integer;
  v_d      integer;
begin
  select payment_verified_at, total_amount_minor, started_at, start_at, end_at, pricing_model into c from public.ad_campaigns where id = p_campaign;
  if not found or c.payment_verified_at is null or coalesce(c.total_amount_minor, 0) <= 0 then return 0; end if;
  -- 0240: views were bought, not days - the undelivered share is owed, rounded DOWN
  if c.pricing_model = 'views_based' and c.started_at is not null then
    select target_views, delivered_views into v_t, v_d from public.ad_campaign_delivery where campaign_id = p_campaign;
    if found and v_t > 0 then
      return least(c.total_amount_minor, floor(c.total_amount_minor::numeric * greatest(0, v_t - v_d) / v_t))::bigint;
    end if;
  end if;
  if c.started_at is null or c.start_at is null or c.end_at is null then return c.total_amount_minor; end if;
  if c.end_at <= now() then return 0; end if;
  v_total := extract(epoch from (c.end_at - c.start_at));
  v_left  := extract(epoch from (c.end_at - greatest(now(), c.start_at)));
  if v_total <= 0 then return 0; end if;
  -- rounded DOWN: never owe more than was paid
  return least(c.total_amount_minor, floor(c.total_amount_minor * v_left / v_total))::bigint;
end;
$$;

-- ── viewer events (0206's), three changes: the pricing model is read, a completed campaign keeps
--    the 15-minute grace for batches in flight, and a qualifying impression is credited ──
create or replace function public.track_ad_events(p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_rules   jsonb := public.ad_traffic_rules();
  v_headers jsonb;
  v_ip      text;
  v_ua      text;
  v_iph     text;
  v_bot     boolean;
  v_admin   boolean := false;
  v_minute  timestamptz := date_trunc('minute', now());
  v_day     date := (now() at time zone 'utc')::date;
  v_n       integer;
  v_count   integer := 0;
  v_len     integer;
  v_vid     text;
  r         jsonb;
  v_type    text;
  v_cid     uuid;
  v_crid    uuid;
  v_ts      timestamptz;
  c         record;
  v_ok_type boolean;
  v_reasons text[];
  v_prior   integer;
  v_start   timestamptz;
  v_q       boolean;
  v_touched uuid[] := '{}'::uuid[];
  t         record;
  v_uuid    text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_window  interval;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then return 0; end if;
  v_len := jsonb_array_length(p_rows);
  if v_len = 0 or v_len > 50 then return 0; end if;

  -- who is sending: network (hashed per day), user agent, signed-in member
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  v_ip := nullif(btrim(coalesce(v_headers ->> 'cf-connecting-ip', v_headers ->> 'x-real-ip', split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1))), '');
  v_ua := v_headers ->> 'user-agent';
  if v_ip is not null then
    select left(encode(sha256(convert_to(hash_secret || ':' || v_day::text || ':' || v_ip, 'UTF8')), 'hex'), 32) into v_iph from public.ad_private_settings where id;
  end if;
  -- a request through PostgREST always carries a user agent - none, or an automation one, is a bot signature
  v_bot := v_headers is not null and (v_ua is null or v_ua ~* '(bot|crawl|spider|slurp|headless|phantom|puppeteer|playwright|selenium|python-requests|python-urllib|curl/|wget|httpclient|go-http|okhttp|axios|node-fetch|java/|libwww|scrapy)');
  if v_uid is not null then
    v_admin := coalesce(public.is_admin(), false);
  end if;
  v_vid := left(nullif(p_rows -> 0 ->> 'v', ''), 64);

  -- ingest rate: a network or a visitor over the limit has the whole batch refused (never banned)
  if v_iph is not null then
    insert into public.ad_ingest_counters as k (key, minute, n) values ('ip:' || v_iph, v_minute, v_len)
    on conflict (key, minute) do update set n = k.n + excluded.n returning n into v_n;
    if v_n > (v_rules ->> 'max_events_per_minute_per_ip')::int then return 0; end if;
  end if;
  if v_vid is not null then
    insert into public.ad_ingest_counters as k (key, minute, n) values ('v:' || v_vid, v_minute, v_len)
    on conflict (key, minute) do update set n = k.n + excluded.n returning n into v_n;
    if v_n > (v_rules ->> 'max_events_per_minute_per_visitor')::int then return 0; end if;
  end if;

  v_window := make_interval(mins => (v_rules ->> 'click_view_window_minutes')::int);

  for r in select * from jsonb_array_elements(p_rows)
  loop
    begin
      continue when coalesce(r ->> 'id', '') !~ v_uuid or coalesce(r ->> 'c', '') !~ v_uuid or coalesce(r ->> 'cr', '') !~ v_uuid;
      v_type := r ->> 't';
      continue when v_type is null or v_type not in ('loaded', 'visible', 'impression', 'click', 'video_start', 'video_complete',
                                                    'interstitial_view', 'reward_video_start', 'reward_video_complete',
                                                    'conversion', 'outbound', 'load_failed');
      v_cid := (r ->> 'c')::uuid;
      v_crid := (r ->> 'cr')::uuid;
      v_vid := left(nullif(r ->> 'v', ''), 64);

      -- the client's own clock: optional (older pages), but never stale or from the future
      v_ts := null;
      if (r ->> 'ts') ~ '^[0-9]{10,14}$' then
        v_ts := to_timestamp((r ->> 'ts')::bigint / 1000.0);
        if v_ts < now() - interval '24 hours' or v_ts > now() + interval '10 minutes' then
          insert into public.ad_invalid_daily as d (campaign_id, day, reason, events)
          select v_cid, v_day, 'stale_event', 1 where exists (select 1 from public.ad_campaigns where id = v_cid)
          on conflict (campaign_id, day, reason) do update set events = d.events + 1;
          continue;
        end if;
      end if;

      -- ELIGIBLE at the event time: its own creative, paid, live (15 minutes of grace for a batch in flight)
      select ca.id, ca.status, ca.start_at, ca.end_at, ca.updated_at, ca.payment_verified_at, ad.status as adv_status, ad.user_id as owner_id,
             p.code as placement_code, p.format_code, cr.status as cr_status, cr.updated_at as cr_updated, cr.duration_seconds, ca.pricing_model
        into c
        from public.ad_creatives cr
        join public.ad_campaigns ca on ca.id = cr.campaign_id
        join public.advertisers ad on ad.id = ca.advertiser_id
        join public.ad_placements p on p.id = ca.placement_id
       where cr.id = v_crid and ca.id = v_cid;
      if c.id is null then continue; end if;
      if c.payment_verified_at is null
         or not (c.status = 'active' or (c.status in ('paused', 'expired', 'completed') and c.updated_at > now() - interval '15 minutes'))
         or (c.adv_status <> 'active' and c.updated_at < now() - interval '15 minutes')
         or not (c.cr_status = 'active' or (c.cr_status = 'removed' and c.cr_updated > now() - interval '15 minutes'))
         or c.start_at is null or c.start_at > now() + interval '1 minute'
         or c.end_at is null or c.end_at < now() - interval '15 minutes' then
        insert into public.ad_invalid_daily as d (campaign_id, day, reason, events) values (v_cid, v_day, 'ineligible', 1)
        on conflict (campaign_id, day, reason) do update set events = d.events + 1;
        continue;
      end if;

      -- the event must fit the format
      v_ok_type := case
        when v_type in ('interstitial_view') then c.format_code in ('INTERSTITIAL', 'DOWNLOAD_COMPLETED_INTERSTITIAL')
        when v_type in ('reward_video_start', 'reward_video_complete') then c.format_code = 'REWARD_VIDEO'
        else true end;
      if not v_ok_type then
        insert into public.ad_invalid_daily as d (campaign_id, day, reason, events) values (v_cid, v_day, 'type_not_for_format', 1)
        on conflict (campaign_id, day, reason) do update set events = d.events + 1;
        continue;
      end if;

      -- risk signals - any one makes the event non-qualifying (kept as evidence)
      v_reasons := '{}'::text[];
      if v_bot then v_reasons := v_reasons || 'bot_signature'::text; end if;
      if v_admin then v_reasons := v_reasons || 'internal_traffic'::text; end if;
      if v_uid is not null and v_uid = c.owner_id then v_reasons := v_reasons || 'self_traffic'::text; end if;

      if v_type = 'impression' then
        if v_vid is not null then
          select count(*) into v_prior from public.ad_events
           where campaign_id = v_cid and visitor_id = v_vid and event_type = 'impression' and qualifying and created_at > now() - interval '1 hour';
          if v_prior >= (v_rules ->> 'impressions_per_visitor_hour')::int then v_reasons := v_reasons || 'frequency_visitor'::text; end if;
        end if;
        if v_iph is not null then
          select count(*) into v_prior from public.ad_events
           where campaign_id = v_cid and ip_hash = v_iph and event_type = 'impression' and qualifying and created_at > now() - interval '1 hour';
          if v_prior >= (v_rules ->> 'impressions_per_ip_hour')::int then v_reasons := v_reasons || 'frequency_network'::text; end if;
        end if;
      elsif v_type in ('click', 'conversion', 'outbound') then
        -- a click needs a view of the same creative by the same visitor shortly before it
        if v_vid is null or not exists (
             select 1 from public.ad_events
              where creative_id = v_crid and visitor_id = v_vid and created_at > now() - v_window
                and event_type = case v_type when 'click' then 'visible' when 'conversion' then 'click' else 'conversion' end)
           and not (v_type = 'click' and exists (
             select 1 from public.ad_events
              where creative_id = v_crid and visitor_id = v_vid and created_at > now() - v_window
                and event_type in ('impression', 'interstitial_view', 'reward_video_start'))) then
          v_reasons := v_reasons || case v_type when 'click' then 'click_without_view' else v_type || '_without_click' end;
        end if;
        if v_type = 'click' then
          if v_vid is not null then
            select count(*) into v_prior from public.ad_events
             where campaign_id = v_cid and visitor_id = v_vid and event_type = 'click' and qualifying and created_at > now() - interval '24 hours';
            if v_prior >= (v_rules ->> 'clicks_per_visitor_day')::int then v_reasons := v_reasons || 'repeat_click'::text; end if;
          end if;
          if v_iph is not null then
            select count(*) into v_prior from public.ad_events
             where campaign_id = v_cid and ip_hash = v_iph and event_type = 'click' and qualifying and created_at > now() - interval '24 hours';
            if v_prior >= (v_rules ->> 'clicks_per_ip_day')::int then v_reasons := v_reasons || 'network_click_volume'::text; end if;
          end if;
        end if;
      elsif v_type in ('video_complete', 'reward_video_complete') then
        -- a completion needs its start, and enough time between them for the video's length
        v_start := null;
        if v_vid is not null then
          select max(coalesce(client_ts, created_at)) into v_start from public.ad_events
           where creative_id = v_crid and visitor_id = v_vid and created_at > now() - interval '1 hour'
             and event_type = case v_type when 'video_complete' then 'video_start' else 'reward_video_start' end;
        end if;
        if v_start is null then
          v_reasons := v_reasons || 'completion_without_start'::text;
        elsif v_ts is not null and c.duration_seconds is not null
              and extract(epoch from (v_ts - v_start)) < (v_rules ->> 'min_completion_ratio')::numeric * c.duration_seconds then
          v_reasons := v_reasons || 'completion_too_fast'::text;
        end if;
      end if;

      v_q := cardinality(v_reasons) = 0;
      insert into public.ad_events (event_id, campaign_id, creative_id, placement_code, event_type, page, visitor_id, user_id, ip_hash, qualifying, risk_reasons, client_ts)
      values ((r ->> 'id')::uuid, v_cid, v_crid, c.placement_code, v_type, left(r ->> 'p', 32), v_vid, v_uid, v_iph, v_q, v_reasons, v_ts)
      on conflict (event_id) do nothing;
      get diagnostics v_n = row_count;
      continue when v_n = 0;

      insert into public.ad_campaign_daily_stats as s (campaign_id, creative_id, placement_code, day,
        loads, visibles, impressions, clicks, video_starts, video_completes, interstitial_views, reward_starts, reward_completes,
        conversions, outbounds, invalid_impressions, invalid_clicks, invalid_other, load_failures)
      values (v_cid, v_crid, c.placement_code, v_day,
        (v_q and v_type = 'loaded')::int, (v_q and v_type = 'visible')::int, (v_q and v_type = 'impression')::int, (v_q and v_type = 'click')::int,
        (v_q and v_type = 'video_start')::int, (v_q and v_type = 'video_complete')::int, (v_q and v_type = 'interstitial_view')::int,
        (v_q and v_type = 'reward_video_start')::int, (v_q and v_type = 'reward_video_complete')::int,
        (v_q and v_type = 'conversion')::int, (v_q and v_type = 'outbound')::int,
        (not v_q and v_type = 'impression')::int, (not v_q and v_type = 'click')::int,
        (not v_q and v_type not in ('impression', 'click', 'load_failed'))::int, (v_type = 'load_failed')::int)
      on conflict (campaign_id, creative_id, placement_code, day) do update set
        loads = s.loads + excluded.loads, visibles = s.visibles + excluded.visibles,
        impressions = s.impressions + excluded.impressions, clicks = s.clicks + excluded.clicks,
        video_starts = s.video_starts + excluded.video_starts, video_completes = s.video_completes + excluded.video_completes,
        interstitial_views = s.interstitial_views + excluded.interstitial_views,
        reward_starts = s.reward_starts + excluded.reward_starts, reward_completes = s.reward_completes + excluded.reward_completes,
        conversions = s.conversions + excluded.conversions, outbounds = s.outbounds + excluded.outbounds,
        invalid_impressions = s.invalid_impressions + excluded.invalid_impressions, invalid_clicks = s.invalid_clicks + excluded.invalid_clicks,
        invalid_other = s.invalid_other + excluded.invalid_other, load_failures = s.load_failures + excluded.load_failures;

      -- 0240: a qualifying view counts toward a guaranteed-views target once (the event id above), under
      -- the delivery row lock, never past the target. A late one after fulfilment stays in the stats only.
      if v_q and v_type = 'impression' and c.pricing_model = 'views_based' then
        perform public.ad_views_credit(v_cid);
      end if;

      if not v_q then
        insert into public.ad_invalid_daily as d (campaign_id, day, reason, events) values (v_cid, v_day, v_reasons[1], 1)
        on conflict (campaign_id, day, reason) do update set events = d.events + 1;
      end if;
      if not (v_cid = any (v_touched)) then v_touched := v_touched || v_cid; end if;
      v_count := v_count + 1;
    exception when others then
      raise warning 'track_ad_events row skipped: % %', sqlstate, sqlerrm;
    end;
  end loop;

  -- escalation: cheap reads of today's counters for the campaigns this batch touched
  begin
    for t in
      select st.campaign_id,
             sum(st.impressions + st.clicks + st.visibles + st.loads + st.video_starts + st.video_completes + st.interstitial_views
                 + st.reward_starts + st.reward_completes + st.conversions + st.outbounds) as valid_n,
             sum(st.invalid_impressions + st.invalid_clicks + st.invalid_other) as invalid_n,
             sum(st.invalid_clicks) as invalid_clicks, sum(st.load_failures) as failures, sum(st.loads) as loads
        from public.ad_campaign_daily_stats st
       where st.campaign_id = any (v_touched) and st.day = v_day
       group by st.campaign_id
    loop
      if t.valid_n + t.invalid_n >= (v_rules ->> 'flag_min_events')::int
         and t.invalid_n::numeric / greatest(1, t.valid_n + t.invalid_n) > (v_rules ->> 'flag_invalid_ratio')::numeric then
        perform public.ad_raise_risk_flag(t.campaign_id, null, 'invalid_traffic', 'medium',
          jsonb_build_object('valid', t.valid_n, 'invalid', t.invalid_n, 'day', v_day));
      end if;
      if t.invalid_clicks >= (v_rules ->> 'flag_invalid_clicks')::int then
        perform public.ad_raise_risk_flag(t.campaign_id, null, 'click_anomaly', 'medium',
          jsonb_build_object('invalid_clicks', t.invalid_clicks, 'day', v_day));
      end if;
      if t.failures >= (v_rules ->> 'flag_load_failures')::int and t.failures > t.loads then
        perform public.ad_raise_risk_flag(t.campaign_id, null, 'creative_load_failures', 'low',
          jsonb_build_object('failures', t.failures, 'loads', t.loads, 'day', v_day));
      end if;
    end loop;
    if v_uid is not null and exists (
      select 1 from public.ad_invalid_daily d join public.ad_campaigns ca on ca.id = d.campaign_id join public.advertisers ad on ad.id = ca.advertiser_id
       where d.campaign_id = any (v_touched) and d.day = v_day and d.reason = 'self_traffic' and ad.user_id = v_uid
         and d.events >= (v_rules ->> 'flag_self_traffic')::int) then
      perform public.ad_raise_risk_flag(null, (select id from public.advertisers where user_id = v_uid), 'self_traffic', 'low', jsonb_build_object('day', v_day));
    end if;
  exception when others then
    raise warning 'track_ad_events escalation skipped: % %', sqlstate, sqlerrm;
  end;
  return v_count;
end;
$$;

-- ── paid extension quote (0198's), one change: refused for a views campaign ──
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
  -- 0240: a views campaign is never sold more time - its delivery rule extends it free until the target is met
  if c.pricing_model = 'views_based' then return jsonb_build_object('ok', false, 'reason', 'views_extend_free'); end if;
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

-- ── the public menu (0208's), one change: the views terms, per placement and per period ──
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
        'views_auto_extend', s.views_auto_extend, 'views_extension_days', s.views_extension_days, 'views_max_extensions', s.views_max_extensions)
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

-- ─────────────────────── trigger + grants ───────────────────────
do $$
declare fn text;
begin
  drop trigger if exists ad_campaigns_views_delivery on public.ad_campaigns;
  execute 'create trigger ad_campaigns_views_delivery after insert or update of status on public.ad_campaigns for each row execute function public.ad_views_open_delivery()';
  -- every new function is the server's alone - the browser never prices, credits, extends or fulfils
  foreach fn in array array[
    'public.ad_views_capacity(uuid, integer, integer)',
    'public.ad_views_price_for(uuid, uuid, integer, text)',
    'public.ad_views_open_delivery()',
    'public.ad_views_fulfil(uuid)',
    'public.ad_views_credit(uuid)',
    'public.ad_views_deadline(uuid)',
    'public.ad_views_deadlines()',
    'public.ad_views_claim_notices(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
  -- re-created functions keep their grants, restated so a fresh database matches production
  foreach fn in array array[
    'public.ad_campaign_quote(uuid, text)',
    'public.ad_campaigns_sync_lifecycle()',
    'public.activate_ad_campaign(uuid, uuid, text)',
    'public.ad_refund_owed(uuid)',
    'public.ad_extension_quote(uuid, uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
  grant execute on function public.track_ad_events(jsonb) to anon, authenticated;
  grant execute on function public.ad_catalog() to anon, authenticated;
end $$;
