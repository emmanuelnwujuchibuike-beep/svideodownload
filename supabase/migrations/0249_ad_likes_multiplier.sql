-- 0249 — a full-screen ad's LIKES follow the admin's x10 sample mode, like its views (owner 2026-10-16:
-- "make ad likes also take effect in the x10 multiplier when is turned on").
--
-- ad_engagement (0246) re-created with one change: 'likes' = the stored likes x the campaign's
-- stats_multiplier (1 when the switch is off), exactly as 'views' already is. Display only, like the
-- views: ad_campaign_engagement keeps the real count, nothing is written, and the advertiser's billing
-- never reads this. Shares are unchanged. Same signature, same grants (service role only).
--
-- Idempotent. No semicolon inside any quoted string. Every dollar-quoted block is at the end.

create or replace function public.ad_engagement(p_campaign uuid, p_actor text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ok', true,
    'views', coalesce((select sum(d.impressions)::bigint from public.ad_campaign_daily_stats d where d.campaign_id = c.id), 0)
             * greatest(1, coalesce((to_jsonb(c) ->> 'stats_multiplier')::integer, 1)),
    'likes', coalesce(e.likes, 0)::bigint * greatest(1, coalesce((to_jsonb(c) ->> 'stats_multiplier')::integer, 1)),
    'shares', coalesce(e.shares, 0),
    'liked', p_actor is not null and exists (select 1 from public.ad_campaign_reactions r where r.campaign_id = c.id and r.kind = 'like' and r.actor_key = p_actor))
  from public.ad_campaigns c
  left join public.ad_campaign_engagement e on e.campaign_id = c.id
  where c.id = p_campaign;
$$;

do $$
begin
  execute 'revoke all on function public.ad_engagement(uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.ad_engagement(uuid, text) to service_role';
end $$;
