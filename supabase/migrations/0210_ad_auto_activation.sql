-- ═══════════════════════════════════════════════════════════════════════════
--  0210 — a paid campaign goes live automatically (2026-10-09)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "I had to approve from admin dashboard, I don't need to approve from
-- admin dashboard, it should be going live automatically" and "after it passes
-- the checking before payment and paid it goes live immediately".
--
-- Measured: the held campaign was flagged destination_not_valid - its link was
-- 'pending' (the reputation lookup was unavailable or the link redirects),
-- not blocked. activate_ad_campaign (as in 0206) now holds a first activation
-- only for HARD reasons. Two soft holds are removed:
--   a link PENDING review        -> live, still listed in the admin safety queue
--   a creative in safety REVIEW  -> live, still listed in the admin safety queue
-- Kept: unverified payment, no or invalid creative, a creative still being
-- checked (validation pending - this is what keeps unmoderated content out),
-- a BLOCKED link, a disabled placement or format, a full placement.
--
-- The function body below is 0206's, unchanged except for those two lines.

create or replace function public.activate_ad_campaign(p_campaign uuid, p_actor uuid, p_actor_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c            public.ad_campaigns%rowtype;
  v_adv        text;
  v_pl_enabled boolean;
  v_fmt_code   text;
  v_fmt_on     boolean;
  v_slots      integer;
  v_slot       integer;
  v_flags      text[] := '{}'::text[];
  v_start      timestamptz;
  v_end        timestamptz;
  v_count      integer;
  v_first      boolean;
begin
  if p_actor_role not in ('system', 'admin') then return jsonb_build_object('ok', false, 'reason', 'not_permitted'); end if;
  select * into c from public.ad_campaigns where id = p_campaign for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if c.status = 'active' then return jsonb_build_object('ok', true, 'already_active', true); end if;
  if c.status not in ('paid', 'validating', 'paused') then return jsonb_build_object('ok', false, 'reason', 'bad_status', 'status', c.status); end if;
  if c.payment_verified_at is null then return jsonb_build_object('ok', false, 'reason', 'payment_unverified'); end if;
  v_first := c.status in ('paid', 'validating');

  select status into v_adv from public.advertisers where id = c.advertiser_id;
  if v_adv is distinct from 'active' then v_flags := v_flags || 'advertiser_not_active'::text; end if;

  select p.enabled, p.format_code, f.enabled, coalesce(f.slot_count, s.default_slot_count)
    into v_pl_enabled, v_fmt_code, v_fmt_on, v_slots
    from public.ad_placements p
    join public.ad_formats f on f.code = p.format_code
    cross join public.ad_platform_settings s
   where p.id = c.placement_id;
  if not coalesce(v_pl_enabled, false) then v_flags := v_flags || 'placement_disabled'::text; end if;
  if not coalesce(v_fmt_on, false) then v_flags := v_flags || 'format_disabled'::text; end if;

  select count(*) into v_count from public.ad_creatives where campaign_id = p_campaign and status = 'active';
  if v_count = 0 then v_flags := v_flags || 'no_creative'::text; end if;
  if exists (select 1 from public.ad_creatives where campaign_id = p_campaign and status = 'active' and format_code <> v_fmt_code) then
    v_flags := v_flags || 'format_mismatch'::text;
  end if;
  if exists (select 1 from public.ad_creatives where campaign_id = p_campaign and status = 'active' and validation_status = 'pending') then
    v_flags := v_flags || 'validation_pending'::text;
  end if;
  if exists (select 1 from public.ad_creatives where campaign_id = p_campaign and status = 'active' and validation_status in ('invalid', 'blocked')) then
    v_flags := v_flags || 'creative_invalid'::text;
  end if;
  if exists (select 1 from public.ad_creatives where campaign_id = p_campaign and status = 'active' and url_validation_status = 'blocked') then
    v_flags := v_flags || 'destination_not_valid'::text;
  end if;
  -- 0210: a safety 'review' no longer holds activation (owner: go live automatically) - it stays in the admin queue

  if not v_first and c.end_at is not null and c.end_at <= now() then
    update public.ad_campaigns set status = 'expired' where id = p_campaign;
    insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role)
    values (p_campaign, 'campaign_expired', c.status, 'expired', p_actor, p_actor_role);
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if cardinality(v_flags) = 0 and v_first then
    -- a free slot: one that is open, or whose holder is no longer live
    perform pg_advisory_xact_lock(hashtext('ad-slots:' || c.placement_id::text));
    select n into v_slot
      from generate_series(1, v_slots) n
     where not exists (
       select 1 from public.ad_slots sl
         join public.ad_campaigns o on o.id = sl.campaign_id
        where sl.placement_id = c.placement_id and sl.slot_number = n and o.id <> p_campaign
          and o.status in ('paid', 'validating', 'active', 'paused')
          and (o.end_at is null or o.end_at > now()))
       and not exists (
       select 1 from public.ad_slots sl
        where sl.placement_id = c.placement_id and sl.slot_number = n and sl.status = 'disabled')
     order by n
     limit 1;
    if v_slot is null then v_flags := v_flags || 'placement_full'::text; end if;
  end if;

  if cardinality(v_flags) > 0 then
    -- 0204: a PAUSED campaign that fails a check stays paused with its reasons.
    -- 0195 moved it to validating, and the next activation then treated it as
    -- new - a second slot and fresh dates. Only a first activation waits in validating.
    if v_first and c.status <> 'validating' then
      update public.ad_campaigns set status = 'validating', review_flags = v_flags where id = p_campaign;
    else
      update public.ad_campaigns set review_flags = v_flags where id = p_campaign;
    end if;
    insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role, reason)
    values (p_campaign, 'flagged', c.status, case when v_first then 'validating' else c.status end, p_actor, p_actor_role, array_to_string(v_flags, ','));
    return jsonb_build_object('ok', false, 'reason', 'flagged', 'flags', to_jsonb(v_flags));
  end if;

  if v_first then
    insert into public.ad_slots (placement_id, slot_number, campaign_id, status)
    values (c.placement_id, v_slot, p_campaign, 'assigned')
    on conflict (placement_id, slot_number) do update set campaign_id = excluded.campaign_id, status = 'assigned', updated_at = now();
    -- auto_start: live the moment it is valid. Otherwise at its scheduled start, never in the past.
    v_start := case when c.auto_start or c.start_at is null then now() else greatest(now(), c.start_at) end;
    v_end := v_start + make_interval(days => coalesce(c.duration_days, 0) + coalesce(c.extra_days, 0));
    update public.ad_campaigns
       set status = 'active', start_at = v_start, end_at = v_end, activated_at = now(), review_flags = '{}'::text[],
           started_at = case when v_start <= now() then now() end
     where id = p_campaign;
  else
    update public.ad_campaigns set status = 'active', review_flags = '{}'::text[] where id = p_campaign;
  end if;
  insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role)
  values (p_campaign, case when v_first then 'activated' else 'resumed' end, c.status, 'active', p_actor, p_actor_role);
  if v_first and v_start <= now() then
    insert into public.ad_campaign_events (campaign_id, kind, to_status, actor_role) values (p_campaign, 'campaign_started', 'active', 'system');
  end if;
  return jsonb_build_object('ok', true, 'slot', v_slot, 'start_at', coalesce(v_start, c.start_at), 'end_at', coalesce(v_end, c.end_at));
end;
$$;
