-- ═══════════════════════════════════════════════════════════════════════════
--  0241 — slot availability, the "tell me when a slot opens" list, and the
--         approaching-deadline notice (2026-10-12)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "all ad slot limit is 10, and when a user wants to apply when it is
-- already 10, they get suggested another slot or told when the next available
-- slot will be, and they can turn on push and email notifications to get
-- notified when the slot is open."
--
-- Measured before this: a full placement was only discovered by
-- activate_ad_campaign AFTER payment (flag placement_full). Now:
--   ad_slot_availability   counts per placement, computed with the SAME rule
--                          activation uses (slot holders still live, disabled
--                          slots excluded) plus campaigns already paying or
--                          paid that will need a slot. Public: counts and a
--                          date only - no advertiser, no campaign.
--   ad_slot_waitlist       one row per member and placement who asked to be
--                          told. Written only by the server route.
--   ad_slot_waitlist_due   claims the rows whose placement has room again
--                          (hourly housekeeping sends push + email once).
-- Plus 0240's delivery row gets deadline_notified_at: one "your planned
-- period ends soon" notice per views campaign, and a live fixed-period
-- campaign gets one "ends soon" notice per end date (expiry_notified_for).
--
-- Runner rules: no semicolon inside any single-quoted string, plain DDL first,
-- dollar-quoted blocks last, grants inside a DO block, idempotent.

create table if not exists public.ad_slot_waitlist (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  placement_id  uuid not null references public.ad_placements (id) on delete cascade,
  created_at    timestamptz not null default now(),
  notified_at   timestamptz
);
-- one open request per member and placement - asking twice changes nothing
create unique index if not exists ad_slot_waitlist_open_idx on public.ad_slot_waitlist (user_id, placement_id) where notified_at is null;
create index if not exists ad_slot_waitlist_due_idx on public.ad_slot_waitlist (placement_id) where notified_at is null;

alter table public.ad_slot_waitlist enable row level security;
revoke insert, update, delete, truncate on public.ad_slot_waitlist from anon, authenticated;
drop policy if exists "ad waitlist own or admin" on public.ad_slot_waitlist;
create policy "ad waitlist own or admin" on public.ad_slot_waitlist
  for select using (user_id = (select auth.uid()) or (select public.is_admin()));

comment on table public.ad_slot_waitlist is '0241: members who asked to be told when a full placement has a free slot. Notified once (push and email), then the row is closed.';

alter table public.ad_campaign_delivery add column if not exists deadline_notified_at timestamptz;

-- owner 2026-10-12: a live fixed-period campaign is told before it ends. The END it
-- was told about is kept, so an extended campaign is told again before its new end.
alter table public.ad_campaigns add column if not exists expiry_notified_for timestamptz;

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── free slots per enabled placement, by activation's own rule ──
create or replace function public.ad_slot_availability() returns jsonb
language sql stable security definer set search_path = public as $$
  with pl as (
    select p.id, p.code,
           greatest(0, coalesce(f.slot_count, s.default_slot_count)
             - (select count(*) from public.ad_slots sl where sl.placement_id = p.id and sl.status = 'disabled'
                  and sl.slot_number <= coalesce(f.slot_count, s.default_slot_count)))::integer as capacity,
           coalesce(f.slot_count, s.default_slot_count) as slot_count
      from public.ad_placements p
      join public.ad_formats f on f.code = p.format_code
      cross join public.ad_platform_settings s
     where s.id and p.enabled and f.enabled
  ), holders as (
    select pl.id as placement_id, o.id as campaign_id, o.end_at, o.pricing_model
      from pl
      join public.ad_slots sl on sl.placement_id = pl.id and sl.slot_number <= pl.slot_count and sl.status <> 'disabled'
      join public.ad_campaigns o on o.id = sl.campaign_id
     where o.status in ('paid', 'validating', 'active', 'paused') and (o.end_at is null or o.end_at > now())
  ), waiting as (
    -- paying or paid, not live yet: each will need a slot
    select c.placement_id, count(*)::integer as n
      from public.ad_campaigns c
     where c.status in ('payment_processing', 'paid', 'validating')
       and not exists (select 1 from public.ad_slots sl where sl.campaign_id = c.id)
     group by c.placement_id
  )
  select jsonb_build_object('at', now(), 'placements', coalesce(jsonb_agg(jsonb_build_object(
      'code', pl.code,
      'capacity', pl.capacity,
      'taken', least(pl.capacity, (select count(distinct h.campaign_id) from holders h where h.placement_id = pl.id) + coalesce(w.n, 0)),
      -- the earliest a held slot is due to end; a views campaign may end sooner (target reached) or later (free extension)
      'next_free_at', (select min(h.end_at) from holders h where h.placement_id = pl.id),
      'next_free_is_estimate', exists (select 1 from holders h where h.placement_id = pl.id and h.pricing_model = 'views_based'))
    order by pl.code), '[]'::jsonb))
    from pl left join waiting w on w.placement_id = pl.id;
$$;

-- ── waitlist rows whose placement has room again, claimed once (the caller sends the notice) ──
create or replace function public.ad_slot_waitlist_due(p_limit integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_avail jsonb := public.ad_slot_availability();
  v_out   jsonb;
begin
  with free as (
    select p.id as placement_id, p.code, p.name
      from jsonb_array_elements(v_avail -> 'placements') a
      join public.ad_placements p on p.code = a ->> 'code'
     where (a ->> 'taken')::integer < (a ->> 'capacity')::integer
  ), due as (
    select w.id from public.ad_slot_waitlist w join free f on f.placement_id = w.placement_id
     where w.notified_at is null
     order by w.created_at limit greatest(1, least(coalesce(p_limit, 100), 500))
     for update of w skip locked
  ), upd as (
    update public.ad_slot_waitlist w set notified_at = now() from due where w.id = due.id
    returning w.user_id, w.placement_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('user_id', u.user_id, 'placement_code', f.code, 'placement_name', f.name)), '[]'::jsonb)
    into v_out
    from upd u join free f on f.placement_id = u.placement_id;
  return v_out;
end;
$$;

-- ── views campaigns whose planned period ends within p_hours and are still short, claimed once ──
create or replace function public.ad_views_deadline_notices(p_hours integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_out jsonb;
begin
  with due as (
    select d.campaign_id from public.ad_campaign_delivery d join public.ad_campaigns c on c.id = d.campaign_id
     where d.phase = 'initial' and d.deadline_notified_at is null and d.delivered_views < d.target_views
       and c.status = 'active' and c.end_at > now() and c.end_at <= now() + make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 168)))
     limit 100
     for update of d skip locked
  ), upd as (
    update public.ad_campaign_delivery d set deadline_notified_at = now() from due where d.campaign_id = due.campaign_id
    returning d.campaign_id, d.target_views, d.delivered_views, d.auto_extend, d.max_extensions
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'campaign_id', u.campaign_id, 'remaining', u.target_views - u.delivered_views, 'end_at', c.end_at,
           'free_extension', u.auto_extend and u.max_extensions > 0)), '[]'::jsonb)
    into v_out
    from upd u join public.ad_campaigns c on c.id = u.campaign_id;
  return v_out;
end;
$$;

-- ── live fixed-period campaigns ending within p_hours, claimed once per end date ──
create or replace function public.ad_expiring_notices(p_hours integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_out jsonb;
begin
  with due as (
    select c.id from public.ad_campaigns c
     where c.status = 'active' and c.pricing_model = 'fixed_period'
       and c.end_at > now() and c.end_at <= now() + make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 168)))
       and c.expiry_notified_for is distinct from c.end_at
     limit 100
     for update skip locked
  ), upd as (
    update public.ad_campaigns c set expiry_notified_for = c.end_at from due where c.id = due.id
    returning c.id, c.end_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('campaign_id', u.id, 'end_at', u.end_at)), '[]'::jsonb) into v_out from upd u;
  return v_out;
end;
$$;

do $$
begin
  revoke all on function public.ad_expiring_notices(integer) from public, anon, authenticated;
  grant execute on function public.ad_expiring_notices(integer) to service_role;
  revoke all on function public.ad_slot_availability() from public;
  grant execute on function public.ad_slot_availability() to anon, authenticated, service_role;
  revoke all on function public.ad_slot_waitlist_due(integer) from public, anon, authenticated;
  grant execute on function public.ad_slot_waitlist_due(integer) to service_role;
  revoke all on function public.ad_views_deadline_notices(integer) from public, anon, authenticated;
  grant execute on function public.ad_views_deadline_notices(integer) to service_role;
end $$;
