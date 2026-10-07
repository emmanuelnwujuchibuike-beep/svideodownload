-- ═══════════════════════════════════════════════════════════════════════════
--  0189 — the reward engine, made cheap on the busy paths (2026-10-07)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Performance brief (part 2). The reward triggers fire on every like, save,
-- comment, follow and download, and each one read the rules with
-- settings.value -> frenzRewards, which unpacks the whole ~46 KB landing
-- settings value to reach ~2 KB of rules. And a member's earned totals were a
-- scan of reward_events on every rewards read.
--
--   1. reward_config - one row holding just the rules, kept in step with the
--      settings row by a trigger on every save. The engine reads that.
--   2. reward_profiles.earned_usable / earned_withdrawable - running totals
--      kept by grant_reward in the same transaction as the reward, backfilled
--      once from reward_events.
--   3. rewards_admin_totals(since) - the admin analytics summed in SQL instead
--      of shipping up to 20,000 rows to the server to add up.
--
-- Behaviour is unchanged: the same rules, the same once-only index, the same
-- classes. No semicolon inside any quoted string (the 0186 lesson).

create table if not exists public.reward_config (
  id         boolean primary key default true,
  rules      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint reward_config_single_row_chk check (id)
);
alter table public.reward_config enable row level security;
revoke all on public.reward_config from public, anon, authenticated;
grant all on public.reward_config to service_role;
insert into public.reward_config (id, rules)
select true, coalesce((select value -> 'frenzRewards' from public.settings where key = 'landing'), '{}'::jsonb)
on conflict (id) do update set rules = excluded.rules, updated_at = now();
comment on table public.reward_config is 'The reward rules alone (0189) - a mirror of settings.landing frenzRewards, kept in step by a trigger, read by process_reward_event.';

alter table public.reward_profiles add column if not exists earned_usable bigint not null default 0;
alter table public.reward_profiles add column if not exists earned_withdrawable bigint not null default 0;

create index if not exists reward_events_event_created_idx on public.reward_events (event_type, created_at desc);
create index if not exists withdrawal_requests_status_created_idx on public.withdrawal_requests (status, created_at);
-- the AI Reels tab (/api/reels?content=ai) and the admin count read only the AI posts - a small partial index
create index if not exists posts_ai_video_created_idx on public.posts (created_at desc) where content_type = 'ai_video';

-- ── the engine: reads the small rules row, keeps the running totals ──
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

  -- qualification, decided NOW and written once (never re-evaluated for past rewards)
  if v_profile.qualified_at is null then
    select created_at into v_created from auth.users where id = p_beneficiary;
    if v_created is not null and v_created <= now() - make_interval(days => greatest(0, v_min_days)) and v_profile.qualifying_engagements >= greatest(0, v_min_eng) then
      update public.reward_profiles set qualified_at = now(), updated_at = now() where user_id = p_beneficiary returning * into v_profile;
    end if;
  end if;
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

create or replace function public.process_reward_event(
  p_event text, p_actor uuid, p_source_type text, p_source_id text, p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cfg       jsonb;
  v_rule      jsonb;
  v_actor_amt integer;
  v_ref_amt   integer;
  v_referrer  uuid;
  v_out       jsonb := '[]'::jsonb;
  v_r         jsonb;
  v_job       record;
  v_min       numeric;
begin
  if p_event is null or p_actor is null or p_source_id is null then return v_out; end if;
  -- 0189: the rules from their own small row (kept in step with settings.landing by a trigger),
  -- not the whole landing settings value unpacked on every like, follow and comment
  select rules into v_cfg from public.reward_config where id;
  v_cfg := coalesce(v_cfg, '{}'::jsonb);
  if coalesce((v_cfg ->> 'enabled')::boolean, true) = false then return v_out; end if;
  v_rule := public.reward_default_rule(p_event) || coalesce(v_cfg -> 'events' -> p_event, '{}'::jsonb);
  if coalesce((v_rule ->> 'enabled')::boolean, false) = false then return v_out; end if;
  v_actor_amt := greatest(0, coalesce((v_rule ->> 'actorCredits')::integer, 0));
  v_ref_amt   := greatest(0, coalesce((v_rule ->> 'referrerCredits')::integer, 0));
  if v_actor_amt = 0 and v_ref_amt = 0 then return v_out; end if;

  -- 🔴 the facts, from the database
  if p_event = 'ai_video_completed' or p_event = 'ai_audio_completed' then
    select id, user_id, feature, status, funding_source, result_path into v_job from public.ai_jobs where id = p_source_id::uuid;
    if v_job.id is null or v_job.user_id is distinct from p_actor or v_job.status <> 'completed' or v_job.result_path is null then return v_out; end if;
    if p_event = 'ai_video_completed' and not (coalesce(v_rule -> 'features', '[]'::jsonb) ? v_job.feature) then return v_out; end if;
    if v_job.funding_source = 'free' and coalesce((v_rule ->> 'includeComplimentary')::boolean, false) = false then return v_out; end if;
  elsif p_event = 'ai_video_shared' then
    v_min := coalesce(nullif(v_rule ->> 'minDurationSeconds', '')::numeric, 30);
    perform 1 from public.ai_jobs j join public.posts p on p.ai_job_id = j.id
     where j.id = p_source_id::uuid and j.user_id = p_actor and p.publisher_id = p_actor and j.status = 'completed'
       and coalesce(j.result_duration, 0) >= v_min - 0.05 and p.content_type = 'ai_video' and p.status = 'published' and p.visibility = 'public';
    if not found then return v_out; end if;
  end if;

  -- the actor: once per source (a job, a post, a followee), or once ever for a once-per-member event
  if v_actor_amt > 0 then
    v_r := public.grant_reward(p_actor, 'actor', p_event, p_source_type, p_source_id, p_actor, null, v_actor_amt,
             case when coalesce((v_rule ->> 'actorOncePerUser')::boolean, false) then 'member' else p_source_type || ':' || p_source_id end, v_cfg, p_metadata);
    if v_r is not null then v_out := v_out || jsonb_build_array(v_r); end if;
  end if;

  -- the referrer: ONE referred member + ONE event type = ONE reward, unless the operator made it repeatable
  if v_ref_amt > 0 then
    select referrer_id into v_referrer from public.referral_attributions where referred_user_id = p_actor and status = 'active';
    if v_referrer is not null and v_referrer <> p_actor then
      v_r := public.grant_reward(v_referrer, 'referrer', p_event, p_source_type, p_source_id, p_actor, p_actor, v_ref_amt,
               case when coalesce((v_rule ->> 'referrerRepeatable')::boolean, false) then p_actor::text || ':' || p_source_type || ':' || p_source_id else p_actor::text end, v_cfg, p_metadata);
      if v_r is not null then v_out := v_out || jsonb_build_array(v_r); end if;
    end if;
  end if;
  return v_out;
end;
$$;

-- the mirror: every save of the landing settings refreshes the rules row
create or replace function public.reward_config_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.key = 'landing' then
    insert into public.reward_config (id, rules, updated_at) values (true, coalesce(new.value -> 'frenzRewards', '{}'::jsonb), now())
    on conflict (id) do update set rules = excluded.rules, updated_at = now()
    where public.reward_config.rules is distinct from excluded.rules;
  end if;
  return new;
end;
$$;

-- the admin analytics, summed where the rows live
create or replace function public.rewards_admin_totals(p_since timestamptz) returns jsonb
language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'clicks', coalesce((select sum(clicks) from public.share_links), 0),
    'signupsFromLinks', coalesce((select sum(signups) from public.share_links), 0),
    'referredAccounts', (select count(*) from public.referral_attributions where status = 'active'),
    'activeReferred30d', (select count(distinct referred_user_id) from public.reward_events where role = 'referrer' and created_at >= now() - interval '30 days'),
    'qualifyingEngagements', coalesce((select sum(qualifying_engagements) from public.reward_profiles), 0),
    'aiGenerationRewards', (select count(*) from public.reward_events where event_type = 'ai_video_completed' and role = 'actor' and created_at >= p_since),
    'aiShareRewards', (select count(*) from public.reward_events where event_type = 'ai_video_shared' and role = 'actor' and created_at >= p_since),
    'aiReels', (select count(*) from public.posts where content_type = 'ai_video' and status = 'published'),
    'aiVideoGenerations', (select count(*) from public.ai_jobs where feature in ('ai_text_to_video', 'ai_image_to_video', 'ai_lip_sync') and status = 'completed' and created_at >= p_since),
    'usableIssued', coalesce((select sum(amount) from public.reward_events where credit_class = 'usable' and created_at >= p_since), 0),
    'withdrawableIssued', coalesce((select sum(amount) from public.reward_events where credit_class = 'withdrawable' and created_at >= p_since), 0),
    'qualifiedMembers', (select count(*) from public.reward_profiles where qualified_at is not null),
    'restrictedMembers', (select count(*) from public.reward_profiles where restricted),
    'withdrawals', jsonb_build_object(
      'pending', (select count(*) from public.withdrawal_requests where status = 'pending'),
      'reviewing', (select count(*) from public.withdrawal_requests where status = 'reviewing'),
      'approved', (select count(*) from public.withdrawal_requests where status = 'approved'),
      'processing', (select count(*) from public.withdrawal_requests where status = 'processing'),
      'completedCredits', coalesce((select sum(credits) from public.withdrawal_requests where status = 'completed' and created_at >= p_since), 0),
      'completedUsdCents', coalesce((select sum(amount_usd_cents) from public.withdrawal_requests where status = 'completed' and created_at >= p_since), 0)
    )
  )
$$;

do $$
declare
  fn text;
begin
  -- backfill the running totals once from the rewards already granted
  update public.reward_profiles p
     set earned_usable = coalesce(t.u, 0), earned_withdrawable = coalesce(t.w, 0)
    from (select beneficiary_id,
                 sum(amount) filter (where credit_class = 'usable') as u,
                 sum(amount) filter (where credit_class = 'withdrawable') as w
            from public.reward_events group by beneficiary_id) t
   where t.beneficiary_id = p.user_id;

  execute 'drop trigger if exists reward_config_sync_trg on public.settings';
  execute 'create trigger reward_config_sync_trg after insert or update on public.settings for each row execute function public.reward_config_sync()';

  foreach fn in array array[
    'public.grant_reward(uuid, text, text, text, text, uuid, uuid, integer, text, jsonb, jsonb)',
    'public.process_reward_event(text, uuid, text, text, jsonb)',
    'public.reward_config_sync()',
    'public.rewards_admin_totals(timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
