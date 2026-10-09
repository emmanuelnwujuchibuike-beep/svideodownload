-- ═══════════════════════════════════════════════════════════════════════════
--  0206 — Ad Platform Part 8: traffic quality, fraud signals, creative safety
--  (2026-10-09)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The audit (docs/AD_PLATFORM.md, Part 8) found:
--   - track_ad_events callable by anyone with the public anon key
--   - the campaign and creative ids public in the serving payload
--   - no rate limit, and every accepted row counted straight into the stats
--     advertisers pay against
-- This keeps the cheap path (browser → batched RPC on Supabase, no Vercel
-- function, no request per rotation) and puts the checks INSIDE it:
--
--   EVENT → VALIDATION → DEDUP → RISK CHECKS → QUALIFYING COUNTS → ADMIN REVIEW
--
--   validation  the campaign must be ELIGIBLE at the event time (live,
--               paid, active advertiser, its own creative, inside its window,
--               15 minutes of grace for a batch in flight). The event type
--               must fit the format. A stale or future client time is refused.
--   dedup       event_id, as before
--   risk        bot signature, internal (admin) traffic, the advertiser's own
--               traffic, ingest rate per network and per visitor, impression
--               frequency, a click with no view before it, repeat clicks, and
--               a completion too fast for the video or with no start.
--               Thresholds are admin-configurable
--               (ad_platform_settings.traffic_rules). No single signal bans
--               anyone: a flagged event is KEPT as evidence but does not count.
--   qualifying  the advertiser-visible counters count qualifying events only.
--               Filtered ones go to invalid_* columns (the advertiser sees the
--               totals) and to ad_invalid_daily by reason (admins only).
--   review      ad_risk_flags: one row per campaign, kind and day, raised by
--               thresholds and by payment reversals. Admins dismiss or confirm.
--               Confirming can move a day's counts out of qualifying.
--
-- Privacy: the IP is never stored. ip_hash is sha256(secret, UTC day, ip),
-- so it cannot be linked across days. It is dropped after
-- ip_hash_retention_days, and raw events are deleted after
-- raw_retention_days. The daily stats are the durable record.
--
-- Creative safety columns (moderation_*), url_approved_url, and the copied
-- activate_ad_campaign / admin_moderate_ad_campaign (each with one marked
-- change) support the server-side checks in lib/ads-platform/url-safety.ts
-- and creative-moderation.ts.
--
-- No semicolon inside any quoted string. Functions, triggers and the DO block last.

-- ═══ 1 · rules and the private salt ═════════════════════════════════════════
alter table public.ad_platform_settings add column if not exists traffic_rules jsonb not null default '{}'::jsonb;

create table if not exists public.ad_private_settings (
  id          boolean primary key default true,
  hash_secret text not null,
  constraint ad_private_settings_singleton_chk check (id)
);
alter table public.ad_private_settings enable row level security;
revoke all on public.ad_private_settings from public, anon, authenticated;
insert into public.ad_private_settings (id, hash_secret)
values (true, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (id) do nothing;

-- ═══ 2 · events: evidence and the qualifying verdict ════════════════════════
alter table public.ad_events add column if not exists ip_hash text;
alter table public.ad_events add column if not exists qualifying boolean not null default true;
alter table public.ad_events add column if not exists risk_reasons text[] not null default '{}'::text[];
alter table public.ad_events add column if not exists client_ts timestamptz;
alter table public.ad_events drop constraint if exists ad_events_type_chk;
alter table public.ad_events add constraint ad_events_type_chk check (event_type in (
  'loaded', 'visible', 'impression', 'click', 'video_start', 'video_complete',
  'interstitial_view', 'reward_video_start', 'reward_video_complete', 'conversion', 'outbound', 'load_failed'));

create index if not exists ad_events_campaign_visitor_idx on public.ad_events (campaign_id, visitor_id, created_at desc) where visitor_id is not null;
create index if not exists ad_events_campaign_ip_idx on public.ad_events (campaign_id, ip_hash, created_at desc) where ip_hash is not null;
create index if not exists ad_events_creative_visitor_idx on public.ad_events (creative_id, visitor_id, event_type, created_at desc) where visitor_id is not null;

alter table public.ad_campaign_daily_stats add column if not exists invalid_impressions integer not null default 0;
alter table public.ad_campaign_daily_stats add column if not exists invalid_clicks integer not null default 0;
alter table public.ad_campaign_daily_stats add column if not exists invalid_other integer not null default 0;
alter table public.ad_campaign_daily_stats add column if not exists load_failures integer not null default 0;

-- why events were filtered, per campaign and day (admins only, never advertisers)
create table if not exists public.ad_invalid_daily (
  campaign_id uuid not null references public.ad_campaigns (id) on delete cascade,
  day         date not null,
  reason      text not null,
  events      integer not null default 0,
  primary key (campaign_id, day, reason)
);
alter table public.ad_invalid_daily enable row level security;
revoke all on public.ad_invalid_daily from public, anon, authenticated;
drop policy if exists "ad invalid daily admin" on public.ad_invalid_daily;
create policy "ad invalid daily admin" on public.ad_invalid_daily for select using ((select public.is_admin()));
grant select on public.ad_invalid_daily to authenticated;

-- ingest counters (one row per key per minute, pruned after 10 minutes)
create table if not exists public.ad_ingest_counters (
  key     text not null,
  minute  timestamptz not null,
  n       integer not null default 0,
  primary key (key, minute)
);
alter table public.ad_ingest_counters enable row level security;
revoke all on public.ad_ingest_counters from public, anon, authenticated;

-- ═══ 3 · risk flags: the admin review queue ═════════════════════════════════
create table if not exists public.ad_risk_flags (
  id              bigint generated always as identity primary key,
  campaign_id     uuid references public.ad_campaigns (id) on delete cascade,
  advertiser_id   uuid references public.advertisers (id) on delete cascade,
  kind            text not null,
  severity        text not null default 'medium',
  status          text not null default 'open',
  day             date not null default ((now() at time zone 'utc')::date),
  hits            integer not null default 1,
  evidence        jsonb not null default '{}'::jsonb,
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  alerted_at      timestamptz,
  resolved_by     uuid references auth.users (id) on delete set null,
  resolved_at     timestamptz,
  resolution_note text,
  constraint ad_risk_flags_severity_chk check (severity in ('low', 'medium', 'high')),
  constraint ad_risk_flags_status_chk check (status in ('open', 'dismissed', 'confirmed')),
  constraint ad_risk_flags_kind_chk check (kind ~ '^[a-z][a-z0-9_]{1,63}$')
);
create unique index if not exists ad_risk_flags_once_idx on public.ad_risk_flags (kind, day, coalesce(campaign_id::text, ''), coalesce(advertiser_id::text, ''));
create index if not exists ad_risk_flags_open_idx on public.ad_risk_flags (last_seen desc) where status = 'open';
alter table public.ad_risk_flags enable row level security;
revoke all on public.ad_risk_flags from public, anon, authenticated;
drop policy if exists "ad risk flags admin" on public.ad_risk_flags;
create policy "ad risk flags admin" on public.ad_risk_flags for select using ((select public.is_admin()));
grant select on public.ad_risk_flags to authenticated;

-- ═══ 4 · creative safety state ══════════════════════════════════════════════
alter table public.ad_creatives add column if not exists moderation_status text not null default 'unchecked';
alter table public.ad_creatives add column if not exists moderation_labels text[] not null default '{}'::text[];
alter table public.ad_creatives add column if not exists moderated_at timestamptz;
alter table public.ad_creatives add column if not exists url_approved_url text;
alter table public.ad_creatives drop constraint if exists ad_creatives_moderation_chk;
alter table public.ad_creatives add constraint ad_creatives_moderation_chk check (moderation_status in ('unchecked', 'passed', 'review', 'rejected', 'skipped', 'approved'));
-- a url review is 'pending' with a reason (0195 already allows pending)

comment on table public.ad_risk_flags is 'Part 8 (0206): one row per campaign or advertiser, kind and UTC day - raised by traffic thresholds, unsafe destinations and payment reversals. Admins dismiss or confirm with a note. Never shown to advertisers.';
comment on table public.ad_invalid_daily is 'Part 8 (0206): filtered ad events per campaign, day and reason. Admins only - the reasons would teach evasion.';
comment on column public.ad_events.ip_hash is 'Part 8 (0206): sha256 of a private secret, the UTC day and the client IP - pseudonymous, unlinkable across days, dropped after traffic_rules.ip_hash_retention_days.';
comment on column public.ad_events.qualifying is 'Part 8 (0206): false when any risk reason applied. Kept as evidence, never counted for the advertiser.';
comment on column public.ad_platform_settings.traffic_rules is 'Part 8 (0206): admin overrides of the traffic thresholds (keys in ad_traffic_rules()). Missing keys use the defaults.';

-- ═════════════════════════════════════════════════════════════════════════════
--  FUNCTIONS LAST
-- ═════════════════════════════════════════════════════════════════════════════

-- ── the thresholds in force: defaults overlaid by the admin's values ──
create or replace function public.ad_traffic_rules() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'max_events_per_minute_per_ip', 600,
    'max_events_per_minute_per_visitor', 240,
    'impressions_per_visitor_hour', 20,
    'impressions_per_ip_hour', 200,
    'clicks_per_visitor_day', 3,
    'clicks_per_ip_day', 30,
    'click_view_window_minutes', 30,
    'min_completion_ratio', 0.8,
    'flag_min_events', 100,
    'flag_invalid_ratio', 0.5,
    'flag_invalid_clicks', 50,
    'flag_load_failures', 25,
    'flag_self_traffic', 20,
    'raw_retention_days', 35,
    'ip_hash_retention_days', 7,
    'flag_retention_days', 365
  ) || coalesce((select traffic_rules from public.ad_platform_settings where id), '{}'::jsonb);
$$;

-- ── raise (or bump) one review flag. Idempotent per kind, day and subject. ──
create or replace function public.ad_raise_risk_flag(p_campaign uuid, p_advertiser uuid, p_kind text, p_severity text, p_evidence jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_adv uuid := p_advertiser;
  v_id  bigint;
begin
  if p_campaign is not null and v_adv is null then
    select advertiser_id into v_adv from public.ad_campaigns where id = p_campaign;
  end if;
  insert into public.ad_risk_flags (campaign_id, advertiser_id, kind, severity, evidence)
  values (p_campaign, v_adv, p_kind, coalesce(p_severity, 'medium'), coalesce(p_evidence, '{}'::jsonb))
  on conflict (kind, day, coalesce(campaign_id::text, ''), coalesce(advertiser_id::text, '')) do update
     set hits = public.ad_risk_flags.hits + 1,
         last_seen = now(),
         evidence = excluded.evidence,
         severity = case when excluded.severity = 'high' or public.ad_risk_flags.severity = 'high' then 'high'
                         when excluded.severity = 'medium' or public.ad_risk_flags.severity = 'medium' then 'medium'
                         else 'low' end,
         status = case when public.ad_risk_flags.status = 'dismissed' and excluded.severity = 'high' then 'open' else public.ad_risk_flags.status end
  returning id into v_id;
  return v_id;
end;
$$;

-- ── viewer events: validated, deduplicated, risk-checked, counted only when qualifying ──
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
             p.code as placement_code, p.format_code, cr.status as cr_status, cr.updated_at as cr_updated, cr.duration_seconds
        into c
        from public.ad_creatives cr
        join public.ad_campaigns ca on ca.id = cr.campaign_id
        join public.advertisers ad on ad.id = ca.advertiser_id
        join public.ad_placements p on p.id = ca.placement_id
       where cr.id = v_crid and ca.id = v_cid;
      if c.id is null then continue; end if;
      if c.payment_verified_at is null
         or not (c.status = 'active' or (c.status in ('paused', 'expired') and c.updated_at > now() - interval '15 minutes'))
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

-- ── a domain the admin blocks stops serving at once: matching creatives are
--    blocked and live campaigns paused (within one 5-minute serving bucket) ──
create or replace function public.ad_rescan_blocked_destinations() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rec      record;
  v_hits   integer := 0;
  v_paused integer := 0;
begin
  for rec in
    select cr.id as creative_id, cr.campaign_id, ca.status, b.domain
      from public.ad_creatives cr
      join public.ad_campaigns ca on ca.id = cr.campaign_id
      join public.ad_blocked_domains b
        on lower(substring(cr.destination_url from '^https://([^/:?#]+)')) = b.domain
        or lower(substring(cr.destination_url from '^https://([^/:?#]+)')) like '%.' || b.domain
     where cr.status in ('active', 'staged') and cr.url_validation_status <> 'blocked'
       and ca.status in ('paid', 'validating', 'active', 'paused')
     for update of cr
  loop
    update public.ad_creatives set url_validation_status = 'blocked', url_block_reason = 'destination_blocked: ' || rec.domain, url_validated_at = now(), updated_at = now()
     where id = rec.creative_id;
    v_hits := v_hits + 1;
    if rec.status = 'active' then
      update public.ad_campaigns set status = 'paused', status_reason = 'unsafe_destination' where id = rec.campaign_id and status = 'active';
      if found then
        v_paused := v_paused + 1;
        insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_role, reason)
        values (rec.campaign_id, 'paused', 'active', 'paused', 'system', 'unsafe_destination ' || rec.domain);
      end if;
    end if;
    perform public.ad_raise_risk_flag(rec.campaign_id, null, 'unsafe_destination', 'high', jsonb_build_object('domain', rec.domain));
  end loop;
  return jsonb_build_object('blocked', v_hits, 'paused', v_paused);
end;
$$;

-- ── retention, bounded per run: counters, raw events, the per-day IP hash, old resolved flags ──
create or replace function public.ad_traffic_housekeeping() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rules    jsonb := public.ad_traffic_rules();
  v_counters integer;
  v_events   integer;
  v_hashes   integer;
  v_flags    integer;
begin
  delete from public.ad_ingest_counters where minute < now() - interval '10 minutes';
  get diagnostics v_counters = row_count;
  delete from public.ad_events where event_id in (
    select event_id from public.ad_events
     where created_at < now() - make_interval(days => (v_rules ->> 'raw_retention_days')::int) limit 20000);
  get diagnostics v_events = row_count;
  update public.ad_events set ip_hash = null where event_id in (
    select event_id from public.ad_events
     where ip_hash is not null and created_at < now() - make_interval(days => (v_rules ->> 'ip_hash_retention_days')::int) limit 20000);
  get diagnostics v_hashes = row_count;
  delete from public.ad_risk_flags
   where status <> 'open' and resolved_at < now() - make_interval(days => (v_rules ->> 'flag_retention_days')::int);
  get diagnostics v_flags = row_count;
  return jsonb_build_object('counters', v_counters, 'events', v_events, 'ip_hashes', v_hashes, 'flags', v_flags);
end;
$$;

-- ── an admin decision on a flag. Confirming a traffic flag can move that day's
--    counts out of qualifying - recorded, never silent. ──
create or replace function public.admin_resolve_ad_risk_flag(p_flag bigint, p_action text, p_admin uuid, p_note text, p_exclude boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f        public.ad_risk_flags%rowtype;
  v_note   text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
  v_moved  jsonb := null;
  v_imp    bigint;
  v_clk    bigint;
begin
  if p_admin is null or p_action is null or p_action not in ('dismiss', 'confirm') then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if v_note is null then return jsonb_build_object('ok', false, 'reason', 'note_required'); end if;
  select * into f from public.ad_risk_flags where id = p_flag for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if f.status <> 'open' then return jsonb_build_object('ok', false, 'reason', 'already_resolved', 'status', f.status); end if;

  if p_action = 'confirm' and coalesce(p_exclude, false) and f.campaign_id is not null and f.kind in ('invalid_traffic', 'click_anomaly') then
    select coalesce(sum(impressions), 0), coalesce(sum(clicks), 0) into v_imp, v_clk
      from public.ad_campaign_daily_stats where campaign_id = f.campaign_id and day = f.day;
    update public.ad_campaign_daily_stats
       set invalid_impressions = invalid_impressions + impressions, invalid_clicks = invalid_clicks + clicks,
           impressions = 0, clicks = 0
     where campaign_id = f.campaign_id and day = f.day;
    insert into public.ad_invalid_daily as d (campaign_id, day, reason, events) values (f.campaign_id, f.day, 'admin_excluded', (v_imp + v_clk)::int)
    on conflict (campaign_id, day, reason) do update set events = d.events + excluded.events;
    v_moved := jsonb_build_object('impressions', v_imp, 'clicks', v_clk, 'day', f.day);
  end if;

  update public.ad_risk_flags
     set status = case p_action when 'dismiss' then 'dismissed' else 'confirmed' end,
         resolved_by = p_admin, resolved_at = now(), resolution_note = v_note,
         evidence = case when v_moved is null then evidence else evidence || jsonb_build_object('excluded', v_moved) end
   where id = p_flag;
  if f.campaign_id is not null then
    insert into public.ad_campaign_events (campaign_id, kind, actor_id, actor_role, reason)
    values (f.campaign_id, 'risk_' || p_action || 'ed', p_admin, 'admin', left(f.kind || ': ' || v_note, 300));
  end if;
  return jsonb_build_object('ok', true, 'status', case p_action when 'dismiss' then 'dismissed' else 'confirmed' end, 'excluded', v_moved);
end;
$$;

-- ── a payment reversal or an uncertain payment on an ad raises a review flag ──
create or replace function public.ad_payment_risk_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
begin
  begin
    if new.purpose = 'ad_campaign' and new.status is distinct from old.status
       and new.status in ('chargeback', 'mismatch', 'verification_required', 'refunded', 'partially_refunded') then
      for cid in select id from public.ad_campaigns where application_id = nullif(new.item_id, '')::uuid and payment_reference = new.reference
      loop
        perform public.ad_raise_risk_flag(cid, null, 'payment_' || new.status,
          case when new.status in ('chargeback', 'mismatch') then 'high' else 'medium' end,
          jsonb_build_object('reference', new.reference, 'provider', new.provider));
      end loop;
    end if;
  exception when others then
    raise warning 'ad_payment_risk_trigger skipped: % %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

-- ── activation, copied WHOLE from 0204 with one change (marked 0206): a creative
--    whose safety check asked for a person holds the first activation. ──
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
  if exists (select 1 from public.ad_creatives where campaign_id = p_campaign and status = 'active' and url_validation_status <> 'valid') then
    v_flags := v_flags || 'destination_not_valid'::text;
  end if;
  -- 0206: an automated safety check that wants a person, or that has not run, holds the first activation
  if exists (select 1 from public.ad_creatives where campaign_id = p_campaign and status = 'active' and moderation_status = 'review') then
    v_flags := v_flags || 'safety_review'::text;
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

-- ── the admin decision, copied WHOLE from 0204 with one change (marked 0206):
--    approval also answers a safety review and remembers the approved link. ──
create or replace function public.admin_moderate_ad_campaign(
  p_campaign uuid, p_action text, p_expected_version integer, p_admin uuid, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c       public.ad_campaigns%rowtype;
  r       jsonb;
  v_to    text;
  v_owed  bigint;
  v_why   text := nullif(left(btrim(coalesce(p_reason, '')), 300), '');
  v_ver   integer;
begin
  if p_admin is null or p_action is null or p_action not in ('approve', 'reject', 'pause', 'resume', 'remove') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into c from public.ad_campaigns where id = p_campaign for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_expected_version is not null and c.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'stale', 'version', c.version, 'status', c.status);
  end if;
  if p_action in ('reject', 'remove') and v_why is null then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  if p_action = 'approve' then
    if c.status not in ('paid', 'validating') then return jsonb_build_object('ok', false, 'reason', 'bad_status', 'status', c.status); end if;
    -- a person looked: what was only WAITING on a check passes. Invalid or
    -- blocked media and blocked links stay refused - approval cannot lift them.
    update public.ad_creatives set validation_status = 'valid', validation_errors = '{}'::text[], validated_at = now(), updated_at = now()
     where campaign_id = c.id and status = 'active' and validation_status = 'pending';
    -- 0206: the person's approval of THIS link is remembered, so a later automated pass does not re-hold it
    update public.ad_creatives set url_validation_status = 'valid', url_validated_at = now(), url_approved_url = destination_url, updated_at = now()
     where campaign_id = c.id and status = 'active' and url_validation_status = 'pending';
    -- 0206: a safety check that asked for a person is answered by this approval (a rejection stays)
    update public.ad_creatives set moderation_status = 'approved', moderated_at = now(), updated_at = now()
     where campaign_id = c.id and status = 'active' and moderation_status = 'review';
    insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role, reason)
    values (c.id, 'approved', c.status, c.status, p_admin, 'admin', v_why);
    r := public.activate_ad_campaign(c.id, p_admin, 'admin');
    return r || jsonb_build_object('action', 'approve');
  end if;

  if p_action = 'resume' then
    if c.status <> 'paused' then return jsonb_build_object('ok', false, 'reason', 'bad_status', 'status', c.status); end if;
    r := public.activate_ad_campaign(c.id, p_admin, 'admin');
    if coalesce((r ->> 'ok')::boolean, false) then
      update public.ad_campaigns set status_reason = null where id = c.id;
    end if;
    return r || jsonb_build_object('action', 'resume');
  end if;

  if p_action = 'pause' then
    if c.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'bad_status', 'status', c.status); end if;
    update public.ad_campaigns set status = 'paused', status_reason = 'admin_paused' where id = c.id returning version into v_ver;
    insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role, reason)
    values (c.id, 'paused', 'active', 'paused', p_admin, 'admin', coalesce(v_why, 'admin_paused'));
    return jsonb_build_object('ok', true, 'action', 'pause', 'status', 'paused', 'version', v_ver);
  end if;

  -- reject or remove
  v_to := case when p_action = 'reject' then 'rejected' else 'removed' end;
  if not public.ad_campaign_transition_allowed(c.status, v_to) then
    return jsonb_build_object('ok', false, 'reason', 'transition_not_allowed', 'from', c.status, 'to', v_to);
  end if;
  v_owed := case when c.refund_status = 'none' then public.ad_refund_owed(c.id) else 0 end;
  update public.ad_campaigns
     set status = v_to, status_reason = v_why,
         refund_status = case when v_owed > 0 then 'owed' else refund_status end,
         refund_owed_minor = case when v_owed > 0 then v_owed else refund_owed_minor end
   where id = c.id
  returning version into v_ver;
  insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role, reason)
  values (c.id, v_to, c.status, v_to, p_admin, 'admin', v_why);
  if v_owed > 0 then
    insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role, reason)
    values (c.id, 'refund_owed', v_to, v_to, p_admin, 'admin', v_owed::text || ' ' || coalesce(c.currency, ''));
  end if;
  return jsonb_build_object('ok', true, 'action', p_action, 'status', v_to, 'version', v_ver,
                            'refund_owed', v_owed, 'currency', c.currency);
end;
$$;

do $$
declare
  fn text;
begin
  execute 'drop trigger if exists ad_payment_risk_trg on public.ai_topup_attempts';
  execute 'create trigger ad_payment_risk_trg after update of status on public.ai_topup_attempts for each row execute function public.ad_payment_risk_trigger()';
  foreach fn in array array[
    'public.ad_traffic_rules()',
    'public.ad_raise_risk_flag(uuid, uuid, text, text, jsonb)',
    'public.track_ad_events(jsonb)',
    'public.ad_rescan_blocked_destinations()',
    'public.ad_traffic_housekeeping()',
    'public.admin_resolve_ad_risk_flag(bigint, text, uuid, text, boolean)',
    'public.ad_payment_risk_trigger()',
    'public.activate_ad_campaign(uuid, uuid, text)',
    'public.admin_moderate_ad_campaign(uuid, text, integer, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
  -- the ingest stays callable from the browser: every check above runs inside it
  grant execute on function public.track_ad_events(jsonb) to anon, authenticated;
end $$;
