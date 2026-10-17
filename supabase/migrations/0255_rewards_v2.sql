-- 0255 — Rewards v2 (owner, 2026-10-16): "Remove all rewards for credits and quests and only use
-- these: sharing of link and user signed in 5 credits (adjustable), user top up or subscribe 10
-- credits (adjustable), get 100 followers 5 credits, 1k followers 50 credits, above 5k followers
-- contact support for creator earning upgrade and an affiliate programme where they gain 10% from
-- any user's transaction they bring ... only 5k followers (adjustable) can qualify." And: "Existing
-- balance should be changed", "credits earned should also show in notification and AI history".
--
--   1 · THE RULES  settings.landing.frenzRewards (mirrored into reward_config by 0189's trigger):
--       every event OFF except account_created (5 to the new member once, 5 to whoever invited
--       them), wallet_topup and subscription_started (10 to the inviter, every time). Quests OFF.
--       Weekly AI prizes OFF. New blocks: followers (100 -> 5, 1000 -> 50), affiliate (10%, 5000
--       real followers). Applied ONCE (rulesV2Applied) so a re-run never undoes the admin's later
--       adjustments.
--   2 · FOLLOWER MILESTONES  real_follower_count(): followers that are not suspended or hidden,
--       with a confirmed email, at least N days old (adjustable, 7). award_follower_milestones()
--       pays each milestone once through grant_reward (so it reaches the wallet, the AI history and
--       a notification), from a trigger on follows and from the 10-minute sweep.
--   3 · AFFILIATES  affiliate_accounts (admin-approved, rate in basis points) and
--       affiliate_commissions: every SETTLED payment (ai_topup_attempts: top-ups, AI plans, ad
--       campaigns — private-post subscriptions are another table and never counted) by a member an
--       approved affiliate invited is QUEUED by trigger, once per payment reference. The server
--       converts it to USD and grant_affiliate_commission() pays 10% of it as WITHDRAWABLE credits,
--       once, with its own reward row, ledger line and notification.
--   4 · RECOMPUTE  recompute_rewards_v2(): once per member (reward_recompute_log). Takes back the
--       UNSPENT part of credits from rewards that no longer exist — reward credits count as spent
--       first, so bought credits are never taken and nothing goes below zero — then pays what the
--       new rules owe that was never paid. A preview mode writes nothing. Run by an admin, in
--       batches, from the admin panel.
--
-- Additive: new tables (RLS on, owner-read where it helps), new functions (service role only),
-- one config change applied once. No reward, ledger or wallet row is rewritten by the migration
-- itself — the recompute is an explicit admin action.
-- No semicolon inside any quoted string. Every dollar-quoted block is at the end.

create table if not exists public.affiliate_accounts (
  user_id                  uuid primary key references auth.users (id) on delete cascade,
  status                   text not null default 'pending',
  rate_bp                  integer not null default 1000,
  real_followers_at_review integer,
  requested_at             timestamptz not null default now(),
  reviewed_by              uuid references auth.users (id) on delete set null,
  reviewed_at              timestamptz,
  note                     text,
  updated_at               timestamptz not null default now()
);
alter table public.affiliate_accounts enable row level security;

create table if not exists public.affiliate_commissions (
  reference        text primary key,
  affiliate_id     uuid not null references auth.users (id) on delete cascade,
  referred_user_id uuid not null references auth.users (id) on delete cascade,
  purpose          text not null,
  amount_minor     bigint not null,
  currency         text not null,
  fx_minor_per_usd bigint,
  rate_bp          integer not null,
  status           text not null default 'queued',
  usd_cents        bigint,
  credits          integer,
  reason           text,
  reward_event_id  uuid,
  created_at       timestamptz not null default now(),
  granted_at       timestamptz
);
create index if not exists affiliate_commissions_queued_idx on public.affiliate_commissions (created_at) where status = 'queued';
create index if not exists affiliate_commissions_affiliate_idx on public.affiliate_commissions (affiliate_id, created_at desc);
alter table public.affiliate_commissions enable row level security;

create table if not exists public.reward_recompute_log (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  removable      bigint not null,
  removed        bigint not null,
  added          bigint not null,
  balance_before bigint not null,
  balance_after  bigint not null,
  actor_id       uuid references auth.users (id) on delete set null,
  applied_at     timestamptz not null default now()
);
alter table public.reward_recompute_log enable row level security;
revoke all on table public.reward_recompute_log from anon, authenticated;

create table if not exists public.follower_milestone_checks (
  user_id    uuid not null references auth.users (id) on delete cascade,
  threshold  integer not null,
  checked_at timestamptz not null default now(),
  primary key (user_id, threshold)
);
alter table public.follower_milestone_checks enable row level security;
revoke all on table public.follower_milestone_checks from anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
begin
  begin
    alter table public.affiliate_accounts add constraint affiliate_accounts_chk check (status in ('pending', 'approved', 'declined', 'revoked') and rate_bp between 0 and 5000);
  exception when duplicate_object then null;
  end;
  begin
    alter table public.affiliate_commissions add constraint affiliate_commissions_chk check (
      status in ('queued', 'granted', 'skipped') and purpose in ('wallet_topup', 'ai_subscription', 'ad_campaign')
      and amount_minor > 0 and rate_bp between 0 and 5000 and (credits is null or credits >= 0) and affiliate_id <> referred_user_id);
  exception when duplicate_object then null;
  end;
  -- owners read their own affiliate status and commissions; every write is the server's
  execute 'drop policy if exists "affiliate accounts owner read" on public.affiliate_accounts';
  execute 'create policy "affiliate accounts owner read" on public.affiliate_accounts for select using ((select auth.uid()) = user_id)';
  execute 'drop policy if exists "affiliate commissions owner read" on public.affiliate_commissions';
  execute 'create policy "affiliate commissions owner read" on public.affiliate_commissions for select using ((select auth.uid()) = affiliate_id)';
  execute 'revoke insert, update, delete on table public.affiliate_accounts from anon, authenticated';
  execute 'revoke insert, update, delete on table public.affiliate_commissions from anon, authenticated';
end;
$$;

-- 1 · the rules, once
do $$
declare
  v_value  jsonb;
  v_fr     jsonb;
  v_events jsonb := '{}'::jsonb;
  v_e      text;
begin
  select value into v_value from public.settings where key = 'landing';
  if v_value is null then return; end if;
  v_fr := coalesce(v_value -> 'frenzRewards', '{}'::jsonb);
  if coalesce((v_fr ->> 'rulesV2Applied')::boolean, false) then return; end if;
  foreach v_e in array array['account_created', 'download_completed', 'ai_video_completed', 'ai_audio_completed', 'ai_image_completed', 'ai_avatar_completed', 'ai_video_shared',
                             'post_engagement', 'reel_engagement', 'profile_engagement', 'follow', 'save', 'subscription_started', 'wallet_topup'] loop
    v_events := v_events || jsonb_build_object(v_e, coalesce(v_fr -> 'events' -> v_e, '{}'::jsonb) || '{"enabled": false}'::jsonb);
  end loop;
  v_events := v_events
    || jsonb_build_object('account_created', '{"enabled": true, "actorCredits": 5, "referrerCredits": 5, "referrerRepeatable": false, "actorOncePerUser": true}'::jsonb)
    || jsonb_build_object('wallet_topup', '{"enabled": true, "actorCredits": 0, "referrerCredits": 10, "referrerRepeatable": true, "actorOncePerUser": false}'::jsonb)
    || jsonb_build_object('subscription_started', '{"enabled": true, "actorCredits": 0, "referrerCredits": 10, "referrerRepeatable": true, "actorOncePerUser": false}'::jsonb);
  v_fr := v_fr || jsonb_build_object(
    'enabled', true,
    'events', v_events,
    'quests', coalesce(v_fr -> 'quests', '{}'::jsonb) || '{"enabled": false}'::jsonb,
    'weeklyPrizes', '{"enabled": false}'::jsonb,
    'followers', '{"enabled": true, "minAccountAgeDays": 7, "milestones": [{"followers": 100, "credits": 5}, {"followers": 1000, "credits": 50}]}'::jsonb,
    'affiliate', '{"enabled": true, "rateBp": 1000, "minFollowers": 5000}'::jsonb,
    'rulesV2Applied', true);
  update public.settings set value = v_value || jsonb_build_object('frenzRewards', v_fr) where key = 'landing';
end;
$$;

-- 1b · the engine's built-in defaults (used for an event with no stored rule) become v2's too, so the
-- SQL and lib/rewards/config.ts REWARDS_DEFAULTS stay the same numbers (rewards.test.ts checks both)
create or replace function public.reward_default_rule(p_event text) returns jsonb
language sql immutable as $$
  select case p_event
    when 'account_created'      then '{"enabled":true,"actorCredits":5,"referrerCredits":5,"referrerRepeatable":false,"actorOncePerUser":true}'::jsonb
    when 'wallet_topup'         then '{"enabled":true,"actorCredits":0,"referrerCredits":10,"referrerRepeatable":true,"actorOncePerUser":false}'::jsonb
    when 'subscription_started' then '{"enabled":true,"actorCredits":0,"referrerCredits":10,"referrerRepeatable":true,"actorOncePerUser":false}'::jsonb
    else '{"enabled":false,"actorCredits":0,"referrerCredits":0,"referrerRepeatable":false}'::jsonb
  end
$$;

-- 2 · real followers and their milestones
create or replace function public.real_follower_count(p_user uuid, p_min_age_days integer) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer
    from public.follows f
    join public.profiles p on p.id = f.follower_id
    join auth.users u on u.id = f.follower_id
   where f.following_id = p_user
     and coalesce(p.is_suspended, false) = false
     and coalesce(p.is_hidden, false) = false
     and u.email_confirmed_at is not null
     and u.created_at <= now() - make_interval(days => greatest(0, coalesce(p_min_age_days, 7)))
$$;

create or replace function public.award_follower_milestones(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cfg   jsonb;
  v_f     jsonb;
  v_m     record;
  v_count integer;
  v_out   jsonb := '[]'::jsonb;
  v_r     jsonb;
begin
  if p_user is null then return v_out; end if;
  select rules into v_cfg from public.reward_config where id;
  v_cfg := coalesce(v_cfg, '{}'::jsonb);
  if coalesce((v_cfg ->> 'enabled')::boolean, true) = false then return v_out; end if;
  v_f := coalesce(v_cfg -> 'followers', '{}'::jsonb);
  if coalesce((v_f ->> 'enabled')::boolean, false) = false then return v_out; end if;
  for v_m in
    select (x ->> 'followers')::integer as followers, (x ->> 'credits')::integer as credits
      from jsonb_array_elements(coalesce(v_f -> 'milestones', '[]'::jsonb)) x
     where coalesce((x ->> 'followers')::integer, 0) > 0 and coalesce((x ->> 'credits')::integer, 0) > 0
     order by 1
  loop
    if exists (select 1 from public.reward_events where beneficiary_id = p_user and role = 'actor' and event_type = 'followers_milestone' and dedupe_key = 'followers:' || v_m.followers) then
      continue;
    end if;
    if v_count is null then v_count := public.real_follower_count(p_user, nullif(v_f ->> 'minAccountAgeDays', '')::integer); end if;
    insert into public.follower_milestone_checks (user_id, threshold, checked_at) values (p_user, v_m.followers, now())
    on conflict (user_id, threshold) do update set checked_at = now();
    exit when v_count < v_m.followers;
    v_r := public.grant_reward(p_user, 'actor', 'followers_milestone', 'followers', v_m.followers::text, p_user, null, v_m.credits,
             'followers:' || v_m.followers, v_cfg, jsonb_build_object('followers', v_m.followers, 'real_followers', v_count));
    if v_r is not null then v_out := v_out || jsonb_build_array(v_r); end if;
  end loop;
  return v_out;
end;
$$;

-- a new follow: a cheap check on the raw count first, the real count only when a milestone could be due
create or replace function public.follows_milestone_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_raw integer;
begin
  select followers_count into v_raw from public.profiles where id = new.following_id;
  if coalesce(v_raw, 0) + 1 >= 100 then
    begin
      perform public.award_follower_milestones(new.following_id);
    exception when others then
      raise warning 'follower milestone check failed: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

-- the 10-minute sweep: members whose raw count passed a milestone they were not paid for, each
-- re-checked at most once a day (a follower who was too new last time may count now).
-- Returns what it granted (grant_reward's rows) so the cron can send the push.
drop function if exists public.sweep_follower_milestones(integer);
create or replace function public.sweep_follower_milestones(p_limit integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cfg   jsonb;
  v_t     integer;
  v_user  uuid;
  v_out   jsonb := '[]'::jsonb;
begin
  select rules into v_cfg from public.reward_config where id;
  if coalesce((v_cfg -> 'followers' ->> 'enabled')::boolean, false) = false then return v_out; end if;
  for v_t in select (x ->> 'followers')::integer from jsonb_array_elements(coalesce(v_cfg -> 'followers' -> 'milestones', '[]'::jsonb)) x where coalesce((x ->> 'followers')::integer, 0) > 0 loop
    for v_user in
      select p.id from public.profiles p
       where p.followers_count >= v_t
         and not exists (select 1 from public.reward_events e where e.beneficiary_id = p.id and e.role = 'actor' and e.event_type = 'followers_milestone' and e.dedupe_key = 'followers:' || v_t)
         and not exists (select 1 from public.follower_milestone_checks c where c.user_id = p.id and c.threshold = v_t and c.checked_at > now() - interval '1 day')
       limit greatest(1, least(coalesce(p_limit, 50), 200))
    loop
      v_out := v_out || public.award_follower_milestones(v_user);
    end loop;
  end loop;
  return v_out;
end;
$$;

-- 3 · affiliates: queue every settled payment of an approved affiliate's invitee, once
create or replace function public.queue_affiliate_commission() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_ref  uuid;
  v_rate integer;
begin
  if new.status = 'success' and (tg_op = 'INSERT' or old.status is distinct from 'success')
     and coalesce(new.purpose, 'wallet_topup') in ('wallet_topup', 'ai_subscription', 'ad_campaign') then
    begin
      select a.referrer_id into v_ref from public.referral_attributions a where a.referred_user_id = new.user_id and a.status = 'active';
      if v_ref is not null and v_ref <> new.user_id then
        select rate_bp into v_rate from public.affiliate_accounts where user_id = v_ref and status = 'approved';
        if v_rate is not null and v_rate > 0 then
          insert into public.affiliate_commissions (reference, affiliate_id, referred_user_id, purpose, amount_minor, currency, fx_minor_per_usd, rate_bp)
          values (new.reference, v_ref, new.user_id, coalesce(new.purpose, 'wallet_topup'), new.amount_cents, new.currency, new.fx_minor_per_usd, v_rate)
          on conflict (reference) do nothing;
        end if;
      end if;
    exception when others then
      -- a commission can never cost a member their payment
      raise warning 'affiliate commission queue failed: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

-- pay one queued commission: always WITHDRAWABLE, once, re-checking the affiliate at pay time
create or replace function public.grant_affiliate_commission(p_reference text, p_usd_cents bigint, p_credits_per_usd integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_c       public.affiliate_commissions%rowtype;
  v_ok      boolean;
  v_credits bigint;
  v_id      uuid;
  v_wallet  text;
  v_balance bigint;
begin
  select * into v_c from public.affiliate_commissions where reference = p_reference for update;
  if v_c.reference is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_c.status <> 'queued' then return jsonb_build_object('ok', true, 'duplicate', true, 'status', v_c.status); end if;
  -- still an approved affiliate, not suspended or restricted, and still this member's inviter
  select exists (
    select 1 from public.affiliate_accounts a
      join public.profiles p on p.id = a.user_id
     where a.user_id = v_c.affiliate_id and a.status = 'approved' and coalesce(p.is_suspended, false) = false)
    and not coalesce((select restricted from public.reward_profiles where user_id = v_c.affiliate_id), false)
    and exists (select 1 from public.referral_attributions r where r.referred_user_id = v_c.referred_user_id and r.referrer_id = v_c.affiliate_id and r.status = 'active')
  into v_ok;
  if not v_ok then
    update public.affiliate_commissions set status = 'skipped', reason = 'affiliate_not_active', usd_cents = p_usd_cents where reference = p_reference;
    return jsonb_build_object('ok', true, 'skipped', 'affiliate_not_active');
  end if;
  if p_usd_cents is null or p_usd_cents <= 0 or p_credits_per_usd is null or p_credits_per_usd <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  v_credits := (p_usd_cents * p_credits_per_usd * v_c.rate_bp) / (10000 * 100);
  if v_credits < 1 then
    update public.affiliate_commissions set status = 'skipped', reason = 'below_one_credit', usd_cents = p_usd_cents, credits = 0 where reference = p_reference;
    return jsonb_build_object('ok', true, 'skipped', 'below_one_credit');
  end if;

  insert into public.reward_events (beneficiary_id, role, event_type, source_type, source_id, actor_user_id, referred_user_id, amount, credit_class, qualified_at_event, rule_version, dedupe_key, metadata)
  values (v_c.affiliate_id, 'referrer', 'affiliate_commission', 'payment', p_reference, v_c.referred_user_id, v_c.referred_user_id, v_credits, 'withdrawable', true, 2, 'affiliate:' || p_reference,
          jsonb_build_object('purpose', v_c.purpose, 'usd_cents', p_usd_cents, 'rate_bp', v_c.rate_bp, 'amount_minor', v_c.amount_minor, 'currency', v_c.currency))
  on conflict (beneficiary_id, role, event_type, dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then
    update public.affiliate_commissions set status = 'granted', granted_at = coalesce(granted_at, now()) where reference = p_reference;
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  insert into public.ai_product_balances (user_id, product, balance_cents, currency) values (v_c.affiliate_id, 'character_replace', 0, 'CREDIT') on conflict (user_id, product) do nothing;
  select currency into v_wallet from public.ai_product_balances where user_id = v_c.affiliate_id and product = 'character_replace' for update;
  if v_wallet <> 'CREDIT' then raise exception 'wallet unit mismatch: wallet is %, commission is CREDIT', v_wallet; end if;
  update public.ai_product_balances set balance_cents = balance_cents + v_credits, withdrawable_cents = withdrawable_cents + v_credits, updated_at = now()
   where user_id = v_c.affiliate_id and product = 'character_replace' returning balance_cents into v_balance;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, metadata, credit_class, withdrawable_part)
  values (v_c.affiliate_id, 'character_replace', 'grant', 'settled', v_credits, v_balance, 'CREDIT', 'reward:' || v_id::text,
          'Affiliate · ' || (v_c.rate_bp / 100)::text || '% of an invited member''s ' || case v_c.purpose when 'wallet_topup' then 'top-up' when 'ai_subscription' then 'AI plan' else 'ad payment' end,
          jsonb_build_object('reward_id', v_id, 'event', 'affiliate_commission', 'role', 'referrer', 'source_type', 'payment', 'source_id', p_reference), 'withdrawable', v_credits);
  insert into public.reward_profiles (user_id) values (v_c.affiliate_id) on conflict (user_id) do nothing;
  update public.reward_profiles set earned_withdrawable = earned_withdrawable + v_credits, updated_at = now() where user_id = v_c.affiliate_id;
  update public.affiliate_commissions set status = 'granted', usd_cents = p_usd_cents, credits = v_credits, reward_event_id = v_id, granted_at = now() where reference = p_reference;
  insert into public.notifications (user_id, actor_id, type, data)
  values (v_c.affiliate_id, v_c.referred_user_id, 'referral_reward',
          jsonb_build_object('reward_id', v_id, 'event', 'affiliate_commission', 'credits', v_credits, 'credit_class', 'withdrawable',
            'title', 'You earned ' || v_credits || case when v_credits = 1 then ' credit' else ' credits' end,
            'body', 'Affiliate: ' || (v_c.rate_bp / 100)::text || '% of a payment by someone you invited · withdrawable',
            'url', '/studio/ai/usage'));
  return jsonb_build_object('ok', true, 'reward_id', v_id, 'credits', v_credits, 'beneficiary_id', v_c.affiliate_id);
end;
$$;

-- 4 · the one-time recompute for one member (preview when p_apply is false: nothing is written)
create or replace function public.recompute_rewards_v2(p_user uuid, p_apply boolean, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cfg        jsonb;
  v_removable  bigint;
  v_kept       bigint;
  v_other_in   bigint;
  v_balance    bigint := 0;
  v_wd         bigint := 0;
  v_unspent    bigint;
  v_remove     bigint;
  v_take_wd    bigint;
  v_signup     integer;
  v_ref_signup integer;
  v_ref_pay    integer;
  v_added      bigint := 0;
  v_after      bigint;
  v_r          jsonb;
  v_row        record;
  v_due_signup boolean;
  v_due_refs   integer;
  v_due_pays   integer;
begin
  if p_user is null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if exists (select 1 from public.reward_recompute_log where user_id = p_user) then return jsonb_build_object('ok', true, 'done', true); end if;
  select rules into v_cfg from public.reward_config where id;
  v_cfg := coalesce(v_cfg, '{}'::jsonb);
  v_signup     := greatest(0, coalesce((v_cfg #>> '{events,account_created,actorCredits}')::integer, 5));
  v_ref_signup := greatest(0, coalesce((v_cfg #>> '{events,account_created,referrerCredits}')::integer, 5));
  v_ref_pay    := greatest(0, coalesce((v_cfg #>> '{events,wallet_topup,referrerCredits}')::integer, 10));

  perform pg_advisory_xact_lock(hashtext('rewards:' || p_user::text));
  -- what the old rules paid that the new rules don't
  select coalesce(sum(amount) filter (where not (
            event_type in ('account_created', 'followers_milestone', 'affiliate_commission', 'rewards_v2_catchup')
            or (event_type in ('wallet_topup', 'subscription_started') and role = 'referrer'))), 0),
         coalesce(sum(amount) filter (where
            event_type in ('account_created', 'followers_milestone', 'affiliate_commission', 'rewards_v2_catchup')
            or (event_type in ('wallet_topup', 'subscription_started') and role = 'referrer')), 0)
    into v_removable, v_kept
    from public.reward_events where beneficiary_id = p_user;
  select balance_cents, withdrawable_cents into v_balance, v_wd from public.ai_product_balances where user_id = p_user and product = 'character_replace' for update;
  v_balance := coalesce(v_balance, 0);
  v_wd := coalesce(v_wd, 0);
  -- every credit in that is NOT a reward (bought, refunded, sent by a friend, admin) plus the rewards that stay
  select coalesce(sum(delta_cents), 0) into v_other_in from public.ai_product_ledger
   where user_id = p_user and product = 'character_replace' and delta_cents > 0 and coalesce(reference, '') not like 'reward:%';
  v_other_in := v_other_in + v_kept;
  -- removable rewards are spent FIRST: what is left of them is the balance above everything else
  v_unspent := greatest(0, v_balance - v_other_in);
  v_remove := least(v_removable, v_unspent, v_balance);

  -- what the new rules owe that was never paid (same once-only keys as the engine)
  v_due_signup := v_signup > 0 and not exists (select 1 from public.reward_events where beneficiary_id = p_user and role = 'actor' and event_type = 'account_created');
  select count(*) into v_due_refs from public.referral_attributions a
   where a.referrer_id = p_user and a.status = 'active'
     and not exists (select 1 from public.reward_events e where e.beneficiary_id = p_user and e.role = 'referrer' and e.event_type = 'account_created' and e.referred_user_id = a.referred_user_id);
  select count(*) into v_due_pays from public.ai_topup_attempts t
    join public.referral_attributions a on a.referred_user_id = t.user_id and a.referrer_id = p_user and a.status = 'active'
   where t.status = 'success' and coalesce(t.purpose, 'wallet_topup') in ('wallet_topup', 'ai_subscription')
     and not exists (select 1 from public.reward_events e where e.beneficiary_id = p_user and e.role = 'referrer' and e.event_type in ('wallet_topup', 'subscription_started', 'rewards_v2_catchup') and e.source_id = t.reference);

  if not coalesce(p_apply, false) then
    return jsonb_build_object('ok', true, 'preview', true, 'removable', v_removable, 'remove', v_remove, 'balance', v_balance,
      'add_signup', case when v_due_signup then v_signup else 0 end, 'add_referral_signups', v_due_refs * v_ref_signup, 'add_referral_payments', v_due_pays * v_ref_pay);
  end if;

  -- take back the unspent part (the usable part first, then the cashable part)
  if v_remove > 0 then
    v_take_wd := greatest(0, v_remove - (v_balance - v_wd));
    update public.ai_product_balances set balance_cents = balance_cents - v_remove, withdrawable_cents = withdrawable_cents - v_take_wd, updated_at = now()
     where user_id = p_user and product = 'character_replace' returning balance_cents into v_after;
    insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, actor_admin_id, metadata, withdrawable_part)
    values (p_user, 'character_replace', 'adjustment', 'settled', -v_remove, v_after, 'CREDIT', 'rewards_v2:' || p_user::text,
            'Rewards update · credits from rewards that ended (new rules)', p_actor, jsonb_build_object('removable', v_removable, 'removed', v_remove), v_take_wd);
  end if;

  -- pay what is owed, each through grant_reward (wallet, AI history, notification)
  if v_due_signup then
    v_r := public.grant_reward(p_user, 'actor', 'account_created', 'account', p_user::text, p_user, null, v_signup, 'member', v_cfg, jsonb_build_object('rewards_v2', true));
    v_added := v_added + coalesce((v_r ->> 'amount')::bigint, 0);
  end if;
  for v_row in
    select a.referred_user_id from public.referral_attributions a
     where a.referrer_id = p_user and a.status = 'active'
       and not exists (select 1 from public.reward_events e where e.beneficiary_id = p_user and e.role = 'referrer' and e.event_type = 'account_created' and e.referred_user_id = a.referred_user_id)
  loop
    if v_ref_signup > 0 then
      v_r := public.grant_reward(p_user, 'referrer', 'account_created', 'account', v_row.referred_user_id::text, v_row.referred_user_id, v_row.referred_user_id, v_ref_signup, v_row.referred_user_id::text, v_cfg, jsonb_build_object('rewards_v2', true));
      v_added := v_added + coalesce((v_r ->> 'amount')::bigint, 0);
    end if;
  end loop;
  for v_row in
    select t.reference, t.user_id from public.ai_topup_attempts t
      join public.referral_attributions a on a.referred_user_id = t.user_id and a.referrer_id = p_user and a.status = 'active'
     where t.status = 'success' and coalesce(t.purpose, 'wallet_topup') in ('wallet_topup', 'ai_subscription')
       and not exists (select 1 from public.reward_events e where e.beneficiary_id = p_user and e.role = 'referrer' and e.event_type in ('wallet_topup', 'subscription_started', 'rewards_v2_catchup') and e.source_id = t.reference)
  loop
    if v_ref_pay > 0 then
      v_r := public.grant_reward(p_user, 'referrer', 'rewards_v2_catchup', 'payment', v_row.reference, v_row.user_id, v_row.user_id, v_ref_pay, 'catchup:' || v_row.reference, v_cfg, jsonb_build_object('rewards_v2', true));
      v_added := v_added + coalesce((v_r ->> 'amount')::bigint, 0);
    end if;
  end loop;
  v_r := public.award_follower_milestones(p_user);
  select coalesce(sum((x ->> 'amount')::bigint), 0) + v_added into v_added from jsonb_array_elements(coalesce(v_r, '[]'::jsonb)) x;

  select coalesce(balance_cents, 0) into v_after from public.ai_product_balances where user_id = p_user and product = 'character_replace';
  insert into public.reward_recompute_log (user_id, removable, removed, added, balance_before, balance_after, actor_id)
  values (p_user, v_removable, v_remove, v_added, v_balance, coalesce(v_after, 0), p_actor);
  if v_remove > 0 then
    insert into public.notifications (user_id, type, data)
    values (p_user, 'reward_earned', jsonb_build_object('event', 'rewards_v2', 'credits', -v_remove,
      'title', 'Your rewards were updated',
      'body', 'Rewards now come from invites, sign-ups and followers. ' || v_remove || ' unspent credits from rewards that ended were removed' || case when v_added > 0 then ', and ' || v_added || ' were added under the new rules.' else '.' end,
      'url', '/studio/ai/usage'));
  end if;
  return jsonb_build_object('ok', true, 'removed', v_remove, 'added', v_added, 'balance_before', v_balance, 'balance_after', coalesce(v_after, 0));
end;
$$;

do $$
begin
  drop trigger if exists follows_milestone_trg on public.follows;
  create trigger follows_milestone_trg after insert on public.follows for each row execute function public.follows_milestone_check();
  drop trigger if exists ai_topup_attempts_affiliate_trg on public.ai_topup_attempts;
  create trigger ai_topup_attempts_affiliate_trg after insert or update of status on public.ai_topup_attempts for each row execute function public.queue_affiliate_commission();
  execute 'revoke all on function public.real_follower_count(uuid, integer) from public, anon, authenticated';
  execute 'revoke all on function public.award_follower_milestones(uuid) from public, anon, authenticated';
  execute 'revoke all on function public.follows_milestone_check() from public, anon, authenticated';
  execute 'revoke all on function public.sweep_follower_milestones(integer) from public, anon, authenticated';
  execute 'revoke all on function public.queue_affiliate_commission() from public, anon, authenticated';
  execute 'revoke all on function public.grant_affiliate_commission(text, bigint, integer) from public, anon, authenticated';
  execute 'revoke all on function public.recompute_rewards_v2(uuid, boolean, uuid) from public, anon, authenticated';
  execute 'grant execute on function public.real_follower_count(uuid, integer) to service_role';
  execute 'grant execute on function public.award_follower_milestones(uuid) to service_role';
  execute 'grant execute on function public.sweep_follower_milestones(integer) to service_role';
  execute 'grant execute on function public.grant_affiliate_commission(text, bigint, integer) to service_role';
  execute 'grant execute on function public.recompute_rewards_v2(uuid, boolean, uuid) to service_role';
end;
$$;
