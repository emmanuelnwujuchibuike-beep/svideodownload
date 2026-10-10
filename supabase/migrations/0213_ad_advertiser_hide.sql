-- 0213: an advertiser removes a finished campaign from their own list.
--
-- Drafts and unpaid applications are simply cancelled (0195 already allows it).
-- A campaign that ran (expired), was rejected or was cancelled is NOT deleted:
-- its payment, audit trail and counters are records the admin, refunds and
-- fraud checks rely on. It is only hidden from the advertiser's list.
-- Lifetime figures on the dashboard still include it - the views happened.

alter table public.ad_campaigns add column if not exists advertiser_hidden_at timestamptz;
comment on column public.ad_campaigns.advertiser_hidden_at is '0213: the advertiser removed this finished campaign from their list. Hidden from them only - never deleted, still counted in lifetime figures and visible to admins.';

-- the 0212 summary: the campaign counts leave out hidden ones, the measured figures and spend do not
create or replace function public.ad_my_summary(p_from date default null) returns jsonb
language sql stable security definer set search_path = public as $$
  with every_one as (
    select c.id, c.status, c.stats_multiplier as m, c.advertiser_hidden_at as hidden from public.ad_campaigns c join public.advertisers a on a.id = c.advertiser_id
     where a.user_id = auth.uid() and c.status <> 'cancelled'
  ), mine as (
    select * from every_one where hidden is null
  ), stats as (
    select coalesce(sum(s.impressions * e.m), 0) as impressions, coalesce(sum(s.clicks * e.m), 0) as clicks,
           coalesce(sum(s.reward_completes * e.m), 0) as reward_completes, coalesce(sum(s.video_completes * e.m), 0) as video_completes,
           coalesce(sum(s.conversions * e.m), 0) as conversions, coalesce(sum(s.outbounds * e.m), 0) as outbounds
      from public.ad_campaign_daily_stats s join every_one e on e.id = s.campaign_id where (p_from is null or s.day >= p_from)
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
    'boosted', (select count(*) from every_one where m > 1),
    'spend_usd_cents', (select usd_cents from spend));
$$;

do $$
begin
  revoke all on function public.ad_my_summary(date) from public, anon;
  grant execute on function public.ad_my_summary(date) to authenticated, service_role;
end $$;
