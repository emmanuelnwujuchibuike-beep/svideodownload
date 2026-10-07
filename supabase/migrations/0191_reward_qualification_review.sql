-- ═══════════════════════════════════════════════════════════════════════════
--  0191 — withdrawal qualification is applied for and granted by an admin (2026-10-07)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "they can apply for withdrawal when they qualify, and admin reviews and
-- grants their account qualification, and from there they can withdraw" -
-- and "admin can track users' accounts, whether they reached the requirement,
-- account activity calculated every day, week and month, and show progress".
--
--   1. reward_profiles.qualification_status - none | applied | approved | rejected,
--      with when it was applied for, reviewed, by whom, and a note.
--   2. grant_reward (0189's) WITHOUT the automatic qualification: meeting the
--      thresholds now lets a member APPLY. qualified_at is set only by an admin's
--      approval. Rewards granted before approval stay usable (never re-classed).
--   3. rewards_admin_members(limit) - each member's progress and activity in
--      the last day, week and month, computed when the admin opens the tab (no timer).
--
-- Members already auto-qualified under 0187/0189 are kept as approved.
-- No semicolon inside any quoted string (the 0186 lesson).

alter table public.reward_profiles add column if not exists qualification_status text not null default 'none';
alter table public.reward_profiles add column if not exists qualification_applied_at timestamptz;
alter table public.reward_profiles add column if not exists qualification_reviewed_at timestamptz;
alter table public.reward_profiles add column if not exists qualification_reviewed_by uuid;
alter table public.reward_profiles add column if not exists qualification_note text;
alter table public.reward_profiles drop constraint if exists reward_profiles_qualification_status_chk;
alter table public.reward_profiles add constraint reward_profiles_qualification_status_chk check (qualification_status in ('none', 'applied', 'approved', 'rejected'));
update public.reward_profiles set qualification_status = 'approved' where qualified_at is not null and qualification_status <> 'approved';
create index if not exists reward_profiles_qualification_idx on public.reward_profiles (qualification_status, qualification_applied_at);

-- ── the engine, without automatic qualification ──
create or replace function public.grant_reward(
  p_beneficiary uuid, p_role text, p_event text, p_source_type text, p_source_id text,
  p_actor uuid, p_referred uuid, p_amount integer, p_dedupe text, p_cfg jsonb, p_metadata jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_profile   public.reward_profiles%rowtype;
  v_created   timestamptz;
  v_min_days  integer := coalesce(nullif(p_cfg #>> '{qualification,minAccountAgeDays}', '')::integer, 30);
  v_min_eng   integer := coalesce(nullif(p_cfg #>> '{qualification,minEngagements}', '')::integer, 100);
  v_version   integer := coalesce(nullif(p_cfg ->> 'version', '')::integer, 1);
  v_class     text;
  v_id        uuid;
  v_wallet    text;
  v_balance   bigint;
  v_wpart     bigint;
begin
  if p_beneficiary is null or p_amount is null or p_amount <= 0 then return null; end if;
  perform pg_advisory_xact_lock(hashtext('rewards:' || p_beneficiary::text));

  insert into public.reward_profiles (user_id) values (p_beneficiary) on conflict (user_id) do nothing;
  select * into v_profile from public.reward_profiles where user_id = p_beneficiary for update;
  if v_profile.restricted then return null; end if;

  -- 0191: qualification is GRANTED BY AN ADMIN after the member applies (owner 2026-10-07) - never automatically here.
  -- The class is still decided NOW from qualified_at, and a past reward is never re-classed.
  v_class := case when v_profile.qualified_at is not null then 'withdrawable' else 'usable' end;

  -- the once-only row — its unique index IS the idempotency
  insert into public.reward_events (beneficiary_id, role, event_type, source_type, source_id, actor_user_id, referred_user_id, amount, credit_class, qualified_at_event, rule_version, dedupe_key, metadata)
  values (p_beneficiary, p_role, p_event, p_source_type, p_source_id, p_actor, p_referred, p_amount, v_class, v_profile.qualified_at is not null, v_version, p_dedupe, coalesce(p_metadata, '{}'::jsonb))
  on conflict (beneficiary_id, role, event_type, dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then return null; end if;

  -- the wallet: the one balance, the cashable part when withdrawable
  insert into public.ai_product_balances (user_id, product, balance_cents, currency) values (p_beneficiary, 'character_replace', 0, 'CREDIT') on conflict (user_id, product) do nothing;
  select currency into v_wallet from public.ai_product_balances where user_id = p_beneficiary and product = 'character_replace' for update;
  if v_wallet <> 'CREDIT' then raise exception 'wallet unit mismatch: wallet is %, reward is CREDIT', v_wallet; end if;
  v_wpart := case when v_class = 'withdrawable' then p_amount else 0 end;
  update public.ai_product_balances
     set balance_cents = balance_cents + p_amount, withdrawable_cents = withdrawable_cents + v_wpart, updated_at = now()
   where user_id = p_beneficiary and product = 'character_replace'
  returning balance_cents into v_balance;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, metadata, credit_class, withdrawable_part)
  values (p_beneficiary, 'character_replace', 'grant', 'settled', p_amount, v_balance, 'CREDIT', 'reward:' || v_id::text, 'Reward · ' || replace(p_event, '_', ' '),
          jsonb_build_object('reward_id', v_id, 'event', p_event, 'role', p_role, 'source_type', p_source_type, 'source_id', p_source_id), v_class, v_wpart);

  -- 0189: running totals, so a member's earned figures never need a scan of reward_events
  update public.reward_profiles
     set earned_usable = earned_usable + case when v_class = 'usable' then p_amount else 0 end,
         earned_withdrawable = earned_withdrawable + case when v_class = 'withdrawable' then p_amount else 0 end
   where user_id = p_beneficiary;

  if p_role = 'referrer' then
    update public.reward_profiles set qualifying_engagements = qualifying_engagements + 1, updated_at = now() where user_id = p_beneficiary;
  end if;

  -- in-app, in the same transaction (the push is sent by the server after commit)
  insert into public.notifications (user_id, actor_id, type, data)
  values (p_beneficiary, case when p_role = 'referrer' then p_actor else null end, case when p_role = 'referrer' then 'referral_reward' else 'reward_earned' end,
          jsonb_build_object('reward_id', v_id, 'event', p_event, 'credits', p_amount, 'credit_class', v_class, 'source_type', p_source_type, 'source_id', p_source_id,
            'title', 'You earned ' || p_amount || case when p_amount = 1 then ' credit' else ' credits' end,
            'body', case when p_role = 'referrer' then 'Someone you invited: ' else '' end || initcap(replace(p_event, '_', ' ')) || case when v_class = 'withdrawable' then ' · withdrawable' else '' end,
            'url', '/studio/ai/usage'));

  return jsonb_build_object('reward_id', v_id, 'beneficiary_id', p_beneficiary, 'role', p_role, 'event', p_event, 'amount', p_amount, 'credit_class', v_class, 'balance_after', v_balance);
end;
$$;

-- the admin's member list: progress against the thresholds and activity over a day, a week and a month
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
      floor(extract(epoch from (now() - u.created_at)) / 86400)::integer as account_age_days,
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

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.grant_reward(uuid, text, text, text, text, uuid, uuid, integer, text, jsonb, jsonb)',
    'public.rewards_admin_members(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
