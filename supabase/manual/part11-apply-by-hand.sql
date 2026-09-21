-- ═══════════════════════════════════════════════════════════════════════════
--  PART 11 BY HAND — paste into Supabase → SQL editor → Run (once)
-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-09-20: migrations 0162–0165 were pushed three times (ca2f077, c33a59b,
-- fe6e360) and the GitHub integration applied none of them — not even a file
-- of plain `create table if not exists`. 0160 had applied within three
-- minutes the same morning, so the runner itself stopped, not the SQL: the
-- whole set applies cleanly with the Supabase CLI on a real Postgres and the
-- functions behave (scripts in that session's notes).
--
-- Everything below is idempotent (if not exists / or replace / if exists), so
-- running it after the integration recovers is harmless. The last block
-- records the four versions in the migration ledger so the runner does not
-- try them again, and asks PostgREST to reload its schema cache.
--
-- Files, in order: 0162 tables · 0163 functions + revokes · 0164 old overload
-- dropped · 0165 analytics_visitors_total (growth milestone e-mail).


-- ─────────────────────────────── 0162_ai_free_creations ───────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
--  0162 — COMPLIMENTARY CREATIONS + DEVICE ASSOCIATIONS (Character Replace Part 11)
-- ═══════════════════════════════════════════════════════════════════════════
-- Owner, 2026-09-20: "Every eligible new account gets 2 complimentary Character
-- Replace creations — lifetime, per account, consumed permanently, never
-- refilled, never converted to balance. After both, every video is paid."
--
-- Three tables and five functions, all service-role only (the 0154 rule:
-- a SECURITY DEFINER with a p_user_id argument is "anyone spends anyone's"
-- until revoked). The rechargeable wallet (0154/0155/0159) is untouched:
-- a complimentary creation is an ENTITLEMENT, not money, and it never
-- writes ai_product_ledger.
--
--   ai_free_entitlements   one row per member per product: granted / used /
--                          restored, the eligibility verdict, the device it
--                          was granted on. remaining = granted − used.
--   ai_free_uses           the audit of every use: which job, the use number,
--                          the NORMAL price that was not charged, the pricing
--                          snapshot, consumed / settled / restored. UNIQUE on
--                          job_id — one free use per job, ever.
--   ai_device_associations a pseudonymous device id (an HMAC of a server-set
--                          cookie) ↔ account, first/last seen, whether the
--                          free grant went to this pairing, a coarse network
--                          hash for the secondary signal, a risk state. No raw
--                          fingerprint, no IP.
--
--   grant_free_entitlement   idempotent per member; decides eligibility under
--                            an advisory lock on the device hash so two
--                            accounts racing on one device cannot both win
--   consume_free_use         atomic: row lock, one use per job, refuses when
--                            exhausted, writes the audit row with the snapshot
--   restore_free_use         at most once per job (consumed → restored)
--   settle_free_use          consumed → settled (the creation was delivered)
--   claim_ai_job_start       0158's claim, now with p_funding ('balance' | 'free')
--
-- Split across three files after the first push did not land (2026-09-20):
--   0162  the tables, indexes, RLS, comments        (plain DDL only)
--   0163  the five functions                        (dollar-quoted bodies only)
--   0164  the revokes + the drop of the old overload (one `do $$ … execute` block)
-- Each migration file is its own transaction on the runner; one small file
-- per kind of statement makes a failure name itself.

create table if not exists public.ai_free_entitlements (
  user_id       uuid not null references auth.users (id) on delete cascade,
  product       text not null default 'character_replace',
  granted       integer not null default 0,
  used          integer not null default 0,
  restored      integer not null default 0,
  eligibility   text not null default 'eligible',
  device_hash   text,
  network_hash  text,
  granted_at    timestamptz,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, product),
  constraint ai_free_entitlements_product_chk check (product in ('character_replace')),
  constraint ai_free_entitlements_counts_chk check (granted >= 0 and used >= 0 and used <= granted and restored >= 0),
  constraint ai_free_entitlements_elig_chk check (eligibility in ('eligible', 'device_limit', 'review', 'ineligible'))
);

create table if not exists public.ai_free_uses (
  id                 bigint generated always as identity primary key,
  user_id            uuid not null references auth.users (id) on delete cascade,
  product            text not null default 'character_replace',
  job_id             uuid not null references public.ai_jobs (id) on delete cascade,
  use_number         integer not null,
  status             text not null default 'consumed',
  mode               text,
  quality            text,
  duration_ms        integer,
  normal_price_cents bigint not null default 0,
  currency           text not null default 'USD',
  pricing_snapshot   jsonb,
  consumed_at        timestamptz not null default now(),
  settled_at         timestamptz,
  restored_at        timestamptz,
  constraint ai_free_uses_product_chk check (product in ('character_replace')),
  constraint ai_free_uses_status_chk check (status in ('consumed', 'settled', 'restored'))
);

create unique index if not exists ai_free_uses_job_uniq on public.ai_free_uses (job_id);
create index if not exists ai_free_uses_user_idx on public.ai_free_uses (user_id, product, consumed_at desc);

create table if not exists public.ai_device_associations (
  device_hash   text not null,
  user_id       uuid not null references auth.users (id) on delete cascade,
  network_hash  text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  seen_count    integer not null default 1,
  free_granted  boolean not null default false,
  risk_state    text not null default 'normal',
  primary key (device_hash, user_id),
  constraint ai_device_associations_risk_chk check (risk_state in ('normal', 'limit_reached', 'review'))
);

create index if not exists ai_device_associations_user_idx on public.ai_device_associations (user_id);
create index if not exists ai_device_associations_network_idx on public.ai_device_associations (network_hash, first_seen_at desc) where network_hash is not null;

alter table public.ai_free_entitlements enable row level security;
alter table public.ai_free_uses enable row level security;
alter table public.ai_device_associations enable row level security;

comment on table public.ai_free_entitlements is 'Complimentary Character Replace creations per member (Part 11): granted/used/restored and the eligibility verdict. Service role only; the API answers the member.';
comment on table public.ai_free_uses is 'Every complimentary creation used: the job, the use number, the normal price that was NOT charged, the pricing snapshot, consumed/settled/restored.';
comment on table public.ai_device_associations is 'Pseudonymous device ↔ account pairings for the complimentary-creation limit. An HMAC of a server-set cookie and a coarse network hash — never a raw fingerprint or an IP.';

-- ─────────────────────────────── 0163_ai_free_creations_functions ───────────────────────────────

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

-- ─────────────────────────────── 0164_ai_free_creations_grants ───────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
--  0164 — DROP THE OLD claim_ai_job_start OVERLOAD (Character Replace Part 11)
-- ═══════════════════════════════════════════════════════════════════════════
-- 0158's eight-argument claim is dropped so the RPC is never ambiguous
-- between two overloads (PostgREST answers PGRST203 for an ambiguous call;
-- lib/ai/job-store.ts falls back to the eight-argument call on 202/203 until
-- this lands). Inside a `do $$ … execute` block, alone in its file.

do $$
begin
  execute 'drop function if exists public.claim_ai_job_start(uuid, uuid, text, integer, integer, integer, bigint, jsonb)';
end $$;

-- ─────────────────────────────── 0165_analytics_visitors_total ───────────────────────────────

-- 0165 (was 0161; renumbered while it had not applied) · The all-time unique-visitor count for the growth milestone email
-- (owner, 2026-09-20: "an email on every 1,000 or 10,000 visitors and users
-- milestone, like the download milestone"). One index-only DISTINCT over the
-- human events, in Postgres, the same definition the dashboard's "unique
-- visitors" uses — bots excluded, a visitor is a device, no IP anywhere.
-- SECURITY DEFINER like the other analytics readers (0115), revoked from the
-- browser roles the same way, inside one block with `execute` at the end.

create or replace function public.analytics_visitors_total()
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(distinct visitor_id) from public.analytics_events where is_bot = false;
$$;

do $$
begin
  execute 'revoke all on function public.analytics_visitors_total() from public, anon, authenticated';
  execute 'grant execute on function public.analytics_visitors_total() to service_role';
end $$;

-- ─────────────────────────────── the ledger + the cache ───────────────────────────────
do $$
begin
  insert into supabase_migrations.schema_migrations (version, name)
  values ('0162', 'ai_free_creations'), ('0163', 'ai_free_creations_functions'),
         ('0164', 'ai_free_creations_grants'), ('0165', 'analytics_visitors_total')
  on conflict (version) do nothing;
exception when others then
  raise notice 'migration ledger not updated (%): the runner may re-apply 0162-0165, which is harmless', sqlerrm;
end $$;

notify pgrst, 'reload schema';
