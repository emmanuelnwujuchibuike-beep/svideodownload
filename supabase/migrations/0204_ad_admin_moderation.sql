-- ═══════════════════════════════════════════════════════════════════════════
--  0204 — Ad Platform Part 7: the admin side of self-serve campaigns (2026-10-09)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Parts 1-6 built the engine, the application, payments, serving and the
-- advertiser dashboard. Their Gap Ledgers left the admin's own levers for here:
--
--   admin_moderate_ad_campaign  approve · reject · pause · resume · remove, under
--                               a row lock with the version the admin saw, one
--                               audit event each. Activation still goes ONLY
--                               through activate_ad_campaign (every check reruns).
--   refund owed                 a paid campaign that is rejected or removed is
--                               owed its money back: all of it if it never ran,
--                               the unused share of its time if it did. Card
--                               money goes back through the provider dashboard
--                               (Paystack and Bachs both send a refund webhook
--                               that ad_payment_reverse already records), so
--                               this records WHAT is owed and whether it was paid.
--   admin_set_ad_refund         owed → refunded | waived, with a note.
--   admin_set_advertiser_status active · restricted · suspended · disabled. Any
--                               status but active pauses that advertiser's live
--                               campaigns at once (activation already refuses
--                               them). Reactivating resumes nothing by itself.
--
-- activate_ad_campaign is copied whole with one fix: a paused campaign that
-- fails a check on resume stays paused (0195 sent it to validating, and the
-- next activation then gave it a second slot and fresh dates).
--
-- An admin pause is marked admin_paused so the advertiser cannot lift it
-- (ad_advertiser_pause only lifts advertiser_paused).
-- Service role only. No semicolon inside any quoted string. Functions and the
-- DO block last.

alter table public.ad_campaigns add column if not exists refund_status text not null default 'none';
alter table public.ad_campaigns add column if not exists refund_owed_minor bigint;
alter table public.ad_campaigns add column if not exists refund_note text;
alter table public.ad_campaigns add column if not exists refund_decided_at timestamptz;
alter table public.ad_campaigns add column if not exists refund_decided_by uuid references auth.users (id) on delete set null;
alter table public.ad_campaigns drop constraint if exists ad_campaigns_refund_chk;
alter table public.ad_campaigns add constraint ad_campaigns_refund_chk check (
  refund_status in ('none', 'owed', 'refunded', 'waived')
  and (refund_owed_minor is null or refund_owed_minor >= 0)
  and (refund_status = 'none' or refund_owed_minor is not null));

create index if not exists ad_campaigns_review_idx on public.ad_campaigns (updated_at desc) where status in ('paid', 'validating');
create index if not exists ad_campaigns_refund_idx on public.ad_campaigns (updated_at desc) where refund_status = 'owed';

comment on column public.ad_campaigns.refund_status is 'Part 7 (0204): none, owed (rejected or removed after payment), refunded or waived by an admin. The money itself moves in the provider dashboard and its webhook updates the payment attempt.';
comment on column public.ad_campaigns.refund_owed_minor is 'Part 7 (0204): what is owed back, in the campaign currency - all of it if it never started, otherwise the unused share of its paid time.';

-- ── activation, copied WHOLE from 0195 with one change (marked 0204): a paused
--    campaign that fails a check on resume stays paused. ──
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
  if exists (select 1 from public.ad_creatives where campaign_id = p_campaign and status = 'active' and url_validation_status <> 'valid') then
    v_flags := v_flags || 'destination_not_valid'::text;
  end if;

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

-- ── what a paid campaign is owed back if it stops now ──
create or replace function public.ad_refund_owed(p_campaign uuid) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare
  c        record;
  v_total  numeric;
  v_left   numeric;
begin
  select payment_verified_at, total_amount_minor, started_at, start_at, end_at into c from public.ad_campaigns where id = p_campaign;
  if not found or c.payment_verified_at is null or coalesce(c.total_amount_minor, 0) <= 0 then return 0; end if;
  if c.started_at is null or c.start_at is null or c.end_at is null then return c.total_amount_minor; end if;
  if c.end_at <= now() then return 0; end if;
  v_total := extract(epoch from (c.end_at - c.start_at));
  v_left  := extract(epoch from (c.end_at - greatest(now(), c.start_at)));
  if v_total <= 0 then return 0; end if;
  -- rounded DOWN: never owe more than was paid
  return least(c.total_amount_minor, floor(c.total_amount_minor * v_left / v_total))::bigint;
end;
$$;

-- ── one admin decision on one campaign ──
create or replace function public.admin_moderate_ad_campaign(
  p_campaign uuid, p_action text, p_expected_version integer, p_admin uuid, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c       public.ad_campaigns%rowtype;
  r       jsonb;
  v_to    text;
  v_owed  bigint;
  v_why   text := nullif(left(btrim(coalesce(p_reason, '')), 300), '');
  v_ver   integer;
begin
  if p_admin is null or p_action is null or p_action not in ('approve', 'reject', 'pause', 'resume', 'remove') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into c from public.ad_campaigns where id = p_campaign for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_expected_version is not null and c.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'stale', 'version', c.version, 'status', c.status);
  end if;
  if p_action in ('reject', 'remove') and v_why is null then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  if p_action = 'approve' then
    if c.status not in ('paid', 'validating') then return jsonb_build_object('ok', false, 'reason', 'bad_status', 'status', c.status); end if;
    -- a person looked: what was only WAITING on a check passes. Invalid or
    -- blocked media and blocked links stay refused - approval cannot lift them.
    update public.ad_creatives set validation_status = 'valid', validation_errors = '{}'::text[], validated_at = now(), updated_at = now()
     where campaign_id = c.id and status = 'active' and validation_status = 'pending';
    update public.ad_creatives set url_validation_status = 'valid', url_validated_at = now(), updated_at = now()
     where campaign_id = c.id and status = 'active' and url_validation_status = 'pending';
    insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role, reason)
    values (c.id, 'approved', c.status, c.status, p_admin, 'admin', v_why);
    r := public.activate_ad_campaign(c.id, p_admin, 'admin');
    return r || jsonb_build_object('action', 'approve');
  end if;

  if p_action = 'resume' then
    if c.status <> 'paused' then return jsonb_build_object('ok', false, 'reason', 'bad_status', 'status', c.status); end if;
    r := public.activate_ad_campaign(c.id, p_admin, 'admin');
    if coalesce((r ->> 'ok')::boolean, false) then
      update public.ad_campaigns set status_reason = null where id = c.id;
    end if;
    return r || jsonb_build_object('action', 'resume');
  end if;

  if p_action = 'pause' then
    if c.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'bad_status', 'status', c.status); end if;
    update public.ad_campaigns set status = 'paused', status_reason = 'admin_paused' where id = c.id returning version into v_ver;
    insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role, reason)
    values (c.id, 'paused', 'active', 'paused', p_admin, 'admin', coalesce(v_why, 'admin_paused'));
    return jsonb_build_object('ok', true, 'action', 'pause', 'status', 'paused', 'version', v_ver);
  end if;

  -- reject or remove
  v_to := case when p_action = 'reject' then 'rejected' else 'removed' end;
  if not public.ad_campaign_transition_allowed(c.status, v_to) then
    return jsonb_build_object('ok', false, 'reason', 'transition_not_allowed', 'from', c.status, 'to', v_to);
  end if;
  v_owed := case when c.refund_status = 'none' then public.ad_refund_owed(c.id) else 0 end;
  update public.ad_campaigns
     set status = v_to, status_reason = v_why,
         refund_status = case when v_owed > 0 then 'owed' else refund_status end,
         refund_owed_minor = case when v_owed > 0 then v_owed else refund_owed_minor end
   where id = c.id
  returning version into v_ver;
  insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role, reason)
  values (c.id, v_to, c.status, v_to, p_admin, 'admin', v_why);
  if v_owed > 0 then
    insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role, reason)
    values (c.id, 'refund_owed', v_to, v_to, p_admin, 'admin', v_owed::text || ' ' || coalesce(c.currency, ''));
  end if;
  return jsonb_build_object('ok', true, 'action', p_action, 'status', v_to, 'version', v_ver,
                            'refund_owed', v_owed, 'currency', c.currency);
end;
$$;

-- ── the refund decision: paid back in the provider dashboard, or waived ──
create or replace function public.admin_set_ad_refund(p_campaign uuid, p_status text, p_admin uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cur text;
begin
  if p_admin is null or p_status is null or p_status not in ('refunded', 'waived') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select refund_status into v_cur from public.ad_campaigns where id = p_campaign for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_cur = p_status then return jsonb_build_object('ok', true, 'already', true); end if;
  if v_cur <> 'owed' then return jsonb_build_object('ok', false, 'reason', 'not_owed', 'refund_status', v_cur); end if;
  update public.ad_campaigns
     set refund_status = p_status, refund_note = nullif(left(btrim(coalesce(p_note, '')), 300), ''),
         refund_decided_at = now(), refund_decided_by = p_admin
   where id = p_campaign;
  insert into public.ad_campaign_events (campaign_id, kind, actor_id, actor_role, reason)
  values (p_campaign, 'refund_' || p_status, p_admin, 'admin', nullif(left(btrim(coalesce(p_note, '')), 300), ''));
  return jsonb_build_object('ok', true, 'refund_status', p_status);
end;
$$;

-- ── an advertiser's standing. Anything but active stops their live ads now. ──
create or replace function public.admin_set_advertiser_status(p_advertiser uuid, p_status text, p_admin uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cur    text;
  v_paused integer := 0;
begin
  if p_admin is null or p_status is null or p_status not in ('active', 'restricted', 'suspended', 'disabled') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select status into v_cur from public.advertisers where id = p_advertiser for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_status <> 'active' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  update public.advertisers
     set status = p_status, status_reason = case when p_status = 'active' then null else left(btrim(p_reason), 300) end, updated_at = now()
   where id = p_advertiser;
  if p_status <> 'active' then
    with up as (
      update public.ad_campaigns set status = 'paused', status_reason = 'advertiser_' || p_status
       where advertiser_id = p_advertiser and status = 'active'
      returning id
    )
    insert into public.ad_campaign_events (campaign_id, kind, from_status, to_status, actor_id, actor_role, reason)
    select id, 'paused', 'active', 'paused', p_admin, 'admin', 'advertiser_' || p_status from up;
    get diagnostics v_paused = row_count;
  end if;
  return jsonb_build_object('ok', true, 'from', v_cur, 'status', p_status, 'paused', v_paused);
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.activate_ad_campaign(uuid, uuid, text)',
    'public.ad_refund_owed(uuid)',
    'public.admin_moderate_ad_campaign(uuid, text, integer, uuid, text)',
    'public.admin_set_ad_refund(uuid, text, uuid, text)',
    'public.admin_set_advertiser_status(uuid, text, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
