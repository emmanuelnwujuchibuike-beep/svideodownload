-- ═══════════════════════════════════════════════════════════════════════════
--  0201 — an ad's details on the page: conversions and site visits (2026-10-09)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "make users who click on an ad see the ad review instantly on the same
-- page, and users can choose to visit the link and be warned it is an external
-- link. Users who review the ad details should be recorded in the advertiser's
-- dashboard as conversion and clicks."
--
--   ad_events.event_type            learns 'conversion' (the member opened the ad's
--                                   details on Frenzsave) and 'outbound' (they then
--                                   chose to visit the advertiser's site)
--   ad_campaign_daily_stats         conversions, outbounds - the durable counters the
--                                   dashboard reads (owner-scoped RLS, unchanged)
--   track_ad_events()               the 0195 function, copied whole, counting both.
--                                   Same rules: a live campaign's creative only, once
--                                   per event id, never raises into the page
--   ad_my_summary()                 the 0198 function, copied whole, returning both
--
-- Opening the details sends 'click' AND 'conversion' for that ad view (the client
-- sends each type once per view). Visiting sends 'outbound'. No semicolon inside
-- any quoted string (the 0186 lesson). Functions last.

alter table public.ad_events drop constraint if exists ad_events_type_chk;
alter table public.ad_events add constraint ad_events_type_chk check (event_type in (
  'loaded', 'visible', 'impression', 'click', 'video_start', 'video_complete',
  'interstitial_view', 'reward_video_start', 'reward_video_complete', 'conversion', 'outbound'));

alter table public.ad_campaign_daily_stats add column if not exists conversions integer not null default 0;
alter table public.ad_campaign_daily_stats add column if not exists outbounds integer not null default 0;
comment on column public.ad_campaign_daily_stats.conversions is 'Members who opened the ad''s details on Frenzsave (0201). Also counted as a click.';
comment on column public.ad_campaign_daily_stats.outbounds is 'Members who then chose to visit the advertiser''s site after the external-link warning (0201).';

create or replace function public.track_ad_events(p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_count integer := 0;
  v_n     integer;
  r       jsonb;
  v_type  text;
  v_cid   uuid;
  v_crid  uuid;
  v_pl    text;
  v_uuid  text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then return 0; end if;
  if jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 50 then return 0; end if;
  for r in select * from jsonb_array_elements(p_rows)
  loop
    begin
      continue when coalesce(r ->> 'id', '') !~ v_uuid or coalesce(r ->> 'c', '') !~ v_uuid or coalesce(r ->> 'cr', '') !~ v_uuid;
      v_type := r ->> 't';
      continue when v_type is null or v_type not in ('loaded', 'visible', 'impression', 'click', 'video_start', 'video_complete',
                                                    'interstitial_view', 'reward_video_start', 'reward_video_complete',
                                                    'conversion', 'outbound');
      v_cid := (r ->> 'c')::uuid;
      v_crid := (r ->> 'cr')::uuid;
      -- only a creative of a campaign that is (or was until a day ago) live counts
      select p.code into v_pl
        from public.ad_creatives cr
        join public.ad_campaigns c on c.id = cr.campaign_id
        join public.ad_placements p on p.id = c.placement_id
       where cr.id = v_crid and c.id = v_cid
         and c.status in ('active', 'paused', 'expired') and c.end_at > now() - interval '1 day';
      continue when v_pl is null;
      insert into public.ad_events (event_id, campaign_id, creative_id, placement_code, event_type, page, visitor_id, user_id)
      values ((r ->> 'id')::uuid, v_cid, v_crid, v_pl, v_type, left(r ->> 'p', 32), left(r ->> 'v', 64), v_uid)
      on conflict (event_id) do nothing;
      get diagnostics v_n = row_count;
      continue when v_n = 0;
      insert into public.ad_campaign_daily_stats as s (campaign_id, creative_id, placement_code, day,
        loads, visibles, impressions, clicks, video_starts, video_completes, interstitial_views, reward_starts, reward_completes,
        conversions, outbounds)
      values (v_cid, v_crid, v_pl, (now() at time zone 'utc')::date,
        (v_type = 'loaded')::int, (v_type = 'visible')::int, (v_type = 'impression')::int, (v_type = 'click')::int,
        (v_type = 'video_start')::int, (v_type = 'video_complete')::int, (v_type = 'interstitial_view')::int,
        (v_type = 'reward_video_start')::int, (v_type = 'reward_video_complete')::int,
        (v_type = 'conversion')::int, (v_type = 'outbound')::int)
      on conflict (campaign_id, creative_id, placement_code, day) do update set
        loads = s.loads + excluded.loads, visibles = s.visibles + excluded.visibles,
        impressions = s.impressions + excluded.impressions, clicks = s.clicks + excluded.clicks,
        video_starts = s.video_starts + excluded.video_starts, video_completes = s.video_completes + excluded.video_completes,
        interstitial_views = s.interstitial_views + excluded.interstitial_views,
        reward_starts = s.reward_starts + excluded.reward_starts, reward_completes = s.reward_completes + excluded.reward_completes,
        conversions = s.conversions + excluded.conversions, outbounds = s.outbounds + excluded.outbounds;
      v_count := v_count + 1;
    exception when others then
      raise warning 'track_ad_events row skipped: % %', sqlstate, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$$;

create or replace function public.ad_my_summary(p_from date default null) returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (
    select c.id, c.status from public.ad_campaigns c join public.advertisers a on a.id = c.advertiser_id
     where a.user_id = auth.uid() and c.status <> 'cancelled'
  ), stats as (
    select coalesce(sum(s.impressions), 0) as impressions, coalesce(sum(s.clicks), 0) as clicks,
           coalesce(sum(s.reward_completes), 0) as reward_completes, coalesce(sum(s.video_completes), 0) as video_completes,
           coalesce(sum(s.conversions), 0) as conversions, coalesce(sum(s.outbounds), 0) as outbounds
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
    'conversions', (select conversions from stats), 'outbounds', (select outbounds from stats),
    'spend_usd_cents', (select usd_cents from spend));
$$;
