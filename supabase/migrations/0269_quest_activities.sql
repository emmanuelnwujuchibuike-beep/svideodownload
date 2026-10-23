-- ═══════════════════════════════════════════════════════════════════════════
--  0269 — quests on any activity, and one-time quests (2026-10-23)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-22: "make admin can add any quest, like posting Wallpapers to
-- earn credit, not just a format I can't use any aside them … it should be
-- fully configurable by admin."
--
-- 1. MORE ACTIVITIES A QUEST CAN COUNT. 0194's quests counted the seven events
--    the reward engine already raised. Each activity below is now reported to
--    quest_record at the moment it happens, by a trigger on its own table:
--
--      wallpaper_posted           wallpapers (a MEMBER's upload, published)
--      post_published             posts (published, format 'feed')
--      reel_posted                posts (published, format 'reel')
--      story_posted               stories
--      comment_posted             post_comments
--      friend_added               friendships (counts for both people)
--      message_sent               messages
--      exclusive_post_published   sub_posts (published)
--      app_rated                  app_ratings (a signed-in rater)
--
--    They feed QUESTS ONLY — quest_record directly, never process_reward_event —
--    so no reward rule can pay for them by accident. And the trigger first asks
--    the reward_config row whether any enabled quest counts that activity at all:
--    on a busy table (messages) with no such quest the cost is one tiny read.
--    🔴 A failure inside never blocks the insert it observes (exception → warning).
--
-- 2. ONE-TIME QUESTS. period 'once': a single period key ('ONCE') that never
--    resets — "post your first wallpaper" pays once per member, ever.
--
-- quest_record and quest_status are redefined with the 'once' branch; nothing
-- else in them changes.

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
    -- 0269: 'once' never resets — one key for the life of the account
    v_period := case v_q ->> 'period' when 'weekly' then v_periods ->> 'week' when 'once' then 'ONCE' else v_periods ->> 'day' end;
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

-- the member's quests now, in one read: progress for this day, this week and the one-time quests
create or replace function public.quest_status(p_user uuid) returns jsonb
language sql security definer set search_path = public stable as $$
  with p as (select public.quest_periods(now()) as k)
  select jsonb_build_object(
    'periods', (select k from p),
    'progress', coalesce((select jsonb_agg(jsonb_build_object('quest', qp.quest_id, 'period', qp.period_key, 'progress', qp.progress, 'completedAt', qp.completed_at))
                            from public.quest_progress qp, p
                           where qp.user_id = p_user and qp.period_key in (p.k ->> 'day', p.k ->> 'week', 'ONCE')), '[]'::jsonb),
    'weekEarned', (select coalesce(sum(amount), 0) from public.reward_events e, p
                    where e.beneficiary_id = p_user and e.event_type = 'quest_completed' and e.created_at >= (p.k ->> 'weekStartedAt')::timestamptz)
  )
$$;

-- ── the activities ──
create or replace function public.quest_on_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cfg   jsonb;
  v_event text;
  v_actor uuid;
  v_src   text;
  v_srcid text;
  v_other uuid;
begin
  if tg_table_name = 'wallpapers' then
    if new.uploaded_by is null or coalesce(new.source, '') <> 'member' or new.status <> 'published' then return new; end if;
    v_event := 'wallpaper_posted'; v_actor := new.uploaded_by; v_src := 'wallpaper'; v_srcid := new.id::text;
  elsif tg_table_name = 'posts' then
    if new.status <> 'published' then return new; end if;
    v_event := case when coalesce(new.format, 'feed') = 'reel' then 'reel_posted' else 'post_published' end; v_actor := new.publisher_id; v_src := 'post'; v_srcid := new.id::text;
  elsif tg_table_name = 'stories' then
    v_event := 'story_posted'; v_actor := new.user_id; v_src := 'story'; v_srcid := new.id::text;
  elsif tg_table_name = 'post_comments' then
    v_event := 'comment_posted'; v_actor := new.author_id; v_src := 'comment'; v_srcid := new.id::text;
  elsif tg_table_name = 'friendships' then
    -- friendships have no id: the pair is the source
    v_event := 'friend_added'; v_actor := new.user_low; v_other := new.user_high; v_src := 'friendship'; v_srcid := new.user_low::text || ':' || new.user_high::text;
  elsif tg_table_name = 'messages' then
    v_event := 'message_sent'; v_actor := new.sender_id; v_src := 'message'; v_srcid := new.id::text;
  elsif tg_table_name = 'sub_posts' then
    if new.status <> 'published' then return new; end if;
    v_event := 'exclusive_post_published'; v_actor := new.creator_id; v_src := 'sub_post'; v_srcid := new.id::text;
  elsif tg_table_name = 'app_ratings' then
    if new.user_id is null then return new; end if;
    v_event := 'app_rated'; v_actor := new.user_id; v_src := 'app_rating'; v_srcid := new.id::text;
  else
    return new;
  end if;

  begin
    select rules into v_cfg from public.reward_config where id;
    -- the cheap gate: no enabled quest counts this activity → nothing more is read or written
    if v_cfg is null
       or coalesce((v_cfg -> 'quests' ->> 'enabled')::boolean, false) = false
       or not exists (select 1 from jsonb_array_elements(coalesce(v_cfg -> 'quests' -> 'items', '[]'::jsonb)) q
                       where q ->> 'event' = v_event and coalesce((q ->> 'enabled')::boolean, true)) then
      return new;
    end if;
    perform public.quest_record(v_event, v_actor, v_src, v_srcid, v_cfg);
    if v_other is not null then
      perform public.quest_record(v_event, v_other, v_src, v_srcid, v_cfg);
    end if;
  exception when others then
    -- 🔴 a quest must never block the post, message or upload it counts
    raise warning 'quest_on_activity(%) failed: %', v_event, sqlerrm;
  end;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['wallpapers', 'posts', 'stories', 'post_comments', 'friendships', 'messages', 'sub_posts', 'app_ratings'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists quest_on_%1$s_trg on public.%1$I', t);
      execute format('create trigger quest_on_%1$s_trg after insert on public.%1$I for each row execute function public.quest_on_activity()', t);
    end if;
  end loop;
end $$;

revoke all on function public.quest_on_activity() from public, anon, authenticated;
revoke all on function public.quest_record(text, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.quest_record(text, uuid, text, text, jsonb) to service_role;
revoke all on function public.quest_status(uuid) from public, anon, authenticated;
grant execute on function public.quest_status(uuid) to service_role;
