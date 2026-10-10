-- 0219 — the admin "×10 for every live campaign" switch now STAYS on.
--
-- Owner, 2026-10-10: "The 10x user advert stat seems not to be working."
-- Measured on production: two campaigns at ×10, and the newest live campaign
-- ("Top banner campaign") at ×1. The 0212 "all live" button stamped ×10 on the
-- campaigns live AT THAT MOMENT and nothing else, so every campaign that went
-- live afterwards silently showed real figures.
--
-- Now the switch is a standing setting: while it is on, a campaign that
-- becomes active (activation, admin test publish, a resume) starts at ×10. Turning it
-- off stops that, and it does not touch a campaign that is already boosted (the
-- per-campaign switch and the "all live → real figures" button still do).
--
-- Display only, exactly as 0212: stored counts, billing and refunds are never
-- scaled. The setting is a column on ad_private_settings (0206, readable by no
-- client role), because ad_platform_settings is readable by everyone and
-- whether figures are boosted is not public information.

alter table public.ad_private_settings add column if not exists stats_boost_new_live smallint not null default 1;
alter table public.ad_private_settings add column if not exists stats_boost_updated_at timestamptz;
alter table public.ad_private_settings add column if not exists stats_boost_updated_by uuid;
alter table public.ad_private_settings drop constraint if exists ad_private_settings_boost_chk;
alter table public.ad_private_settings add constraint ad_private_settings_boost_chk check (stats_boost_new_live in (1, 10));
comment on column public.ad_private_settings.stats_boost_new_live is '0219: 10 = every campaign that becomes active starts with stats_multiplier 10 (display only). 1 = off.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN. NO PLAIN DDL BELOW EXCEPT TRIGGERS.
-- ═════════════════════════════════════════════════════════════════════════════

-- A campaign BECOMING active inherits the standing ×10. Only on that edge, and
-- only from ×1: a campaign an admin set back to real figures while it was live
-- is not re-boosted on every later update.
create or replace function public.ad_campaigns_inherit_boost() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active'
     and (tg_op = 'INSERT' or old.status is distinct from 'active')
     and new.stats_multiplier = 1
     and exists (select 1 from public.ad_private_settings s where s.id and s.stats_boost_new_live = 10) then
    new.stats_multiplier := 10;
  end if;
  return new;
end;
$$;

-- The standing switch, for the admin API (service role). Records who set it.
create or replace function public.admin_set_ad_stats_boost_new_live(p_multiplier integer, p_admin uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_admin is null or p_multiplier is null or p_multiplier not in (1, 10) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  update public.ad_private_settings set stats_boost_new_live = p_multiplier, stats_boost_updated_at = now(), stats_boost_updated_by = p_admin where id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_settings_row'); end if;
  return jsonb_build_object('ok', true, 'multiplier', p_multiplier);
end;
$$;

do $$
begin
  drop trigger if exists ad_campaigns_inherit_boost on public.ad_campaigns;
  create trigger ad_campaigns_inherit_boost before insert or update on public.ad_campaigns
    for each row execute function public.ad_campaigns_inherit_boost();
  revoke all on function public.ad_campaigns_inherit_boost() from public, anon, authenticated;
  revoke all on function public.admin_set_ad_stats_boost_new_live(integer, uuid) from public, anon, authenticated;
end;
$$;
