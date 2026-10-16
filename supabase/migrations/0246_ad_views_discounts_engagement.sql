-- ═══════════════════════════════════════════════════════════════════════════
--  0246 — Views campaigns: volume discounts. Full-screen ads: likes and shares
--         (2026-10-15)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-15:
--   "In AD by views let their be discount from 5% to 30% when a user select 1m
--    views, 500K views should have a discount of 25%."
--   "Make users to be able to see the views, share, and likes of a full screen
--    ad like tiktok. The views should be the x10 multiplier. Signed and
--    anonymous users should be able to like an Ad, the ad campaign owner should
--    be able to see how many likes the ad got."
--
--   discounts   ad_platform_settings.views_volume_discounts: from a number of
--               views up, a percentage off the views price. The admin edits
--               the table; the default is 50K 5%, 100K 10%, 200K 15%, 300K 20%,
--               500K 25%, 1M 30%. The quote keeps the list price, states the
--               percentage (discount_percent, already in the quote shape since
--               0240) and charges the rest. It stacks on 0242's per-target
--               rate tiers only if an admin sets both.
--   likes       ad_campaign_reactions: one like per person per campaign, a
--               signed-in member by account, a signed-out visitor by the
--               anonymous visitor id the ad events already use. A share is
--               counted once per person too. ad_campaign_engagement keeps the
--               two counts so a full-screen ad reads one row.
--   views       ad_engagement(): the campaign's qualifying impressions (the
--               same count as the dashboard's Views) times its stats_multiplier
--               (the admin x10 sample mode, 0212) - the figure the advertiser's
--               own dashboard shows, so the two never disagree.
--
-- ORDER WITH 0242: this file works whether 0242 has run or not. It reads 0242's
-- columns through to_jsonb(row) (absent = null) and calls ad_views_rate only
-- when it exists. 0242 itself applies the discount when this file's
-- ad_views_discount_percent exists, so running 0242 AFTER this one keeps the
-- discount too.
--
-- Runner rules: no semicolon inside any single-quoted string, plain DDL first,
-- dollar-quoted blocks last, grants inside DO blocks, idempotent.

alter table public.ad_platform_settings add column if not exists views_volume_discounts jsonb not null
  default '[{"min_views": 50000, "percent": 5}, {"min_views": 100000, "percent": 10}, {"min_views": 200000, "percent": 15}, {"min_views": 300000, "percent": 20}, {"min_views": 500000, "percent": 25}, {"min_views": 1000000, "percent": 30}]'::jsonb;
alter table public.ad_platform_settings drop constraint if exists ad_platform_settings_views_discounts_chk;
alter table public.ad_platform_settings add constraint ad_platform_settings_views_discounts_chk check (jsonb_typeof(views_volume_discounts) = 'array' and jsonb_array_length(views_volume_discounts) <= 10);
comment on column public.ad_platform_settings.views_volume_discounts is '0246: [{"min_views": n, "percent": p}] - from n views up, p percent off the views price (0-90). The largest reached applies.';

create table if not exists public.ad_campaign_reactions (
  campaign_id uuid not null references public.ad_campaigns (id) on delete cascade,
  kind        text not null,
  -- 'u:' + the member id, or 'v:' + the anonymous visitor id
  actor_key   text not null,
  user_id     uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (campaign_id, kind, actor_key),
  constraint ad_campaign_reactions_kind_chk check (kind in ('like', 'share')),
  constraint ad_campaign_reactions_actor_chk check (actor_key ~ '^(u|v):[A-Za-z0-9_-]{8,64}$')
);
alter table public.ad_campaign_reactions enable row level security;
revoke all on public.ad_campaign_reactions from anon, authenticated;
comment on table public.ad_campaign_reactions is '0246: who liked or shared a paid ad - one row per person, kind and campaign. Written only by ad_react (service role).';

create table if not exists public.ad_campaign_engagement (
  campaign_id uuid primary key references public.ad_campaigns (id) on delete cascade,
  likes       integer not null default 0,
  shares      integer not null default 0,
  updated_at  timestamptz not null default now(),
  constraint ad_campaign_engagement_counts_chk check (likes >= 0 and shares >= 0)
);
alter table public.ad_campaign_engagement enable row level security;
revoke insert, update, delete, truncate on public.ad_campaign_engagement from anon, authenticated;
drop policy if exists "ad engagement own or admin" on public.ad_campaign_engagement;
create policy "ad engagement own or admin" on public.ad_campaign_engagement
  for select using (
    campaign_id in (select c.id from public.ad_campaigns c join public.advertisers a on a.id = c.advertiser_id
                    where a.user_id = (select auth.uid()))
    or (select public.is_admin()));
comment on table public.ad_campaign_engagement is '0246: the like and share counts of a paid ad. The advertiser reads their own (RLS), the full-screen ad reads them through ad_engagement.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── the percentage off for a target: the largest step it reaches, 0 below the first ──
create or replace function public.ad_views_discount_percent(p_target integer) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(least(90, greatest(0, max((t ->> 'percent')::integer))), 0)
    from public.ad_platform_settings s, jsonb_array_elements(s.views_volume_discounts) t
   where s.id
     and jsonb_typeof(t -> 'min_views') = 'number' and jsonb_typeof(t -> 'percent') = 'number'
     and (t ->> 'min_views')::integer <= p_target;
$$;

-- ── the views price: 0242's (or 0240's when 0242 has not run), with the volume discount ──
create or replace function public.ad_views_price_for(p_placement uuid, p_duration uuid, p_target integer, p_currency text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s             public.ad_platform_settings%rowtype;
  sj            jsonb;
  v_pl_enabled  boolean;
  v_pl_views    boolean;
  v_fmt_enabled boolean;
  v_rate        integer;
  v_days        integer;
  v_d_enabled   boolean;
  v_d_views     boolean;
  v_list        bigint;
  v_pct         integer;
  v_total       bigint;
  v_min         bigint;
  v_cap         jsonb;
begin
  select * into s from public.ad_platform_settings where id;
  sj := to_jsonb(s);
  if not coalesce(s.views_enabled, false) then return jsonb_build_object('ok', false, 'reason', 'views_pricing_disabled'); end if;
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
  -- 0242's rate tiers when that migration has run, else the placement's or the default rate
  if to_regprocedure('public.ad_views_rate(uuid, integer)') is not null then
    execute 'select public.ad_views_rate($1, $2)' into v_rate using p_placement, p_target;
  end if;
  -- integer money only: cents per 1,000 views x views / 1,000, rounded DOWN to the cent
  v_list := (p_target::bigint * v_rate) / 1000;
  if v_list <= 0 then return jsonb_build_object('ok', false, 'reason', 'no_price'); end if;
  -- the volume discount: the cents off are rounded DOWN, so the charge never drops below the stated percentage
  v_pct := public.ad_views_discount_percent(p_target);
  v_total := v_list - (v_list * v_pct) / 100;
  v_min := coalesce((sj ->> 'views_min_checkout_minor')::bigint, 0);
  if v_total < v_min then return jsonb_build_object('ok', false, 'reason', 'below_min_checkout', 'min_minor', v_min); end if;
  v_cap := public.ad_views_capacity(p_placement, p_target, v_days);
  if v_cap ->> 'decision' = 'refuse' then return jsonb_build_object('ok', false, 'reason', 'over_capacity', 'capacity', v_cap); end if;
  return jsonb_build_object(
    'ok', true, 'pricing_model', 'views_based', 'currency', p_currency,
    'list_price', v_list, 'discount_percent', v_pct, 'total', v_total,
    'duration_days', v_days, 'extra_days', 0, 'pricing_plan_id', null, 'promotion_id', null, 'quoted_at', now(),
    'target_views', p_target, 'rate_per_1000_minor', v_rate,
    -- 0242's delivery policies are sold with the campaign when they exist (absent keys = the 0240 terms)
    'terms', jsonb_strip_nulls(jsonb_build_object('auto_extend', s.views_auto_extend, 'extension_days', s.views_extension_days,
                                'max_extensions', s.views_max_extensions, 'extension_fee_minor', 0,
                                'extend_when_advertiser_paused', sj -> 'views_extend_when_advertiser_paused',
                                'suspension_policy', sj -> 'views_suspension_policy', 'on_exhausted', sj -> 'views_on_exhausted')),
    'capacity', v_cap);
end;
$$;

-- ── the public menu (0242's), one change: the volume discounts; 0242's own fields read through to_jsonb ──
create or replace function public.ad_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'v', 1,
    'settings', (select jsonb_strip_nulls(jsonb_build_object(
        'ads_enabled', s.ads_enabled, 'applications_open', s.applications_open,
        'multi_placement_enabled', s.multi_placement_enabled,
        'max_placements_per_application', s.max_placements_per_application,
        'display_currency', s.display_currency, 'default_slot_count', s.default_slot_count,
        'views_enabled', s.views_enabled, 'views_rate_per_1000_minor', s.views_rate_per_1000_minor,
        'views_min_target', s.views_min_target, 'views_max_target', s.views_max_target, 'views_target_step', s.views_target_step,
        'views_auto_extend', s.views_auto_extend, 'views_extension_days', s.views_extension_days, 'views_max_extensions', s.views_max_extensions,
        'fixed_enabled', to_jsonb(s) -> 'fixed_enabled', 'views_min_checkout_minor', to_jsonb(s) -> 'views_min_checkout_minor',
        'views_volume_tiers', to_jsonb(s) -> 'views_volume_tiers', 'views_volume_discounts', s.views_volume_discounts))
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

-- ── like / unlike / share: once per person, counted in the same transaction ──
create or replace function public.ad_react(p_campaign uuid, p_kind text, p_actor text, p_user uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_n      integer;
begin
  if p_kind not in ('like', 'share') or p_actor is null or p_actor !~ '^(u|v):[A-Za-z0-9_-]{8,64}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  select status into v_status from public.ad_campaigns where id = p_campaign;
  if v_status is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  insert into public.ad_campaign_engagement (campaign_id) values (p_campaign) on conflict (campaign_id) do nothing;
  if p_on then
    -- only an ad that is on the air takes new likes and shares
    if v_status not in ('active', 'completed') then return jsonb_build_object('ok', false, 'reason', 'not_live'); end if;
    insert into public.ad_campaign_reactions (campaign_id, kind, actor_key, user_id) values (p_campaign, p_kind, p_actor, p_user)
      on conflict (campaign_id, kind, actor_key) do nothing;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      update public.ad_campaign_engagement set
        likes = likes + (case when p_kind = 'like' then 1 else 0 end),
        shares = shares + (case when p_kind = 'share' then 1 else 0 end),
        updated_at = now()
      where campaign_id = p_campaign;
    end if;
  else
    -- a share is never taken back, a like is
    if p_kind <> 'like' then return jsonb_build_object('ok', false, 'reason', 'bad_request'); end if;
    delete from public.ad_campaign_reactions where campaign_id = p_campaign and kind = 'like' and actor_key = p_actor;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      update public.ad_campaign_engagement set likes = greatest(0, likes - 1), updated_at = now() where campaign_id = p_campaign;
    end if;
  end if;
  -- the same answer as a read, so the ad redraws its whole rail from it
  return public.ad_engagement(p_campaign, p_actor);
end;
$$;

-- ── what the full-screen ad shows: views (x the sample-mode multiplier), likes, shares, and whether this person liked it ──
create or replace function public.ad_engagement(p_campaign uuid, p_actor text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ok', true,
    'views', coalesce((select sum(d.impressions)::bigint from public.ad_campaign_daily_stats d where d.campaign_id = c.id), 0)
             * greatest(1, coalesce((to_jsonb(c) ->> 'stats_multiplier')::integer, 1)),
    'likes', coalesce(e.likes, 0),
    'shares', coalesce(e.shares, 0),
    'liked', p_actor is not null and exists (select 1 from public.ad_campaign_reactions r where r.campaign_id = c.id and r.kind = 'like' and r.actor_key = p_actor))
  from public.ad_campaigns c
  left join public.ad_campaign_engagement e on e.campaign_id = c.id
  where c.id = p_campaign;
$$;

-- ─────────────────────── grants ───────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.ad_views_discount_percent(integer)',
    'public.ad_views_price_for(uuid, uuid, integer, text)',
    'public.ad_react(uuid, text, text, uuid, boolean)',
    'public.ad_engagement(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
  grant execute on function public.ad_catalog() to anon, authenticated;
  grant select on public.ad_campaign_engagement to authenticated;
end $$;
