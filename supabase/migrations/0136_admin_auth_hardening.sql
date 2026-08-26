-- ============================================================================
--  0136 — ADMIN AUTH HARDENING
-- ============================================================================
--
-- Three things, in dependency order. Statement order matters: this file has no
-- dollar-quoted block until the very end, because DDL placed AFTER a
-- dollar-quoted body has silently failed to run in this project before.
--
--  1. Close a PRIVILEGE-ESCALATION hole in `profiles`.
--  2. Stop billing from demoting administrators.
--  3. Add the failed-login ledger the admin login throttle needs.

-- ---------------------------------------------------------------------
-- 1. 🔴 SELF-PROMOTION TO ADMIN WAS POSSIBLE. THIS IS THE FIX.
-- ---------------------------------------------------------------------
--
-- `profiles` has exactly one UPDATE policy, unchanged since 0001:
--
--     create policy "profiles self update" on public.profiles
--       for update using (auth.uid() = id);
--
-- There is no WITH CHECK, and — more importantly — the USING expression says
-- nothing about which COLUMNS may change. Postgres applies the USING expression
-- to the new row as well when WITH CHECK is omitted, and `auth.uid() = id` is
-- still true after an update that only touches `role`. So any authenticated
-- user could run, straight from the browser with the anon key:
--
--     supabase.from('profiles').update({ role: 'admin' }).eq('id', <their id>)
--
-- …and every admin gate in the app trusts that column: `public.is_admin()`
-- below, `lib/admin.ts#isAdmin`, the middleware guard, and `getAdminUser()`.
-- One UPDATE was full administrative access.
--
-- A policy cannot express "this column may not change" — RLS has no OLD row in
-- WITH CHECK. A BEFORE UPDATE trigger can, and it is enforced for every client
-- regardless of which policy let the row through.
--
-- 🔴 The trigger PRESERVES the old value rather than raising. Raising would
-- break every legitimate profile update that happens to send the whole row back
-- (the settings forms do exactly that), turning a security fix into a
-- functional outage. Silently keeping the old role is both safe and invisible
-- to honest callers.
--
-- The service role bypasses RLS but NOT triggers, so the exemption is explicit:
-- `auth.uid()` is NULL for service-role/`postgres` connections, which is how a
-- legitimate server-side grant is distinguished from a user editing themselves.

create or replace function public.profiles_protect_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- A server-side caller (service role, SQL editor, migrations) has no
  -- `auth.uid()`. Those are trusted and may set any role.
  if auth.uid() is null then
    return new;
  end if;

  -- An end-user session may never change its own role, in either direction.
  -- Demotion is blocked too: an admin tricked into submitting a crafted form
  -- must not be able to lock themselves out.
  if new.role is distinct from old.role then
    new.role := old.role;
  end if;

  return new;
end;
$fn$;

revoke all on function public.profiles_protect_role() from public;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before update on public.profiles
  for each row
  execute function public.profiles_protect_role();

-- ---------------------------------------------------------------------
-- 2. BILLING MUST NOT DEMOTE AN ADMINISTRATOR
-- ---------------------------------------------------------------------
--
-- `lib/paystack/sync.ts` writes `role = 'pro' | 'user'` on every subscription
-- sync. `role` is doing two jobs in this schema — plan tier AND privilege — so
-- a single webhook for an administrator's own account silently demoted them to
-- 'user'. That is why zero rows currently hold `role = 'admin'` and why
-- ADMIN_EMAILS exists as the de-facto grant path.
--
-- The application fix is in that file (it now refuses to touch an admin row).
-- This is the belt to its braces: even a direct service-role write cannot
-- demote an admin through the billing path, because billing only ever sets
-- 'pro' or 'user' and this refuses exactly that transition.
create or replace function public.profiles_keep_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if old.role = 'admin' and new.role in ('user', 'pro') then
    new.role := 'admin';
  end if;
  return new;
end;
$fn$;

revoke all on function public.profiles_keep_admin() from public;

drop trigger if exists profiles_keep_admin on public.profiles;
create trigger profiles_keep_admin
  before update on public.profiles
  for each row
  execute function public.profiles_keep_admin();

-- ---------------------------------------------------------------------
-- 3. FAILED ADMIN LOGINS — the brute-force ledger
-- ---------------------------------------------------------------------
--
-- 🔴 IN POSTGRES, NOT REDIS, AND THAT IS DELIBERATE.
--
-- `lib/rate-limit.ts` is backed by Upstash and FAILS OPEN by design: a missing
-- Redis must never refuse a legitimate download. It also honours
-- `RATE_LIMIT_ENABLED=false`. Both are correct for downloads and wrong for an
-- admin login, where failing open means "unlimited password guesses". This
-- project has already shipped an incident where UPSTASH_* were present but
-- EMPTY, so the fallback path is not hypothetical.
--
-- Postgres is the one dependency the admin login cannot work without anyway, so
-- counting here means the throttle can never be quietly absent.
--
-- Keyed by (identifier, scope) where identifier is the lowercased email or the
-- client IP: locking only by email lets one attacker lock a known admin out
-- (a denial of service), and locking only by IP is trivially bypassed with a
-- proxy pool. Both are counted, and either can trip.
create table if not exists public.admin_login_attempts (
  identifier   text not null,
  scope        text not null check (scope in ('email', 'ip')),
  fails        integer not null default 0,
  first_fail   timestamptz not null default now(),
  last_fail    timestamptz not null default now(),
  locked_until timestamptz,
  primary key (identifier, scope)
);

create index if not exists admin_login_attempts_locked_idx
  on public.admin_login_attempts (locked_until)
  where locked_until is not null;

-- No policies at all. Every read and write goes through the service role in
-- `lib/admin/login-throttle.ts`; a browser must never be able to read the
-- lockout state (it reveals which emails are administrators) or clear it.
alter table public.admin_login_attempts enable row level security;
