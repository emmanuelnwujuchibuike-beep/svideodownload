-- 0245: the withdrawal rule counts ACTIVE days, not days since sign-up (owner, 2026-10-15).
-- The member-facing and apply checks read streaks.total_active_days in code (lib/rewards/active-days.ts);
-- this replaces the admin member list so its progress meter shows the same number.
-- The rule's config key stays qualification.minAccountAgeDays (default 30) so every stored config keeps working.
-- Re-runnable; grants are unchanged (service_role only, set in 0191).

create or replace function public.rewards_admin_members(p_limit integer) returns jsonb
language sql security definer set search_path = public stable as $$
  select coalesce(jsonb_agg(m order by m.rank_status, m.engagements desc), '[]'::jsonb)
  from (
    select
      p.user_id,
      case p.qualification_status when 'applied' then 0 when 'approved' then 2 else 1 end as rank_status,
      p.qualification_status as status,
      p.qualification_applied_at as applied_at,
      p.qualified_at,
      p.restricted,
      p.qualifying_engagements as engagements,
      p.earned_usable,
      p.earned_withdrawable,
      u.created_at as account_created_at,
      coalesce((select s.total_active_days from public.streaks s where s.user_id = p.user_id), 0)::integer as active_days,
      (select count(*) from public.reward_events e where e.beneficiary_id = p.user_id and e.role = 'referrer' and e.created_at >= now() - interval '1 day') as referral_day,
      (select count(*) from public.reward_events e where e.beneficiary_id = p.user_id and e.role = 'referrer' and e.created_at >= now() - interval '7 days') as referral_week,
      (select count(*) from public.reward_events e where e.beneficiary_id = p.user_id and e.role = 'referrer' and e.created_at >= now() - interval '30 days') as referral_month,
      (select count(*) from public.reward_events e where e.beneficiary_id = p.user_id and e.role = 'actor' and e.created_at >= now() - interval '1 day') as own_day,
      (select count(*) from public.reward_events e where e.beneficiary_id = p.user_id and e.role = 'actor' and e.created_at >= now() - interval '7 days') as own_week,
      (select count(*) from public.reward_events e where e.beneficiary_id = p.user_id and e.role = 'actor' and e.created_at >= now() - interval '30 days') as own_month,
      (select coalesce(sum(b.withdrawable_cents), 0) from public.ai_product_balances b where b.user_id = p.user_id and b.product = 'character_replace') as withdrawable_now
    from public.reward_profiles p
    join auth.users u on u.id = p.user_id
    order by case p.qualification_status when 'applied' then 0 when 'approved' then 2 else 1 end, p.qualifying_engagements desc
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  ) m
$$;
