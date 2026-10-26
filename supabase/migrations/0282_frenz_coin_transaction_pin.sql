-- ═══════════════════════════════════════════════════════════════════════════
--  0282 — Frenz Coin: the financial transaction PIN (Frenz Coin Part 4.2, 2026-10-25)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A Frenz Coin transfer must be confirmed with the member's own six-digit TRANSACTION PIN — not the messaging quick-lock
-- PIN (0056 security_pin), which unlocks a screen and is never accepted for money.
--
-- ── How a PIN is checked (the hash never leaves the database) ──────────────
--   1. begin_coin_pin_attempt   under the PIN row lock: refused while locked; otherwise the attempt is COUNTED NOW (as a
--                               failure until proven otherwise) and a single-use attempt row (2 minutes) is returned with
--                               the salt and hash parameters — never the hash. Counting before checking means parallel
--                               guesses cannot exceed the limit, and an abandoned attempt still counts.
--   2. the server derives the key: scrypt(HMAC-SHA256(server pepper, the PIN), salt) — lib/coin/pin.ts. The pepper is
--      never in the database, so a copy of these tables alone cannot be brute-forced.
--   3. coin_pin_check (internal)  consumes the attempt row once, compares the key with the stored hash, then: success
--                               resets the counters; failure keeps the count and, at the limit, locks for
--                               lockMinutes × 2^(locks so far) — capped at 24 hours, never permanent.
--   transfer_coins_with_pin     steps 3 + transfer_coins in ONE transaction: the PIN, the attempt and the exact transfer
--                               (recipient, amount, idempotency key, the server's fee rules) are bound by being one call.
--                               No reusable authorization token exists. transfer_coins itself is no longer callable by
--                               the service role: this is the only door to a coin transfer.
--   set_coin_pin / change_coin_pin   setup (never replaces an existing PIN; confirmed email; not suspended) and change
--                               (the current PIN, through the same counted attempt).
--   request_coin_pin_reset / complete_coin_pin_reset   an emailed code: only its HMAC is stored, 10 minutes, single
--                               use, a new one supersedes the old, a few wrong tries kill it, a few per hour per member.
--                               Completing it sets the new PIN, clears the locks and voids open attempts — atomically.
--
-- Limits come from the audited frenzCoin.pin settings and are clamped again here (coin_pin_setting).
-- Every table: RLS on, no grants to anon / authenticated / service_role — only these functions touch them, and the PIN
-- hash cannot be read through the API even with the service key. Rows are security material, not financial history:
-- they go with the account (on delete cascade). The audit trail (financial_audit_log) never holds a PIN, hash or code.
--
-- Depends on 0278 (financial_audit_log, profiles.is_suspended), 0279 / 0281 (transfer_coins). Run by hand AFTER 0281
-- (and again after any re-run of 0279 / 0280 / 0281, which would grant transfer_coins back). Safe to run twice.
-- No semicolon inside any quoted string. Every dollar-quoted block is last.

create table if not exists public.coin_pins (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  pin_hash        bytea not null,
  pin_salt        bytea not null,
  params          jsonb not null,
  failed_attempts integer not null default 0,
  lock_count      integer not null default 0,
  locked_until    timestamptz,
  last_failed_at  timestamptz,
  last_success_at timestamptz,
  set_at          timestamptz not null default now(),
  changed_at      timestamptz,
  updated_at      timestamptz not null default now(),
  constraint coin_pins_hash_chk check (octet_length(pin_hash) between 32 and 64 and octet_length(pin_salt) between 16 and 64),
  constraint coin_pins_counts_chk check (failed_attempts >= 0 and lock_count >= 0)
);
alter table public.coin_pins enable row level security;
revoke all on public.coin_pins from public, anon, authenticated, service_role;
comment on table public.coin_pins is 'Frenz Coin transaction PIN (0282): a scrypt hash of HMAC(server pepper, PIN) with its salt and parameters, and the attempt counters. Readable by NO API role, service role included: only the coin PIN functions use it. Never the messaging quick-lock PIN.';

create table if not exists public.coin_pin_attempts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  purpose     text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  outcome     text,
  constraint coin_pin_attempts_purpose_chk check (purpose in ('transfer', 'change')),
  constraint coin_pin_attempts_outcome_chk check (outcome is null or outcome in ('ok', 'failed', 'locked', 'reset'))
);
create index if not exists coin_pin_attempts_user_idx on public.coin_pin_attempts (user_id, created_at desc);
alter table public.coin_pin_attempts enable row level security;
revoke all on public.coin_pin_attempts from public, anon, authenticated, service_role;
comment on table public.coin_pin_attempts is 'Frenz Coin PIN attempts (0282): one single-use row per PIN entry, counted when it begins. No PIN or key is stored. Function access only.';

create table if not exists public.coin_pin_resets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  code_hash     bytea not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  attempts      integer not null default 0,
  consumed_at   timestamptz,
  superseded_at timestamptz,
  failed_at     timestamptz,
  constraint coin_pin_resets_hash_chk check (octet_length(code_hash) = 32),
  constraint coin_pin_resets_attempts_chk check (attempts >= 0)
);
-- at most ONE live reset per member: a new one supersedes the old in the same transaction
create unique index if not exists coin_pin_resets_live_uidx on public.coin_pin_resets (user_id) where consumed_at is null and superseded_at is null and failed_at is null;
create index if not exists coin_pin_resets_user_idx on public.coin_pin_resets (user_id, created_at desc);
alter table public.coin_pin_resets enable row level security;
revoke all on public.coin_pin_resets from public, anon, authenticated, service_role;
comment on table public.coin_pin_resets is 'Frenz Coin PIN reset codes (0282): only an HMAC(server pepper) of the emailed code, its expiry, tries and single use. Function access only.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

-- One policy number from the server's settings, clamped to safe bounds (a bad or missing value = the default).
create or replace function public.coin_pin_setting(p_policy jsonb, p_key text, p_default integer, p_min integer, p_max integer) returns integer
language plpgsql immutable as $$
declare
  v text := p_policy ->> p_key;
begin
  if v is null or v !~ '^[0-9]{1,6}$' then return p_default; end if;
  return greatest(p_min, least(p_max, v::integer));
end;
$$;

-- Lock the PIN after too many failures: lockMinutes × 2^(locks so far), at most 24 hours. Internal (the caller holds the row lock).
create or replace function public.coin_pin_lock(p_user uuid, p_policy jsonb, p_why text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_lock_count integer;
  v_minutes    integer;
  v_until      timestamptz;
begin
  select lock_count into v_lock_count from public.coin_pins where user_id = p_user;
  v_minutes := least(1440, public.coin_pin_setting(p_policy, 'lockMinutes', 15, 5, 1440) * (2 ^ least(coalesce(v_lock_count, 0), 7))::integer);
  v_until := now() + make_interval(mins => v_minutes);
  update public.coin_pins set locked_until = v_until, lock_count = lock_count + 1, failed_attempts = 0, updated_at = now() where user_id = p_user;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, details)
  values (p_user, 'coin_pin_locked', 'coin_pin', p_user::text, jsonb_build_object('minutes', v_minutes, 'locks', coalesce(v_lock_count, 0) + 1, 'why', p_why));
  return v_until;
end;
$$;

-- Is a PIN set, and is it locked? (The member's own state, for their wallet. Never the hash.)
create or replace function public.coin_pin_status(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v public.coin_pins%rowtype;
begin
  select * into v from public.coin_pins where user_id = p_user;
  return jsonb_build_object('set', v.user_id is not null, 'locked_until', case when v.locked_until > now() then v.locked_until end);
end;
$$;

-- First-time setup. Never replaces an existing PIN (that is change or reset). Confirmed email, not suspended.
create or replace function public.set_coin_pin(p_user uuid, p_hash bytea, p_salt bytea, p_params jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_done uuid;
begin
  if p_user is null or p_hash is null or p_salt is null or octet_length(p_hash) not between 32 and 64 or octet_length(p_salt) not between 16 and 64
     or p_params is null or p_params ->> 'algorithm' is distinct from 'scrypt' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if not exists (select 1 from auth.users where id = p_user and email_confirmed_at is not null) then return jsonb_build_object('ok', false, 'reason', 'email_unconfirmed'); end if;
  if exists (select 1 from public.profiles where id = p_user and is_suspended) then return jsonb_build_object('ok', false, 'reason', 'suspended'); end if;
  insert into public.coin_pins (user_id, pin_hash, pin_salt, params) values (p_user, p_hash, p_salt, p_params)
  on conflict (user_id) do nothing
  returning user_id into v_done;
  if v_done is null then return jsonb_build_object('ok', false, 'reason', 'exists'); end if;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, details)
  values (p_user, 'coin_pin_set', 'coin_pin', p_user::text, jsonb_build_object('algorithm', p_params ->> 'algorithm', 'pepper', p_params ->> 'pepper'));
  return jsonb_build_object('ok', true);
end;
$$;

-- Begin ONE PIN entry: counted now, single use, two minutes. Returns the salt and parameters, never the hash.
create or replace function public.begin_coin_pin_attempt(p_user uuid, p_purpose text, p_policy jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v     public.coin_pins%rowtype;
  v_max integer := public.coin_pin_setting(p_policy, 'maxAttempts', 5, 3, 10);
  v_id  uuid;
begin
  if p_user is null or p_purpose is null or p_purpose not in ('transfer', 'change') then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select * into v from public.coin_pins where user_id = p_user for update;
  if v.user_id is null then return jsonb_build_object('ok', false, 'reason', 'no_pin'); end if;
  if v.locked_until is not null and v.locked_until > now() then return jsonb_build_object('ok', false, 'reason', 'locked', 'retry_after', v.locked_until); end if;
  -- every slot is taken by attempts that began and never proved themselves: that IS the limit — lock (never forever)
  if v.failed_attempts >= v_max then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'retry_after', public.coin_pin_lock(p_user, p_policy, 'attempts_exhausted'));
  end if;
  update public.coin_pins set failed_attempts = failed_attempts + 1, updated_at = now() where user_id = p_user;
  delete from public.coin_pin_attempts where user_id = p_user and created_at < now() - interval '1 day';
  insert into public.coin_pin_attempts (user_id, purpose, expires_at) values (p_user, p_purpose, now() + interval '2 minutes') returning id into v_id;
  return jsonb_build_object('ok', true, 'attempt_id', v_id, 'salt', encode(v.pin_salt, 'hex'), 'params', v.params);
end;
$$;

-- Check ONE begun attempt (internal: callers are the functions below). 'ok' | 'failed' | 'locked' | 'no_pin' | 'no_attempt'.
create or replace function public.coin_pin_check(p_user uuid, p_attempt uuid, p_derived bytea, p_purpose text, p_policy jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v     public.coin_pins%rowtype;
  v_att uuid;
  v_max integer := public.coin_pin_setting(p_policy, 'maxAttempts', 5, 3, 10);
begin
  select * into v from public.coin_pins where user_id = p_user for update;
  if v.user_id is null then return 'no_pin'; end if;
  -- the attempt is used up here, whatever happens next: one PIN entry, one check
  update public.coin_pin_attempts set consumed_at = now()
   where id = p_attempt and user_id = p_user and purpose = p_purpose and consumed_at is null and expires_at > now()
  returning id into v_att;
  if v_att is null then return 'no_attempt'; end if;
  if v.locked_until is not null and v.locked_until > now() then
    update public.coin_pin_attempts set outcome = 'locked' where id = v_att;
    return 'locked';
  end if;
  if p_derived is not null and octet_length(p_derived) = octet_length(v.pin_hash) and p_derived = v.pin_hash then
    update public.coin_pins set failed_attempts = 0, lock_count = 0, locked_until = null, last_success_at = now(), updated_at = now() where user_id = p_user;
    update public.coin_pin_attempts set outcome = 'ok' where id = v_att;
    return 'ok';
  end if;
  -- a wrong PIN: the attempt was counted when it began
  update public.coin_pin_attempts set outcome = 'failed' where id = v_att;
  update public.coin_pins set last_failed_at = now(), updated_at = now() where user_id = p_user;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, details)
  values (p_user, 'coin_pin_failed', 'coin_pin', p_user::text, jsonb_build_object('purpose', p_purpose, 'failures', v.failed_attempts, 'limit', v_max));
  if v.failed_attempts >= v_max then perform public.coin_pin_lock(p_user, p_policy, 'too_many_failures'); end if;
  return 'failed';
end;
$$;

-- A coin transfer confirmed with the PIN: the check and the transfer in ONE transaction. The only door to transfer_coins.
create or replace function public.transfer_coins_with_pin(
  p_sender uuid, p_attempt uuid, p_derived bytea, p_account_number text, p_amount bigint, p_idempotency text, p_note text, p_rules jsonb, p_policy jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_check text;
  v_out   jsonb;
begin
  if p_sender is null or p_attempt is null then return jsonb_build_object('ok', false, 'reason', 'authorization_failed'); end if;
  v_check := public.coin_pin_check(p_sender, p_attempt, p_derived, 'transfer', p_policy);
  if v_check <> 'ok' then
    -- one answer for every way a PIN can fail: nothing about whether a PIN, a lock or an attempt exists
    return jsonb_build_object('ok', false, 'reason', 'authorization_failed');
  end if;
  v_out := public.transfer_coins(p_sender, p_account_number, p_amount, p_idempotency, p_note, p_rules);
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_sender, case when (v_out ->> 'ok')::boolean then 'coin_transfer_authorized' else 'coin_transfer_refused' end, 'coin_transfer',
          v_out ->> 'transfer_id', case when v_out ? 'transfer_id' then 'coin-transfer:' || (v_out ->> 'transfer_id') end,
          jsonb_build_object('amount_cents', p_amount, 'reason', v_out ->> 'reason', 'duplicate', coalesce((v_out ->> 'duplicate')::boolean, false)));
  return v_out;
end;
$$;

-- Change the PIN: the current one through a counted attempt, then the new one, atomically.
create or replace function public.change_coin_pin(p_user uuid, p_attempt uuid, p_current bytea, p_hash bytea, p_salt bytea, p_params jsonb, p_policy jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_check text;
begin
  if p_hash is null or p_salt is null or octet_length(p_hash) not between 32 and 64 or octet_length(p_salt) not between 16 and 64
     or p_params is null or p_params ->> 'algorithm' is distinct from 'scrypt' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  v_check := public.coin_pin_check(p_user, p_attempt, p_current, 'change', p_policy);
  if v_check <> 'ok' then return jsonb_build_object('ok', false, 'reason', 'authorization_failed'); end if;
  update public.coin_pins set pin_hash = p_hash, pin_salt = p_salt, params = p_params, changed_at = now(), updated_at = now() where user_id = p_user;
  update public.coin_pin_resets set superseded_at = now() where user_id = p_user and consumed_at is null and superseded_at is null and failed_at is null;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, details)
  values (p_user, 'coin_pin_changed', 'coin_pin', p_user::text, jsonb_build_object('via', 'current_pin'));
  return jsonb_build_object('ok', true);
end;
$$;

-- Issue a reset code (the server emails it; only its HMAC is here). Answers the same whatever happened: issued says
-- whether to send. Confirmed email, not suspended, a PIN to reset, and a few per hour.
create or replace function public.request_coin_pin_reset(p_user uuid, p_code_hash bytea, p_policy jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ttl  integer := public.coin_pin_setting(p_policy, 'resetTtlMinutes', 10, 5, 30);
  v_hour integer := public.coin_pin_setting(p_policy, 'resetMaxPerHour', 3, 1, 10);
  v_n    integer;
begin
  if p_user is null or p_code_hash is null or octet_length(p_code_hash) <> 32 then return jsonb_build_object('ok', true, 'issued', false); end if;
  -- one member's requests queue on their PIN row (the hourly count and the supersede are then exact)
  perform 1 from public.coin_pins where user_id = p_user for update;
  if not found then return jsonb_build_object('ok', true, 'issued', false); end if;
  if not exists (select 1 from auth.users where id = p_user and email_confirmed_at is not null) or exists (select 1 from public.profiles where id = p_user and is_suspended) then
    return jsonb_build_object('ok', true, 'issued', false);
  end if;
  select count(*) into v_n from public.coin_pin_resets where user_id = p_user and created_at > now() - interval '1 hour';
  if v_n >= v_hour then
    insert into public.financial_audit_log (actor_id, action, target_type, target_id, details)
    values (p_user, 'coin_pin_reset_throttled', 'coin_pin', p_user::text, jsonb_build_object('last_hour', v_n));
    return jsonb_build_object('ok', true, 'issued', false);
  end if;
  update public.coin_pin_resets set superseded_at = now() where user_id = p_user and consumed_at is null and superseded_at is null and failed_at is null;
  insert into public.coin_pin_resets (user_id, code_hash, expires_at) values (p_user, p_code_hash, now() + make_interval(mins => v_ttl));
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, details)
  values (p_user, 'coin_pin_reset_requested', 'coin_pin', p_user::text, jsonb_build_object('expires_minutes', v_ttl));
  return jsonb_build_object('ok', true, 'issued', true, 'expires_minutes', v_ttl);
end;
$$;

-- Complete a reset: the live code, once, before it expires, within its tries — then the new PIN, atomically.
create or replace function public.complete_coin_pin_reset(p_user uuid, p_code_hash bytea, p_hash bytea, p_salt bytea, p_params jsonb, p_policy jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_max integer := public.coin_pin_setting(p_policy, 'resetCodeMaxAttempts', 5, 3, 10);
  v_r   public.coin_pin_resets%rowtype;
begin
  if p_user is null or p_code_hash is null or octet_length(p_code_hash) <> 32 or p_hash is null or p_salt is null
     or octet_length(p_hash) not between 32 and 64 or octet_length(p_salt) not between 16 and 64 or p_params ->> 'algorithm' is distinct from 'scrypt' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  perform 1 from public.coin_pins where user_id = p_user for update;
  select * into v_r from public.coin_pin_resets
   where user_id = p_user and consumed_at is null and superseded_at is null and failed_at is null
   for update;
  if v_r.id is null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if v_r.expires_at <= now() then
    update public.coin_pin_resets set failed_at = now() where id = v_r.id;
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if p_code_hash <> v_r.code_hash then
    update public.coin_pin_resets set attempts = attempts + 1, failed_at = case when attempts + 1 >= v_max then now() end where id = v_r.id;
    insert into public.financial_audit_log (actor_id, action, target_type, target_id, details)
    values (p_user, 'coin_pin_reset_failed', 'coin_pin', p_user::text, jsonb_build_object('tries', v_r.attempts + 1, 'limit', v_max, 'code_dead', v_r.attempts + 1 >= v_max));
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  update public.coin_pin_resets set consumed_at = now() where id = v_r.id;
  update public.coin_pins set pin_hash = p_hash, pin_salt = p_salt, params = p_params, failed_attempts = 0, lock_count = 0, locked_until = null, changed_at = now(), updated_at = now()
   where user_id = p_user;
  if not found then
    insert into public.coin_pins (user_id, pin_hash, pin_salt, params, changed_at) values (p_user, p_hash, p_salt, p_params, now());
  end if;
  -- any PIN entry begun before the reset is void
  update public.coin_pin_attempts set consumed_at = now(), outcome = 'reset' where user_id = p_user and consumed_at is null;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, details)
  values (p_user, 'coin_pin_reset_completed', 'coin_pin', p_user::text, jsonb_build_object('via', 'email_code'));
  return jsonb_build_object('ok', true);
end;
$$;

do $$
begin
  execute 'revoke all on function public.coin_pin_setting(jsonb, text, integer, integer, integer) from public, anon, authenticated';
  execute 'revoke all on function public.coin_pin_lock(uuid, jsonb, text) from public, anon, authenticated, service_role';
  execute 'revoke all on function public.coin_pin_check(uuid, uuid, bytea, text, jsonb) from public, anon, authenticated, service_role';
  execute 'revoke all on function public.coin_pin_status(uuid) from public, anon, authenticated';
  execute 'revoke all on function public.set_coin_pin(uuid, bytea, bytea, jsonb) from public, anon, authenticated';
  execute 'revoke all on function public.begin_coin_pin_attempt(uuid, text, jsonb) from public, anon, authenticated';
  execute 'revoke all on function public.transfer_coins_with_pin(uuid, uuid, bytea, text, bigint, text, text, jsonb, jsonb) from public, anon, authenticated';
  execute 'revoke all on function public.change_coin_pin(uuid, uuid, bytea, bytea, bytea, jsonb, jsonb) from public, anon, authenticated';
  execute 'revoke all on function public.request_coin_pin_reset(uuid, bytea, jsonb) from public, anon, authenticated';
  execute 'revoke all on function public.complete_coin_pin_reset(uuid, bytea, bytea, bytea, jsonb, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.coin_pin_status(uuid) to service_role';
  execute 'grant execute on function public.set_coin_pin(uuid, bytea, bytea, jsonb) to service_role';
  execute 'grant execute on function public.begin_coin_pin_attempt(uuid, text, jsonb) to service_role';
  execute 'grant execute on function public.transfer_coins_with_pin(uuid, uuid, bytea, text, bigint, text, text, jsonb, jsonb) to service_role';
  execute 'grant execute on function public.change_coin_pin(uuid, uuid, bytea, bytea, bytea, jsonb, jsonb) to service_role';
  execute 'grant execute on function public.request_coin_pin_reset(uuid, bytea, jsonb) to service_role';
  execute 'grant execute on function public.complete_coin_pin_reset(uuid, bytea, bytea, bytea, jsonb, jsonb) to service_role';
  -- 🔴 the transfer itself: no API role may call it any more. Only transfer_coins_with_pin (definer) reaches it.
  execute 'revoke all on function public.transfer_coins(uuid, text, bigint, text, text, jsonb) from public, anon, authenticated, service_role';
end;
$$;
