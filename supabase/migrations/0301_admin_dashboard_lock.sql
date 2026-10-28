-- ═══════════════════════════════════════════════════════════════════════════
--  0301 — The admin dashboard lock, and guarded manual Frenz Coin funding (2026-10-28)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-28: "make admin account to show input admin dashboard password and an additional pin after sign in,
-- if not the page won't open, it will be stuck at the password or pin page. Pin can only be reset by password, the
-- password will be the current password and previous password, if no previous password, writing the password twice
-- should also work, and reset mail sent to the email not code, when clicked on the reset pin on the email it verified
-- securely open the enter new pin page." And: "Admin should be able to manual fund a wallet with FC but very guarded,
-- no hack or anything should rewrite it."
--
-- ── The lock (after the ordinary sign-in, before any admin page or admin API) ─
--   1. the DASHBOARD PASSWORD (its own, not the account password) — admin_lock_check_password opens a session at stage
--      'password' (10 minutes to enter the PIN).
--   2. the PIN (6 digits) — admin_lock_check_pin moves that session to 'unlocked' (8 hours). The browser holds only
--      `<session id>.<random token>`, the database holds HMAC(server pepper, token). lib/admin/require-admin.ts asks
--      admin_lock_session_stage on every admin request: anything but 'unlocked' = the admin is held at the lock screen.
--   Every password and PIN entry is a counted, single-use attempt (as 0282): counted BEFORE it is checked, so parallel
--   guesses cannot exceed the limit, 5 failures lock for 15 minutes × 2^(locks so far), at most 24 hours, never forever.
--   Password and PIN share one counter. Hashes: scrypt(HMAC-SHA256(server pepper, secret), salt) — lib/admin/lock.ts.
--   The pepper is never in the database. No API role (service role included) can read these tables: functions only.
--
-- ── First setup ──────────────────────────────────────────────────────────────
--   Nothing is set yet → an emailed LINK (to the admin's own confirmed address) opens the setup page. A hijacked
--   session alone cannot set the first password: it also needs the inbox. admin_lock_setup refuses if anything is set.
--
-- ── PIN reset (by password only) ──────────────────────────────────────────────
--   admin_lock_request_pin_reset: the CURRENT dashboard password and the PREVIOUS one (or the current one twice when
--   there has never been a previous one), through one counted attempt. Only then is an emailed LINK issued (no code).
--   The link is single use, 30 minutes, bound to that admin, superseded by a newer one, a few per hour. Opening it is
--   checked by admin_lock_link_valid (no use spent), the new PIN is set by admin_lock_complete_pin_reset, which spends
--   it, clears the lock counters and ends every open dashboard session (the next visit asks for password + PIN).
--
-- ── Manual Frenz Coin funding (the ONLY door) ─────────────────────────────────
--   admin_fund_coin_wallet: an UNLOCKED dashboard session of that admin + a FRESH PIN entry for this funding + a reason +
--   a once-only reference, all in ONE transaction with the credit. Caps: 100,000 cents ($1,000) per funding and
--   500,000 cents ($5,000) per admin per rolling 24 hours (owner may change them in a later migration). Each funding is
--   an append-only admin_coin_fundings row, an append-only ledger row (0278 guard: never rewritten or deleted) and a
--   financial_audit_log row. adjust_coin_balance is no longer executable by the service role: no server code, stolen
--   service key or forgotten script can credit a coin wallet without the admin's session and PIN.
--
-- Depends on 0144 (profiles.is_admin), 0227 (financial_audit_log), 0278 (financial_append_only_guard), 0279
-- (adjust_coin_balance), 0298 (wallet_accounts). Run by hand AFTER 0300. Safe to run twice.
-- No semicolon inside any quoted string. Every dollar-quoted block is last.

create table if not exists public.admin_lock_credentials (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  password_hash       bytea not null,
  password_salt       bytea not null,
  prev_password_hash  bytea,
  prev_password_salt  bytea,
  pin_hash            bytea not null,
  pin_salt            bytea not null,
  params              jsonb not null,
  failed_attempts     integer not null default 0,
  lock_count          integer not null default 0,
  locked_until        timestamptz,
  last_failed_at      timestamptz,
  last_success_at     timestamptz,
  set_at              timestamptz not null default now(),
  password_changed_at timestamptz,
  pin_changed_at      timestamptz,
  updated_at          timestamptz not null default now(),
  constraint admin_lock_credentials_hash_chk check (
    octet_length(password_hash) between 32 and 64 and octet_length(password_salt) between 16 and 64
    and octet_length(pin_hash) between 32 and 64 and octet_length(pin_salt) between 16 and 64
    and (prev_password_hash is null) = (prev_password_salt is null)),
  constraint admin_lock_credentials_counts_chk check (failed_attempts >= 0 and lock_count >= 0)
);
alter table public.admin_lock_credentials enable row level security;
revoke all on public.admin_lock_credentials from public, anon, authenticated, service_role;
comment on table public.admin_lock_credentials is 'Admin dashboard lock (0301): scrypt hashes of HMAC(server pepper, dashboard password / PIN), the previous password for PIN resets, and the attempt counters. Readable by NO API role: only the admin_lock functions use it.';

create table if not exists public.admin_lock_attempts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  purpose     text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  outcome     text,
  constraint admin_lock_attempts_purpose_chk check (purpose in ('password', 'pin', 'pin_reset', 'change_password', 'fund')),
  constraint admin_lock_attempts_outcome_chk check (outcome is null or outcome in ('ok', 'failed', 'locked', 'reset'))
);
create index if not exists admin_lock_attempts_user_idx on public.admin_lock_attempts (user_id, created_at desc);
alter table public.admin_lock_attempts enable row level security;
revoke all on public.admin_lock_attempts from public, anon, authenticated, service_role;
comment on table public.admin_lock_attempts is 'Admin dashboard lock (0301): one single-use row per password or PIN entry, counted when it begins. No secret is stored. Function access only.';

create table if not exists public.admin_lock_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  token_hash  bytea not null,
  stage       text not null,
  created_at  timestamptz not null default now(),
  unlocked_at timestamptz,
  expires_at  timestamptz not null,
  ended_at    timestamptz,
  constraint admin_lock_sessions_stage_chk check (stage in ('password', 'unlocked')),
  constraint admin_lock_sessions_hash_chk check (octet_length(token_hash) = 32)
);
create index if not exists admin_lock_sessions_user_idx on public.admin_lock_sessions (user_id, created_at desc);
alter table public.admin_lock_sessions enable row level security;
revoke all on public.admin_lock_sessions from public, anon, authenticated, service_role;
comment on table public.admin_lock_sessions is 'Admin dashboard lock (0301): one row per browser that passed the dashboard password (stage password) and then the PIN (stage unlocked). Only HMAC(server pepper, token) is stored. Function access only.';

create table if not exists public.admin_lock_links (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  purpose       text not null,
  token_hash    bytea not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  superseded_at timestamptz,
  constraint admin_lock_links_purpose_chk check (purpose in ('setup', 'pin_reset')),
  constraint admin_lock_links_hash_chk check (octet_length(token_hash) = 32)
);
create unique index if not exists admin_lock_links_live_uidx on public.admin_lock_links (user_id, purpose) where consumed_at is null and superseded_at is null;
create index if not exists admin_lock_links_user_idx on public.admin_lock_links (user_id, created_at desc);
alter table public.admin_lock_links enable row level security;
revoke all on public.admin_lock_links from public, anon, authenticated, service_role;
comment on table public.admin_lock_links is 'Admin dashboard lock (0301): emailed setup and PIN-reset links. Only HMAC(server pepper, token) is stored. Single use, 30 minutes, one live per admin and purpose. Function access only.';

create table if not exists public.admin_coin_fundings (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid not null,
  user_id      uuid not null,
  amount_cents bigint not null,
  reason       text not null,
  reference    text not null,
  session_id   uuid not null,
  ledger_id    uuid not null,
  created_at   timestamptz not null default now(),
  constraint admin_coin_fundings_amount_chk check (amount_cents > 0 and amount_cents <= 100000),
  constraint admin_coin_fundings_reason_chk check (char_length(btrim(reason)) between 5 and 200),
  constraint admin_coin_fundings_self_chk check (admin_id <> user_id)
);
create unique index if not exists admin_coin_fundings_ref_uidx on public.admin_coin_fundings (reference);
create index if not exists admin_coin_fundings_admin_idx on public.admin_coin_fundings (admin_id, created_at desc);
create index if not exists admin_coin_fundings_user_idx on public.admin_coin_fundings (user_id, created_at desc);
alter table public.admin_coin_fundings enable row level security;
revoke all on public.admin_coin_fundings from public, anon, authenticated;
grant select on public.admin_coin_fundings to service_role;
comment on table public.admin_coin_fundings is 'Manual Frenz Coin fundings by an admin (0301). Written only by admin_fund_coin_wallet (unlocked dashboard + a fresh PIN). Append-only: never updated or deleted. The service role may read, never write. No foreign keys: history outlives an account.';

drop trigger if exists admin_coin_fundings_append_only on public.admin_coin_fundings;
create trigger admin_coin_fundings_append_only before update or delete on public.admin_coin_fundings
  for each row execute function public.financial_append_only_guard();

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

-- Lock after too many failures: 15 minutes × 2^(locks so far), at most 24 hours. Internal (the caller holds the row lock).
create or replace function public.admin_lock_lock(p_user uuid, p_why text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_count   integer;
  v_minutes integer;
  v_until   timestamptz;
begin
  select lock_count into v_count from public.admin_lock_credentials where user_id = p_user;
  v_minutes := least(1440, 15 * (2 ^ least(coalesce(v_count, 0), 7))::integer);
  v_until := now() + make_interval(mins => v_minutes);
  update public.admin_lock_credentials set locked_until = v_until, lock_count = lock_count + 1, failed_attempts = 0, updated_at = now() where user_id = p_user;
  -- a lock also ends every open dashboard session of this admin
  update public.admin_lock_sessions set ended_at = now() where user_id = p_user and ended_at is null;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, details)
  values (p_user, 'admin_lock_locked', 'admin_lock', p_user::text, jsonb_build_object('minutes', v_minutes, 'locks', coalesce(v_count, 0) + 1, 'why', p_why));
  return v_until;
end;
$$;

-- What is set, and is it locked? (Never a hash.)
create or replace function public.admin_lock_status(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v public.admin_lock_credentials%rowtype;
begin
  select * into v from public.admin_lock_credentials where user_id = p_user;
  return jsonb_build_object('set', v.user_id is not null, 'has_previous', v.prev_password_hash is not null,
                            'locked_until', case when v.locked_until > now() then v.locked_until end);
end;
$$;

-- Begin ONE entry: counted now, single use, two minutes. Returns the salts and parameters, never a hash.
create or replace function public.admin_lock_begin(p_user uuid, p_purpose text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v    public.admin_lock_credentials%rowtype;
  v_id uuid;
begin
  if p_user is null or p_purpose is null or p_purpose not in ('password', 'pin', 'pin_reset', 'change_password', 'fund') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into v from public.admin_lock_credentials where user_id = p_user for update;
  if v.user_id is null then return jsonb_build_object('ok', false, 'reason', 'not_set'); end if;
  if v.locked_until is not null and v.locked_until > now() then return jsonb_build_object('ok', false, 'reason', 'locked', 'retry_after', v.locked_until); end if;
  if v.failed_attempts >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'retry_after', public.admin_lock_lock(p_user, 'attempts_exhausted'));
  end if;
  update public.admin_lock_credentials set failed_attempts = failed_attempts + 1, updated_at = now() where user_id = p_user;
  delete from public.admin_lock_attempts where user_id = p_user and created_at < now() - interval '1 day';
  insert into public.admin_lock_attempts (user_id, purpose, expires_at) values (p_user, p_purpose, now() + interval '2 minutes') returning id into v_id;
  return jsonb_build_object('ok', true, 'attempt_id', v_id, 'params', v.params,
    'password_salt', encode(v.password_salt, 'hex'),
    'prev_password_salt', case when v.prev_password_salt is not null then encode(v.prev_password_salt, 'hex') end,
    'pin_salt', encode(v.pin_salt, 'hex'));
end;
$$;

-- Spend ONE begun attempt and compare (internal). p_which: 'password' | 'pin' | 'password_and_previous'.
-- 'ok' | 'failed' | 'locked' | 'not_set' | 'no_attempt'.
create or replace function public.admin_lock_check(p_user uuid, p_attempt uuid, p_purpose text, p_which text, p_key bytea, p_key2 bytea) returns text
language plpgsql security definer set search_path = public as $$
declare
  v     public.admin_lock_credentials%rowtype;
  v_att uuid;
  v_ok  boolean;
begin
  select * into v from public.admin_lock_credentials where user_id = p_user for update;
  if v.user_id is null then return 'not_set'; end if;
  update public.admin_lock_attempts set consumed_at = now()
   where id = p_attempt and user_id = p_user and purpose = p_purpose and consumed_at is null and expires_at > now()
  returning id into v_att;
  if v_att is null then return 'no_attempt'; end if;
  if v.locked_until is not null and v.locked_until > now() then
    update public.admin_lock_attempts set outcome = 'locked' where id = v_att;
    return 'locked';
  end if;
  if p_which = 'pin' then
    v_ok := p_key is not null and p_key = v.pin_hash;
  elsif p_which = 'password' then
    v_ok := p_key is not null and p_key = v.password_hash;
  elsif p_which = 'password_and_previous' then
    -- the current password, and the previous one — or, when there has never been a previous one, the current one twice
    v_ok := p_key is not null and p_key2 is not null and p_key = v.password_hash
            and p_key2 = coalesce(v.prev_password_hash, v.password_hash);
  else
    v_ok := false;
  end if;
  if v_ok then
    update public.admin_lock_credentials set failed_attempts = 0, lock_count = 0, locked_until = null, last_success_at = now(), updated_at = now() where user_id = p_user;
    update public.admin_lock_attempts set outcome = 'ok' where id = v_att;
    return 'ok';
  end if;
  update public.admin_lock_attempts set outcome = 'failed' where id = v_att;
  update public.admin_lock_credentials set last_failed_at = now(), updated_at = now() where user_id = p_user;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, details)
  values (p_user, 'admin_lock_failed', 'admin_lock', p_user::text, jsonb_build_object('purpose', p_purpose, 'failures', v.failed_attempts, 'limit', 5));
  if v.failed_attempts >= 5 then perform public.admin_lock_lock(p_user, 'too_many_failures'); end if;
  return 'failed';
end;
$$;

-- Step 1: the dashboard password. Opens a session at stage 'password' (10 minutes to enter the PIN).
create or replace function public.admin_lock_check_password(p_user uuid, p_attempt uuid, p_key bytea, p_token_hash bytea) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then return jsonb_build_object('ok', false, 'reason', 'authorization_failed'); end if;
  if public.admin_lock_check(p_user, p_attempt, 'password', 'password', p_key, null) <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', 'authorization_failed');
  end if;
  delete from public.admin_lock_sessions where user_id = p_user and (ended_at is not null or expires_at < now()) and created_at < now() - interval '7 days';
  insert into public.admin_lock_sessions (user_id, token_hash, stage, expires_at) values (p_user, p_token_hash, 'password', now() + interval '10 minutes')
  returning id into v_id;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, details)
  values (p_user, 'admin_lock_password_ok', 'admin_lock', p_user::text, jsonb_build_object('session_id', v_id));
  return jsonb_build_object('ok', true, 'session_id', v_id);
end;
$$;

-- Step 2: the PIN, on a session that passed step 1 in this browser. Unlocks it for 8 hours.
create or replace function public.admin_lock_check_pin(p_user uuid, p_attempt uuid, p_key bytea, p_session uuid, p_token_hash bytea) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_s public.admin_lock_sessions%rowtype;
begin
  select * into v_s from public.admin_lock_sessions where id = p_session for update;
  if v_s.id is null or v_s.user_id <> p_user or v_s.token_hash <> p_token_hash or v_s.ended_at is not null or v_s.expires_at <= now() or v_s.stage <> 'password' then
    return jsonb_build_object('ok', false, 'reason', 'session');
  end if;
  if public.admin_lock_check(p_user, p_attempt, 'pin', 'pin', p_key, null) <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', 'authorization_failed');
  end if;
  update public.admin_lock_sessions set stage = 'unlocked', unlocked_at = now(), expires_at = now() + interval '8 hours' where id = p_session;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, details)
  values (p_user, 'admin_lock_unlocked', 'admin_lock', p_user::text, jsonb_build_object('session_id', p_session));
  return jsonb_build_object('ok', true);
end;
$$;

-- The stage of this browser's session: 'unlocked' | 'password' | null. Read on every admin request.
create or replace function public.admin_lock_session_stage(p_user uuid, p_session uuid, p_token_hash bytea) returns text
language sql stable security definer set search_path = public as $$
  select s.stage from public.admin_lock_sessions s
   where s.id = p_session and s.user_id = p_user and s.token_hash = p_token_hash and s.ended_at is null and s.expires_at > now()
     and exists (select 1 from public.admin_lock_credentials c where c.user_id = p_user and (c.locked_until is null or c.locked_until <= now()))
$$;

-- Leave: end this browser's session (sign-out and "Lock now").
create or replace function public.admin_lock_end_session(p_user uuid, p_session uuid) returns void
language sql security definer set search_path = public as $$
  update public.admin_lock_sessions set ended_at = now() where id = p_session and user_id = p_user and ended_at is null
$$;

-- Issue an emailed link. 'setup' only while nothing is set. 'pin_reset' is issued by admin_lock_request_pin_reset.
-- issued says whether to send. A few per hour per admin and purpose. A new link supersedes the live one.
create or replace function public.admin_lock_issue_link(p_user uuid, p_purpose text, p_token_hash bytea) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if p_user is null or p_purpose is null or p_purpose not in ('setup', 'pin_reset') or p_token_hash is null or octet_length(p_token_hash) <> 32 then
    return jsonb_build_object('ok', true, 'issued', false);
  end if;
  if not exists (select 1 from auth.users where id = p_user and email_confirmed_at is not null) then return jsonb_build_object('ok', true, 'issued', false); end if;
  if p_purpose = 'setup' and exists (select 1 from public.admin_lock_credentials where user_id = p_user) then return jsonb_build_object('ok', true, 'issued', false); end if;
  select count(*) into v_n from public.admin_lock_links where user_id = p_user and purpose = p_purpose and created_at > now() - interval '1 hour';
  if v_n >= 3 then
    insert into public.financial_audit_log (actor_id, action, target_type, target_id, details)
    values (p_user, 'admin_lock_link_throttled', 'admin_lock', p_user::text, jsonb_build_object('purpose', p_purpose, 'last_hour', v_n));
    return jsonb_build_object('ok', true, 'issued', false);
  end if;
  update public.admin_lock_links set superseded_at = now() where user_id = p_user and purpose = p_purpose and consumed_at is null and superseded_at is null;
  insert into public.admin_lock_links (user_id, purpose, token_hash, expires_at) values (p_user, p_purpose, p_token_hash, now() + interval '30 minutes');
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, details)
  values (p_user, 'admin_lock_link_issued', 'admin_lock', p_user::text, jsonb_build_object('purpose', p_purpose));
  return jsonb_build_object('ok', true, 'issued', true, 'expires_minutes', 30);
end;
$$;

-- Is this the live link of this admin and purpose? (Opening the email checks it. No use is spent.)
create or replace function public.admin_lock_link_valid(p_user uuid, p_purpose text, p_token_hash bytea) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_lock_links
                  where user_id = p_user and purpose = p_purpose and token_hash = p_token_hash
                    and consumed_at is null and superseded_at is null and expires_at > now())
$$;

-- Spend a live link (internal). true when it was live and is now used.
create or replace function public.admin_lock_spend_link(p_user uuid, p_purpose text, p_token_hash bytea) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  update public.admin_lock_links set consumed_at = now()
   where user_id = p_user and purpose = p_purpose and token_hash = p_token_hash and consumed_at is null and superseded_at is null and expires_at > now()
  returning id into v_id;
  return v_id is not null;
end;
$$;

-- First setup through the emailed link: the dashboard password and the PIN together. Never replaces anything.
create or replace function public.admin_lock_setup(p_user uuid, p_link_hash bytea, p_password_hash bytea, p_password_salt bytea, p_pin_hash bytea, p_pin_salt bytea, p_params jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_done uuid;
begin
  if p_user is null or p_password_hash is null or p_password_salt is null or p_pin_hash is null or p_pin_salt is null
     or octet_length(p_password_hash) not between 32 and 64 or octet_length(p_pin_hash) not between 32 and 64
     or octet_length(p_password_salt) not between 16 and 64 or octet_length(p_pin_salt) not between 16 and 64
     or p_params is null or p_params ->> 'algorithm' is distinct from 'scrypt' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if exists (select 1 from public.admin_lock_credentials where user_id = p_user) then return jsonb_build_object('ok', false, 'reason', 'exists'); end if;
  if not public.admin_lock_spend_link(p_user, 'setup', p_link_hash) then return jsonb_build_object('ok', false, 'reason', 'link'); end if;
  insert into public.admin_lock_credentials (user_id, password_hash, password_salt, pin_hash, pin_salt, params)
  values (p_user, p_password_hash, p_password_salt, p_pin_hash, p_pin_salt, p_params)
  on conflict (user_id) do nothing
  returning user_id into v_done;
  if v_done is null then return jsonb_build_object('ok', false, 'reason', 'exists'); end if;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, details)
  values (p_user, 'admin_lock_set', 'admin_lock', p_user::text, jsonb_build_object('via', 'email_link'));
  return jsonb_build_object('ok', true);
end;
$$;

-- Ask for a PIN reset: the current and previous dashboard password (or the current one twice when there was never a
-- previous one), through one counted attempt. Only then a link is issued.
create or replace function public.admin_lock_request_pin_reset(p_user uuid, p_attempt uuid, p_current bytea, p_previous bytea, p_link_hash bytea) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if public.admin_lock_check(p_user, p_attempt, 'pin_reset', 'password_and_previous', p_current, p_previous) <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', 'authorization_failed');
  end if;
  return public.admin_lock_issue_link(p_user, 'pin_reset', p_link_hash) || jsonb_build_object('ok', true);
end;
$$;

-- Complete a PIN reset through the emailed link: spends it, sets the PIN, clears the counters, ends every session.
create or replace function public.admin_lock_complete_pin_reset(p_user uuid, p_link_hash bytea, p_pin_hash bytea, p_pin_salt bytea) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_pin_hash is null or p_pin_salt is null or octet_length(p_pin_hash) not between 32 and 64 or octet_length(p_pin_salt) not between 16 and 64 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  perform 1 from public.admin_lock_credentials where user_id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'link'); end if;
  if not public.admin_lock_spend_link(p_user, 'pin_reset', p_link_hash) then return jsonb_build_object('ok', false, 'reason', 'link'); end if;
  update public.admin_lock_credentials set pin_hash = p_pin_hash, pin_salt = p_pin_salt, failed_attempts = 0, lock_count = 0, locked_until = null,
         pin_changed_at = now(), updated_at = now() where user_id = p_user;
  update public.admin_lock_attempts set consumed_at = now(), outcome = 'reset' where user_id = p_user and consumed_at is null;
  update public.admin_lock_sessions set ended_at = now() where user_id = p_user and ended_at is null;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, details)
  values (p_user, 'admin_lock_pin_reset', 'admin_lock', p_user::text, jsonb_build_object('via', 'email_link'));
  return jsonb_build_object('ok', true);
end;
$$;

-- Change the dashboard password: the current one (a counted attempt) → the new one. The old one becomes the previous.
create or replace function public.admin_lock_change_password(p_user uuid, p_attempt uuid, p_current bytea, p_hash bytea, p_salt bytea) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_hash is null or p_salt is null or octet_length(p_hash) not between 32 and 64 or octet_length(p_salt) not between 16 and 64 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if public.admin_lock_check(p_user, p_attempt, 'change_password', 'password', p_current, null) <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', 'authorization_failed');
  end if;
  update public.admin_lock_credentials
     set prev_password_hash = password_hash, prev_password_salt = password_salt, password_hash = p_hash, password_salt = p_salt,
         password_changed_at = now(), updated_at = now()
   where user_id = p_user;
  update public.admin_lock_links set superseded_at = now() where user_id = p_user and purpose = 'pin_reset' and consumed_at is null and superseded_at is null;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, details)
  values (p_user, 'admin_lock_password_changed', 'admin_lock', p_user::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- Manual Frenz Coin funding — the only door. An unlocked dashboard session + a fresh PIN entry + the credit, in one
-- transaction. Once per reference. Capped per funding and per admin per 24 hours.
create or replace function public.admin_fund_coin_wallet(
  p_admin uuid, p_session uuid, p_token_hash bytea, p_attempt uuid, p_pin_key bytea,
  p_account_number text, p_amount bigint, p_reason text, p_reference text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid;
  v_prior public.admin_coin_fundings%rowtype;
  v_day   bigint;
  v_adj   jsonb;
  v_id    uuid;
begin
  if p_admin is null or p_session is null or p_attempt is null or p_amount is null or p_amount <= 0 or p_amount > 100000
     or coalesce(char_length(btrim(p_reason)), 0) not between 5 and 200 or coalesce(p_reference, '') !~ '^[A-Za-z0-9_-]{16,80}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- the replay answers the committed funding, without a second PIN check
  select * into v_prior from public.admin_coin_fundings where reference = p_reference;
  if v_prior.id is not null then
    if v_prior.admin_id <> p_admin or v_prior.amount_cents <> p_amount then return jsonb_build_object('ok', false, 'reason', 'idempotency_conflict'); end if;
    return jsonb_build_object('ok', true, 'duplicate', true, 'funding_id', v_prior.id);
  end if;
  if coalesce(public.admin_lock_session_stage(p_admin, p_session, p_token_hash), '') <> 'unlocked' then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  if public.admin_lock_check(p_admin, p_attempt, 'fund', 'pin', p_pin_key, null) <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', 'authorization_failed');
  end if;
  select user_id into v_user from public.wallet_accounts where account_number = p_account_number;
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'no_recipient'); end if;
  if v_user = p_admin then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  -- one admin's fundings queue on their credentials row: the 24-hour sum is exact
  perform 1 from public.admin_lock_credentials where user_id = p_admin for update;
  select coalesce(sum(amount_cents), 0) into v_day from public.admin_coin_fundings where admin_id = p_admin and created_at > now() - interval '24 hours';
  if v_day + p_amount > 500000 then return jsonb_build_object('ok', false, 'reason', 'daily_cap', 'used', v_day, 'cap', 500000); end if;
  v_adj := public.adjust_coin_balance(v_user, p_amount, 'admin-fund:' || p_reference, 'Manual funding: ' || btrim(p_reason), p_admin, false);
  if not coalesce((v_adj ->> 'ok')::boolean, false) then return jsonb_build_object('ok', false, 'reason', coalesce(v_adj ->> 'reason', 'refused')); end if;
  insert into public.admin_coin_fundings (admin_id, user_id, amount_cents, reason, reference, session_id, ledger_id)
  values (p_admin, v_user, p_amount, btrim(p_reason), p_reference, p_session, (v_adj ->> 'ledger_id')::uuid)
  returning id into v_id;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_admin, 'admin_coin_funding', 'coin_wallet', v_user::text, 'admin-fund:' || p_reference,
          jsonb_build_object('amount_cents', p_amount, 'funding_id', v_id, 'ledger_id', v_adj ->> 'ledger_id', 'session_id', p_session, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'funding_id', v_id, 'user_id', v_user, 'balance', (v_adj ->> 'balance')::bigint);
end;
$$;

do $$
begin
  execute 'revoke all on function public.admin_lock_lock(uuid, text) from public, anon, authenticated, service_role';
  execute 'revoke all on function public.admin_lock_check(uuid, uuid, text, text, bytea, bytea) from public, anon, authenticated, service_role';
  execute 'revoke all on function public.admin_lock_spend_link(uuid, text, bytea) from public, anon, authenticated, service_role';
  execute 'revoke all on function public.admin_lock_status(uuid) from public, anon, authenticated';
  execute 'revoke all on function public.admin_lock_begin(uuid, text) from public, anon, authenticated';
  execute 'revoke all on function public.admin_lock_check_password(uuid, uuid, bytea, bytea) from public, anon, authenticated';
  execute 'revoke all on function public.admin_lock_check_pin(uuid, uuid, bytea, uuid, bytea) from public, anon, authenticated';
  execute 'revoke all on function public.admin_lock_session_stage(uuid, uuid, bytea) from public, anon, authenticated';
  execute 'revoke all on function public.admin_lock_end_session(uuid, uuid) from public, anon, authenticated';
  execute 'revoke all on function public.admin_lock_issue_link(uuid, text, bytea) from public, anon, authenticated';
  execute 'revoke all on function public.admin_lock_link_valid(uuid, text, bytea) from public, anon, authenticated';
  execute 'revoke all on function public.admin_lock_setup(uuid, bytea, bytea, bytea, bytea, bytea, jsonb) from public, anon, authenticated';
  execute 'revoke all on function public.admin_lock_request_pin_reset(uuid, uuid, bytea, bytea, bytea) from public, anon, authenticated';
  execute 'revoke all on function public.admin_lock_complete_pin_reset(uuid, bytea, bytea, bytea) from public, anon, authenticated';
  execute 'revoke all on function public.admin_lock_change_password(uuid, uuid, bytea, bytea, bytea) from public, anon, authenticated';
  execute 'revoke all on function public.admin_fund_coin_wallet(uuid, uuid, bytea, uuid, bytea, text, bigint, text, text) from public, anon, authenticated';
  execute 'grant execute on function public.admin_lock_status(uuid) to service_role';
  execute 'grant execute on function public.admin_lock_begin(uuid, text) to service_role';
  execute 'grant execute on function public.admin_lock_check_password(uuid, uuid, bytea, bytea) to service_role';
  execute 'grant execute on function public.admin_lock_check_pin(uuid, uuid, bytea, uuid, bytea) to service_role';
  execute 'grant execute on function public.admin_lock_session_stage(uuid, uuid, bytea) to service_role';
  execute 'grant execute on function public.admin_lock_end_session(uuid, uuid) to service_role';
  execute 'grant execute on function public.admin_lock_issue_link(uuid, text, bytea) to service_role';
  execute 'grant execute on function public.admin_lock_link_valid(uuid, text, bytea) to service_role';
  execute 'grant execute on function public.admin_lock_setup(uuid, bytea, bytea, bytea, bytea, bytea, jsonb) to service_role';
  execute 'grant execute on function public.admin_lock_request_pin_reset(uuid, uuid, bytea, bytea, bytea) to service_role';
  execute 'grant execute on function public.admin_lock_complete_pin_reset(uuid, bytea, bytea, bytea) to service_role';
  execute 'grant execute on function public.admin_lock_change_password(uuid, uuid, bytea, bytea, bytea) to service_role';
  execute 'grant execute on function public.admin_fund_coin_wallet(uuid, uuid, bytea, uuid, bytea, text, bigint, text, text) to service_role';
  -- the single door: a coin wallet can no longer be credited by calling the generic correction directly
  execute 'revoke all on function public.adjust_coin_balance(uuid, bigint, text, text, uuid, boolean) from public, anon, authenticated, service_role';
end;
$$;
