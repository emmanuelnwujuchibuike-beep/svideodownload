-- ═══════════════════════════════════════════════════════════════════════════
--  0163 — THE COMPLIMENTARY-CREATION FUNCTIONS (Character Replace Part 11)
-- ═══════════════════════════════════════════════════════════════════════════
-- The five functions of the 0162 design, in their own file: dollar-quoted
-- bodies only, `create or replace` throughout, nothing that could not be run
-- twice. The tables are 0162; the drop of the old claim_ai_job_start overload
-- is 0164. All five are SECURITY DEFINER with a p_user_id argument, so the
-- revokes ride in THIS file, in the closing `do $$ … execute` block: one
-- transaction — either the functions exist revoked, or they do not exist.

-- ── grant: idempotent per member, decided under a lock on the device ────────
create or replace function public.grant_free_entitlement(
  p_user_id          uuid,
  p_product          text,
  p_count            integer,
  p_device_hash      text,
  p_network_hash     text,
  p_max_per_device   integer,
  p_max_per_network  integer,
  p_network_window   interval,
  p_exempt           boolean default false
) returns table (granted integer, used integer, restored integer, eligibility text, granted_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_row       public.ai_free_entitlements%rowtype;
  v_devices   integer := 0;
  v_network   integer := 0;
  v_verdict   text := 'eligible';
  v_grant     integer := greatest(0, coalesce(p_count, 0));
begin
  -- One lock per device: two new accounts racing on the same device serialise here.
  perform pg_advisory_xact_lock(hashtext('ai_free:' || coalesce(p_device_hash, 'no-device')));

  if p_device_hash is not null then
    insert into public.ai_device_associations (device_hash, user_id, network_hash)
    values (p_device_hash, p_user_id, p_network_hash)
    on conflict (device_hash, user_id) do update
      set last_seen_at = now(),
          seen_count = public.ai_device_associations.seen_count + 1,
          network_hash = coalesce(excluded.network_hash, public.ai_device_associations.network_hash);
  end if;

  select * into v_row from public.ai_free_entitlements where user_id = p_user_id and product = p_product;
  if found then
    -- An operator's exemption lifts a device_limit verdict on an existing row; nothing else re-grants.
    if p_exempt and v_row.granted = 0 and v_row.eligibility <> 'eligible' then
      update public.ai_free_entitlements
         set granted = v_grant, eligibility = 'eligible', granted_at = now(), updated_at = now()
       where user_id = p_user_id and product = p_product
       returning * into v_row;
    end if;
    return query select v_row.granted, v_row.used, v_row.restored, v_row.eligibility, v_row.granted_at;
    return;
  end if;

  if not p_exempt then
    if p_device_hash is null then
      -- No device signal yet (the cookie is planted by the first config read) while the device rule is on:
      -- nothing is written — the next read, with the cookie, decides. Never granted blind, never refused for good.
      if p_max_per_device > 0 then
        return query select 0, 0, 0, 'pending'::text, null::timestamptz;
        return;
      end if;
    else
      select count(distinct user_id) into v_devices from public.ai_device_associations
       where device_hash = p_device_hash and free_granted and user_id <> p_user_id;
      if p_max_per_device > 0 and v_devices >= p_max_per_device then
        v_verdict := 'device_limit';
      elsif p_network_hash is not null and p_max_per_network > 0 then
        select count(distinct user_id) into v_network from public.ai_device_associations
         where network_hash = p_network_hash and free_granted and user_id <> p_user_id
           and first_seen_at >= now() - p_network_window;
        if v_network >= p_max_per_network then
          v_verdict := 'device_limit';
        end if;
      end if;
    end if;
  end if;

  insert into public.ai_free_entitlements (user_id, product, granted, used, restored, eligibility, device_hash, network_hash, granted_at)
  values (p_user_id, p_product, case when v_verdict = 'eligible' then v_grant else 0 end, 0, 0, v_verdict, p_device_hash, p_network_hash,
          case when v_verdict = 'eligible' then now() else null end)
  on conflict (user_id, product) do nothing
  returning * into v_row;
  if v_row.user_id is null then
    select * into v_row from public.ai_free_entitlements where user_id = p_user_id and product = p_product;
  end if;

  if v_row.eligibility = 'eligible' and p_device_hash is not null then
    update public.ai_device_associations set free_granted = true where device_hash = p_device_hash and user_id = p_user_id;
  elsif v_row.eligibility = 'device_limit' and p_device_hash is not null then
    update public.ai_device_associations set risk_state = 'limit_reached' where device_hash = p_device_hash and user_id = p_user_id;
  end if;

  return query select v_row.granted, v_row.used, v_row.restored, v_row.eligibility, v_row.granted_at;
end;
$$;

-- ── consume: atomic, one per job, refuses when exhausted ─────────────────────
create or replace function public.consume_free_use(
  p_user_id       uuid,
  p_product       text,
  p_job_id        uuid,
  p_mode          text,
  p_quality       text,
  p_duration_ms   integer,
  p_normal_price  bigint,
  p_currency      text,
  p_snapshot      jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      public.ai_free_entitlements%rowtype;
  v_existing public.ai_free_uses%rowtype;
begin
  select * into v_row from public.ai_free_entitlements where user_id = p_user_id and product = p_product for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'none', 'remaining', 0);
  end if;
  -- Idempotent per job: a retried /start finds the use it already made.
  select * into v_existing from public.ai_free_uses where job_id = p_job_id;
  if found then
    if v_existing.status = 'restored' then
      return jsonb_build_object('ok', false, 'reason', 'restored', 'remaining', v_row.granted - v_row.used);
    end if;
    return jsonb_build_object('ok', true, 'use_number', v_existing.use_number, 'remaining', v_row.granted - v_row.used, 'already', true);
  end if;
  if v_row.eligibility <> 'eligible' or v_row.used >= v_row.granted then
    return jsonb_build_object('ok', false, 'reason', 'exhausted', 'remaining', greatest(0, v_row.granted - v_row.used));
  end if;
  update public.ai_free_entitlements
     set used = used + 1, consumed_at = now(), updated_at = now()
   where user_id = p_user_id and product = p_product
   returning * into v_row;
  insert into public.ai_free_uses (user_id, product, job_id, use_number, status, mode, quality, duration_ms, normal_price_cents, currency, pricing_snapshot)
  values (p_user_id, p_product, p_job_id, v_row.used, 'consumed', p_mode, p_quality, p_duration_ms, coalesce(p_normal_price, 0), coalesce(p_currency, 'USD'), p_snapshot);
  return jsonb_build_object('ok', true, 'use_number', v_row.used, 'remaining', v_row.granted - v_row.used);
end;
$$;

-- ── restore: exactly once per job, only a use still `consumed` ──────────────
create or replace function public.restore_free_use(p_job_id uuid, p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_use public.ai_free_uses%rowtype;
begin
  update public.ai_free_uses
     set status = 'restored', restored_at = now()
   where job_id = p_job_id and status = 'consumed'
   returning * into v_use;
  if not found then
    return false;
  end if;
  update public.ai_free_entitlements
     set used = greatest(0, used - 1), restored = restored + 1, updated_at = now()
   where user_id = v_use.user_id and product = v_use.product;
  return true;
end;
$$;

-- ── settle: the creation was delivered; the use stands ───────────────────────
create or replace function public.settle_free_use(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.ai_free_uses set status = 'settled', settled_at = now() where job_id = p_job_id and status = 'consumed';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- ── the /start claim, now told how the job is funded ─────────────────────────
-- 0158's eight-argument function is dropped in the closing block below (with
-- `execute`, the form that survives after dollar-quoted bodies — the 0130
-- lesson) so the RPC call is never ambiguous between two overloads.

create or replace function public.claim_ai_job_start(
  p_job_id     uuid,
  p_user_id    uuid,
  p_feature    text,
  p_max_user   integer,
  p_max_global integer,
  p_max_daily  integer,
  p_charged    bigint,
  p_metadata   jsonb,
  p_funding    text default 'balance'
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   text;
  v_active   integer;
  v_global   integer;
  v_daily    integer;
  v_updated  integer;
begin
  if p_funding not in ('balance', 'free') then
    raise exception 'unknown funding source: %', p_funding;
  end if;
  perform pg_advisory_xact_lock(hashtext('ai_jobs:start:' || p_feature));

  select status into v_status from public.ai_jobs where id = p_job_id and user_id = p_user_id;
  if v_status is null or v_status <> 'queued' then
    return 'lost';
  end if;

  if p_max_user > 0 then
    select count(*) into v_active from public.ai_jobs
     where user_id = p_user_id and feature = p_feature and id <> p_job_id
       and status in ('acquiring', 'processing', 'finalizing');
    if v_active >= p_max_user then
      return 'user_limit';
    end if;
  end if;

  if p_max_global > 0 then
    select count(*) into v_global from public.ai_jobs
     where feature = p_feature and status in ('acquiring', 'processing', 'finalizing');
    if v_global >= p_max_global then
      return 'global_limit';
    end if;
  end if;

  if p_max_daily > 0 then
    select count(*) into v_daily from public.ai_jobs
     where user_id = p_user_id and feature = p_feature and id <> p_job_id
       and started_at is not null and started_at >= now() - interval '24 hours';
    if v_daily >= p_max_daily then
      return 'daily_limit';
    end if;
  end if;

  update public.ai_jobs
     set status = 'acquiring',
         funding_source = p_funding,
         charged_cents = p_charged,
         metadata = p_metadata,
         started_at = coalesce(started_at, now())
   where id = p_job_id and user_id = p_user_id and status = 'queued';
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    return 'claimed';
  end if;
  return 'lost';
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
--  🔴 REVOKE. POSTGRES GRANTS EXECUTE TO PUBLIC BY DEFAULT.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.grant_free_entitlement(uuid, text, integer, text, text, integer, integer, interval, boolean)',
    'public.consume_free_use(uuid, text, uuid, text, text, integer, bigint, text, jsonb)',
    'public.restore_free_use(uuid, text)',
    'public.settle_free_use(uuid)',
    'public.claim_ai_job_start(uuid, uuid, text, integer, integer, integer, bigint, jsonb, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
