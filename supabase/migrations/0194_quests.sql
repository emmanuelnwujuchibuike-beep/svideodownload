-- ═══════════════════════════════════════════════════════════════════════════
--  0194 — daily and weekly quests that earn credits (2026-10-07, first pushed as 0192)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "a weekly quest that resets every Sunday 1am Lagos time … a daily quest
-- that resets at 1am … admin can set a quest and a reward … not all events have
-- the same rewards … it has a weekly limit".
--
-- The quests themselves are the operator's (settings.landing frenzRewards.quests,
-- mirrored into reward_config by 0189's trigger): each names an EVENT the reward
-- engine already sees (a download, an AI video, a like or comment, a follow, a
-- save, an AI reel share), a target count, a reward and a period.
--
--   quest_event_log  one row per (member, event, source) - a source counts ONCE
--                    (unlike and like again does not count twice)
--   quest_progress   (member, quest, period) counter and completion time
--   quest_record()   called by process_reward_event for every event; on reaching
--                    the target it grants the reward through grant_reward, once
--                    per quest per period (its dedupe key), held under the
--                    weekly credit cap
--   quest_status()   the member's quests for the current day and week, in one read
--
-- Periods are Africa/Lagos time shifted by one hour, so a day ends at 01:00 and
-- a week ends at Sunday 01:00. No timer anywhere: a period simply has a new key.
-- No semicolon inside any quoted string (the 0186 lesson).

create table if not exists public.quest_event_log (
  user_id     uuid not null references auth.users (id) on delete cascade,
  event_type  text not null,
  source_key  text not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, event_type, source_key)
);
alter table public.quest_event_log enable row level security;
revoke all on public.quest_event_log from public, anon, authenticated;
grant all on public.quest_event_log to service_role;
comment on table public.quest_event_log is 'Quests (0192): each member activity counted once per source - the anti-farming ledger. Service role only.';

create table if not exists public.quest_progress (
  user_id      uuid not null references auth.users (id) on delete cascade,
  quest_id     text not null,
  period_key   text not null,
  progress     integer not null default 0,
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, quest_id, period_key)
);
alter table public.quest_progress enable row level security;
revoke all on public.quest_progress from public, anon, authenticated;
grant all on public.quest_progress to service_role;
comment on table public.quest_progress is 'Quests (0192): a member progress on one quest in one period (D2026-10-07 or W2026-10-04). Service role only.';

-- the period keys: Lagos time minus one hour, so a day turns at 01:00 and a week at Sunday 01:00
create or replace function public.quest_periods(p_at timestamptz) returns jsonb
language sql stable set search_path = public as $$
  with t as (select ((p_at at time zone 'Africa/Lagos') - interval '1 hour') as l)
  select jsonb_build_object(
    'day', 'D' || to_char(t.l::date, 'YYYY-MM-DD'),
    'week', 'W' || to_char((t.l::date - extract(dow from t.l)::integer), 'YYYY-MM-DD'),
    'dayEndsAt', ((t.l::date + 1)::timestamp + interval '1 hour') at time zone 'Africa/Lagos',
    'weekEndsAt', (((t.l::date - extract(dow from t.l)::integer) + 7)::timestamp + interval '1 hour') at time zone 'Africa/Lagos',
    'weekStartedAt', (((t.l::date - extract(dow from t.l)::integer))::timestamp + interval '1 hour') at time zone 'Africa/Lagos'
  )
  from t
$$;

create or replace function public.quest_record(p_event text, p_actor uuid, p_source_type text, p_source_id text, p_cfg jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_quests   jsonb := coalesce(p_cfg -> 'quests', '{}'::jsonb);
  v_items    jsonb;
  v_q        jsonb;
  v_periods  jsonb := public.quest_periods(now());
  v_period   text;
  v_target   integer;
  v_credits  integer;
  v_progress integer;
  v_done     timestamptz;
  v_cap      integer;
  v_earned   bigint;
  v_ok       boolean;
begin
  if p_actor is null or p_event is null or p_source_id is null then return; end if;
  if coalesce((v_quests ->> 'enabled')::boolean, false) = false then return; end if;
  v_items := coalesce(v_quests -> 'items', '[]'::jsonb);
  if not exists (select 1 from jsonb_array_elements(v_items) q where q ->> 'event' = p_event and coalesce((q ->> 'enabled')::boolean, true)) then return; end if;

  -- the facts, for the events a browser could otherwise claim
  if p_event in ('ai_video_completed', 'ai_audio_completed') then
    perform 1 from public.ai_jobs where id = p_source_id::uuid and user_id = p_actor and status = 'completed';
    if not found then return; end if;
  elsif p_event = 'ai_video_shared' then
    perform 1 from public.posts where ai_job_id = p_source_id::uuid and publisher_id = p_actor and content_type = 'ai_video' and status = 'published';
    if not found then return; end if;
  end if;

  -- one count per source, ever
  insert into public.quest_event_log (user_id, event_type, source_key) values (p_actor, p_event, coalesce(p_source_type, '') || ':' || p_source_id)
  on conflict do nothing;
  get diagnostics v_target = row_count;
  if v_target = 0 then return; end if;

  perform pg_advisory_xact_lock(hashtext('quests:' || p_actor::text));
  for v_q in select q from jsonb_array_elements(v_items) q where q ->> 'event' = p_event and coalesce((q ->> 'enabled')::boolean, true) loop
    v_period := case when v_q ->> 'period' = 'weekly' then v_periods ->> 'week' else v_periods ->> 'day' end;
    v_target := greatest(1, coalesce(nullif(v_q ->> 'target', '')::integer, 1));
    v_credits := greatest(0, coalesce(nullif(v_q ->> 'credits', '')::integer, 0));
    insert into public.quest_progress (user_id, quest_id, period_key, progress) values (p_actor, v_q ->> 'id', v_period, 1)
    on conflict (user_id, quest_id, period_key) do update set progress = public.quest_progress.progress + 1, updated_at = now()
    returning progress, completed_at into v_progress, v_done;
    if v_progress >= v_target and v_done is null then
      update public.quest_progress set completed_at = now() where user_id = p_actor and quest_id = v_q ->> 'id' and period_key = v_period;
      -- the weekly limit on quest credits
      v_cap := greatest(0, coalesce(nullif(v_quests ->> 'weeklyCreditCap', '')::integer, 0));
      if v_cap > 0 then
        select coalesce(sum(amount), 0) into v_earned from public.reward_events
         where beneficiary_id = p_actor and event_type = 'quest_completed' and created_at >= (v_periods ->> 'weekStartedAt')::timestamptz;
        v_credits := least(v_credits, greatest(0, v_cap - v_earned)::integer);
      end if;
      if v_credits > 0 then
        perform public.grant_reward(p_actor, 'actor', 'quest_completed', 'quest', (v_q ->> 'id') || ':' || v_period, p_actor, null, v_credits,
          'quest:' || (v_q ->> 'id') || ':' || v_period, p_cfg, jsonb_build_object('quest', v_q ->> 'id', 'title', v_q ->> 'title', 'period', v_period));
      end if;
    end if;
  end loop;
end;
$$;

-- the member's quests now, in one read: progress for this day and this week, what was earned this week, when each resets
create or replace function public.quest_status(p_user uuid) returns jsonb
language sql security definer set search_path = public stable as $$
  with p as (select public.quest_periods(now()) as k)
  select jsonb_build_object(
    'periods', (select k from p),
    'progress', coalesce((select jsonb_agg(jsonb_build_object('quest', qp.quest_id, 'period', qp.period_key, 'progress', qp.progress, 'completedAt', qp.completed_at))
                            from public.quest_progress qp, p
                           where qp.user_id = p_user and qp.period_key in (p.k ->> 'day', p.k ->> 'week')), '[]'::jsonb),
    'weekEarned', (select coalesce(sum(amount), 0) from public.reward_events e, p
                    where e.beneficiary_id = p_user and e.event_type = 'quest_completed' and e.created_at >= (p.k ->> 'weekStartedAt')::timestamptz)
  )
$$;

-- ── the engine, counting quests first ──
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
  -- 0192: quests count the member's own activity first, whatever the reward rules say - and never block a reward
  begin
    perform public.quest_record(p_event, p_actor, p_source_type, p_source_id, v_cfg);
  exception when others then
    raise warning 'quest_record failed: %', sqlerrm;
  end;
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

-- ── an AI plan paid for with credits (owner 2026-10-07: "use them for subscription") ──
-- One transaction: lock the wallet, refuse a member already on this plan or a higher one, take the
-- credits (the non-withdrawable part first, like every charge), write the ledger line and activate the
-- plan for ONE period with no renewal. Nothing renews from credits on its own.
create or replace function public.buy_ai_plan_with_credits(p_user uuid, p_plan text, p_credits integer, p_period_end timestamptz, p_label text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_balance bigint;
  v_wd      bigint;
  v_wallet  text;
  v_wpart   bigint;
  v_cur     record;
  v_rank    integer := case p_plan when 'ai_max' then 2 when 'ai_pro' then 1 else 0 end;
  v_ref     text;
begin
  if p_user is null or v_rank = 0 or p_credits is null or p_credits <= 0 then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  perform pg_advisory_xact_lock(hashtext('ai-plan-credits:' || p_user::text));
  select plan, status, current_period_end into v_cur from public.ai_subscriptions where user_id = p_user;
  if v_cur.status in ('active', 'trialing') and (v_cur.current_period_end is null or v_cur.current_period_end > now())
     and (case v_cur.plan when 'ai_max' then 2 when 'ai_pro' then 1 else 0 end) >= v_rank then
    return jsonb_build_object('ok', false, 'reason', 'already_on_plan');
  end if;
  select balance_cents, withdrawable_cents, currency into v_balance, v_wd, v_wallet
    from public.ai_product_balances where user_id = p_user and product = 'character_replace' for update;
  if v_wallet is distinct from 'CREDIT' then return jsonb_build_object('ok', false, 'reason', 'no_wallet'); end if;
  if v_balance < p_credits then return jsonb_build_object('ok', false, 'reason', 'insufficient', 'balance', v_balance); end if;
  v_wpart := greatest(0, p_credits - (v_balance - v_wd));
  update public.ai_product_balances
     set balance_cents = balance_cents - p_credits, withdrawable_cents = withdrawable_cents - v_wpart, updated_at = now()
   where user_id = p_user and product = 'character_replace'
  returning balance_cents into v_balance;
  v_ref := 'plan-credits:' || p_plan || ':' || to_char(now(), 'YYYYMMDDHH24MISS');
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, metadata, withdrawable_part)
  values (p_user, 'character_replace', 'processing_charge', 'settled', -p_credits, v_balance, 'CREDIT', v_ref, coalesce(p_label, p_plan),
          jsonb_build_object('purpose', 'ai_plan', 'plan', p_plan, 'period_end', p_period_end), v_wpart);
  insert into public.ai_subscriptions (user_id, plan, status, provider, last_reference, current_period_start, current_period_end, cancel_at_period_end, activated_at, updated_at)
  values (p_user, p_plan, 'active', 'credits', v_ref, now(), p_period_end, true, now(), now())
  on conflict (user_id) do update set plan = excluded.plan, status = 'active', provider = 'credits', last_reference = excluded.last_reference,
    current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end, cancel_at_period_end = true,
    activated_at = coalesce(public.ai_subscriptions.activated_at, now()), canceled_at = null, updated_at = now();
  return jsonb_build_object('ok', true, 'balance_after', v_balance, 'reference', v_ref, 'withdrawable_part', v_wpart);
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.quest_record(text, uuid, text, text, jsonb)',
    'public.quest_status(uuid)',
    'public.quest_periods(timestamptz)',
    'public.process_reward_event(text, uuid, text, text, jsonb)',
    'public.buy_ai_plan_with_credits(uuid, text, integer, timestamptz, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
