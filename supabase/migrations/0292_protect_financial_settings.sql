-- ═══════════════════════════════════════════════════════════════════════════
--  0292 — Financial configuration can only be changed through its audited writers (Frenz Gift Coin Part 3 follow-up, 2026-10-27)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── The bypass ───────────────────────────────────────────────────────────────
--   0001 gave the settings table the policy "settings admin all" (for all using is_admin()), and Supabase grants every
--   public table to anon and authenticated by default. So any administrator, with their own browser session, could
--   PATCH, POST or DELETE the landing row through the REST API (/rest/v1/settings) and rewrite frenzGift.conversion
--   with no validation, no version check and no audit row (and frenzCoin and frenzRewards the same way). Separately,
--   nothing in the database stopped a service-role write (a stale read-merge-write, a future bug) from replacing
--   frenzGift: only application code did.
--
-- ── What closes it ───────────────────────────────────────────────────────────
--   1 · No API role writes the settings table. The policy becomes "settings admin read" (select only, still
--       is_admin()), and insert, update, delete and truncate are revoked from anon and authenticated. Every legitimate
--       writer of settings in the app is the server's service-role client, which RLS does not apply to, so nothing that
--       works today stops working. Administrators still READ settings exactly as before.
--   2 · settings_gift_guard, a row trigger on settings (before insert, update, delete): on the landing row, frenzGift
--       may change ONLY inside save_frenz_gift_conversion: the transaction-local flag frenz.gift_settings_writer must be
--       on AND the current role must not be an API role (anon, authenticated, service_role). Inside the security definer
--       function the current role is its owner, so setting the flag from an API session (or from service-role code)
--       never opens it. Refused, whoever asks: changing or removing frenzGift directly, deleting the landing row that
--       holds it, renaming its key, replacing the value with a non-object. Every other key of every row, and every
--       other row, is untouched by this guard.
--   3 · settings_truncate_guard: a statement trigger refusing TRUNCATE of settings (row triggers do not fire on it).
--   4 · save_frenz_gift_conversion restated with the flag around its one update: it still locks the row, refuses a
--       stale version, validates (fgc_conversion_rules_check), bumps the version only for a change, and writes
--       financial_audit_log and config_audit_log in the same transaction. It is the only path that changes frenzGift.
--
--   save_landing_settings (0291) keeps frenzGift as stored, so it passes the guard unchanged. A stale read-merge-write
--   carrying an old frenzGift (the pre-0291 fallback racing a gift save) is now REFUSED, never a silent rollback.
--
-- Depends on 0001, 0144 (is_admin), 0291. Run by hand AFTER 0291. Safe to run twice.
-- No semicolon inside any quoted string or comment. Every dollar-quoted block is at the end.

-- ── 1 · settings: administrators read, nobody writes through the API ─────────
drop policy if exists "settings admin all" on public.settings;
drop policy if exists "settings admin read" on public.settings;
create policy "settings admin read" on public.settings for select using (public.is_admin());
revoke insert, update, delete, truncate on public.settings from public, anon, authenticated;
grant select on public.settings to authenticated;
grant all on public.settings to service_role;
comment on table public.settings is 'Site configuration, one row per key. Administrators may read it (RLS). Writes come only from the server (service role) and the audited database writers: no API role may write it (0292). landing.frenzGift changes only through save_frenz_gift_conversion (settings_gift_guard).';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

-- landing.frenzGift changes only inside save_frenz_gift_conversion (see the header).
create or replace function public.settings_gift_guard() returns trigger
language plpgsql as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_ok  boolean := coalesce(current_setting('frenz.gift_settings_writer', true), '') = 'on' and current_user not in ('anon', 'authenticated', 'service_role');
begin
  if tg_op in ('UPDATE', 'DELETE') and old.key = 'landing' then
    v_old := case when jsonb_typeof(old.value) = 'object' then old.value -> 'frenzGift' end;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.key = 'landing' then
    v_new := case when jsonb_typeof(new.value) = 'object' then new.value -> 'frenzGift' end;
  end if;
  -- the landing row keeps its frenzGift unless the gift writer is the one changing it
  if (v_old is distinct from v_new) and not v_ok then
    raise exception 'landing.frenzGift is changed only by save_frenz_gift_conversion (0292)' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.settings_truncate_guard() returns trigger
language plpgsql as $$
begin
  raise exception 'the settings table is never truncated (0292)' using errcode = '42501';
end;
$$;

-- 0291's writer, restated word for word with the writer flag around its one update (marked 0292).
create or replace function public.save_frenz_gift_conversion(p_admin uuid, p_legs jsonb, p_expected_version bigint, p_validation jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_value jsonb;
  v_gift  jsonb;
  v_cur   jsonb;
  v_ver   bigint := 0;
  v_new   jsonb;
  v_err   text;
  v_leg   text;
  v_legs  jsonb := '{}'::jsonb;
  v_l     jsonb;
  v_at    timestamptz := now();
begin
  if p_admin is null or p_legs is null or jsonb_typeof(p_legs) <> 'object' or p_expected_version is null or p_expected_version < 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  insert into public.settings (key, value) values ('landing', '{}'::jsonb) on conflict (key) do nothing;
  select value into v_value from public.settings where key = 'landing' for update;
  v_gift := case when jsonb_typeof(v_value -> 'frenzGift') = 'object' then v_value -> 'frenzGift' else '{}'::jsonb end;
  v_cur := case when jsonb_typeof(v_gift -> 'conversion') = 'object' then v_gift -> 'conversion' end;
  if v_cur is not null and (v_cur ->> 'version') ~ '^[0-9]{1,15}$' then v_ver := (v_cur ->> 'version')::bigint; end if;
  if p_expected_version <> v_ver then
    insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
    values (p_admin, 'gift_conversion_config_rejected', 'settings', 'frenzGift', 'frenz-gift-config', jsonb_build_object('reason', 'stale', 'expected_version', p_expected_version, 'version', v_ver));
    return jsonb_build_object('ok', false, 'reason', 'stale', 'version', v_ver);
  end if;
  -- exactly the seven fields of each leg: nothing else the caller sent is stored
  foreach v_leg in array array['fcToFgc', 'fgcToFc'] loop
    v_l := p_legs -> v_leg;
    if v_l is null or jsonb_typeof(v_l) <> 'object' then v_legs := v_legs || jsonb_build_object(v_leg, v_l);
    else
      v_legs := v_legs || jsonb_build_object(v_leg, jsonb_build_object('rateNum', v_l -> 'rateNum', 'rateDen', v_l -> 'rateDen', 'feeBp', v_l -> 'feeBp', 'feeFlat', v_l -> 'feeFlat',
                                                                       'minIn', v_l -> 'minIn', 'maxIn', v_l -> 'maxIn', 'dailyMaxIn', v_l -> 'dailyMaxIn'));
    end if;
  end loop;
  if v_cur is not null and (v_cur - 'version') = v_legs then
    return jsonb_build_object('ok', true, 'unchanged', true, 'version', v_ver, 'conversion', v_cur);
  end if;
  v_new := jsonb_build_object('version', v_ver + 1) || v_legs;
  v_err := public.fgc_conversion_rules_check(v_new);
  if v_err is not null then
    insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
    values (p_admin, 'gift_conversion_config_rejected', 'settings', 'frenzGift', 'frenz-gift-config', jsonb_build_object('reason', v_err, 'attempted', v_new, 'version', v_ver));
    return jsonb_build_object('ok', false, 'reason', 'invalid', 'detail', v_err, 'version', v_ver);
  end if;
  -- 0292: the only write of frenzGift, under the writer flag the settings guard requires (inside this definer only)
  perform set_config('frenz.gift_settings_writer', 'on', true);
  update public.settings
     set value = jsonb_set(case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end, '{frenzGift}',
                           v_gift || jsonb_build_object('conversion', v_new, 'updatedAt', v_at, 'updatedBy', p_admin), true)
   where key = 'landing';
  perform set_config('frenz.gift_settings_writer', 'off', true);
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_admin, 'gift_conversion_config_updated', 'settings', 'frenzGift', 'frenz-gift-config:v' || (v_ver + 1)::text,
          jsonb_build_object('before', v_cur, 'after', v_new, 'version', v_ver + 1, 'validation', coalesce(p_validation, '{}'::jsonb) || jsonb_build_object('database_check', 'valid')));
  insert into public.config_audit_log (actor_id, surface, target_id, action, before, after)
  values (p_admin, 'frenz_gift', 'settings', 'settings.update', jsonb_build_object('conversion', v_cur),
          jsonb_build_object('conversion', v_new, 'validation', coalesce(p_validation, '{}'::jsonb)));
  return jsonb_build_object('ok', true, 'version', v_ver + 1, 'conversion', v_new, 'updated_at', v_at);
end;
$$;

do $$
begin
  execute 'drop trigger if exists settings_gift_guard on public.settings';
  execute 'create trigger settings_gift_guard before insert or update or delete on public.settings for each row execute function public.settings_gift_guard()';
  execute 'drop trigger if exists settings_truncate_guard on public.settings';
  execute 'create trigger settings_truncate_guard before truncate on public.settings for each statement execute function public.settings_truncate_guard()';

  execute 'revoke all on function public.settings_gift_guard() from public, anon, authenticated';
  execute 'revoke all on function public.settings_truncate_guard() from public, anon, authenticated';
  execute 'revoke all on function public.save_frenz_gift_conversion(uuid, jsonb, bigint, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.save_frenz_gift_conversion(uuid, jsonb, bigint, jsonb) to service_role';
end;
$$;
