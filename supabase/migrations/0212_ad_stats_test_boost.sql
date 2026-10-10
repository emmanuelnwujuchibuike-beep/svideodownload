-- 0212 · Admin test boost (numbered 0211 when written - renumbered: 0211 is the All slots migration): show a campaign's dashboard figures x10.
--
-- DISPLAY ONLY. ad_events, ad_campaign_daily_stats, billing and refunds are never
-- changed. Per campaign, off by default (1), switched by an admin only. The
-- advertiser dashboard labels any boosted campaign "Test mode". Meant for the
-- house campaigns used to test and to run Frenzsave's own advert.
-- No semicolon inside any quoted string. Functions last.

alter table public.ad_campaigns add column if not exists stats_multiplier smallint not null default 1;
alter table public.ad_campaigns drop constraint if exists ad_campaigns_stats_multiplier_chk;
alter table public.ad_campaigns add constraint ad_campaigns_stats_multiplier_chk check (stats_multiplier in (1, 10));
comment on column public.ad_campaigns.stats_multiplier is '0212: dashboard display multiplier (1 or 10), admin-set test mode. Never applied to stored counts, billing or refunds.';

create or replace function public.admin_set_ad_stats_boost(p_campaign uuid, p_multiplier integer, p_admin uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cur smallint;
begin
  if p_admin is null or p_multiplier is null or p_multiplier not in (1, 10) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select stats_multiplier into v_cur from public.ad_campaigns where id = p_campaign for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_cur = p_multiplier then return jsonb_build_object('ok', true, 'multiplier', v_cur); end if;
  update public.ad_campaigns set stats_multiplier = p_multiplier where id = p_campaign;
  insert into public.ad_campaign_events (campaign_id, kind, actor_id, actor_role, reason)
  values (p_campaign, 'stats_boost', p_admin, 'admin', 'dashboard figures x' || p_multiplier::text);
  return jsonb_build_object('ok', true, 'multiplier', p_multiplier);
end;
$$;

-- the 0201 summary, with each campaign's figures scaled by its multiplier
create or replace function public.ad_my_summary(p_from date default null) returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (
    select c.id, c.status, c.stats_multiplier as m from public.ad_campaigns c join public.advertisers a on a.id = c.advertiser_id
     where a.user_id = auth.uid() and c.status <> 'cancelled'
  ), stats as (
    select coalesce(sum(s.impressions * mine.m), 0) as impressions, coalesce(sum(s.clicks * mine.m), 0) as clicks,
           coalesce(sum(s.reward_completes * mine.m), 0) as reward_completes, coalesce(sum(s.video_completes * mine.m), 0) as video_completes,
           coalesce(sum(s.conversions * mine.m), 0) as conversions, coalesce(sum(s.outbounds * mine.m), 0) as outbounds
      from public.ad_campaign_daily_stats s join mine on mine.id = s.campaign_id where (p_from is null or s.day >= p_from)
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
    'boosted', (select count(*) from mine where m > 1),
    'spend_usd_cents', (select usd_cents from spend));
$$;

do $$
begin
  revoke all on function public.admin_set_ad_stats_boost(uuid, integer, uuid) from public, anon, authenticated;
  grant execute on function public.admin_set_ad_stats_boost(uuid, integer, uuid) to service_role;
  revoke all on function public.ad_my_summary(date) from public, anon;
  grant execute on function public.ad_my_summary(date) to authenticated, service_role;
end $$;
