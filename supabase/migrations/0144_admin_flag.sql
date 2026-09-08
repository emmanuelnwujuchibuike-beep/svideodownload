-- ============================================================================
-- 0144 — Admin-ness stops sharing a column with the billing plan
-- ============================================================================
--
-- Owner, 2026-09-08: "set up the best way to fix all admin only policies."
--
-- ── 🔴 THE ROOT CAUSE: ONE COLUMN, TWO MEANINGS ─────────────────────────────
--
-- `profiles.role` holds the BILLING PLAN ('user', 'pro', 'business') and was
-- also the only place admin-ness could live, because `public.is_admin()` reads
-- `role = 'admin'`. Those two facts are independent — a person can be both a
-- paying customer and an operator — but the schema forced them to be mutually
-- exclusive.
--
-- Measured on production, 2026-09-08:
--
--     profiles.role values in use : { user: 77, pro: 4 }
--     profiles with role='admin'  : NONE
--
-- So `is_admin()` returned false for everybody, and EVERY admin-only RLS policy
-- was silently dead — the download stats showed the operator their own 585 rows
-- instead of 17,657, and the alerts panel returned an empty list that read as
-- "nothing is wrong".
--
-- And the obvious manual fix was a trap. Setting `role = 'admin'` on the
-- operator would have CANCELLED THEIR PRO PLAN, and `paystack/sync.ts` writes
-- the plan back on every subscription sync — which is exactly the recorded
-- incident where a SQL-granted admin got wiped days later by something that
-- looked unrelated.
--
-- ── The fix ──────────────────────────────────────────────────────────────────
--
-- A dedicated `is_admin` column. Admin-ness and billing then occupy different
-- fields, so neither can overwrite the other, and the Paystack sync can keep
-- writing `role` forever without touching who is an operator.
--
-- `public.is_admin()` accepts EITHER the new column or the historical
-- `role = 'admin'`, so nothing that already worked stops working.
--
-- 🔴 ORDERING: the column, the index and the seed — everything that must not be
-- skipped — come BEFORE the first dollar-quoted block, because of the 0130 trap
-- where plain DDL after one silently did not run.
--
-- The trigger's `revoke`/`drop`/`create` do follow a `$fn$` block, which looks
-- like that trap and is not: it is the exact structure 0136 used to install this
-- same trigger, and that migration applied cleanly (the guard it created is live
-- and pinned by admin-auth.test.ts). A trigger cannot precede the function it
-- executes, so this ordering is forced — and it is a proven one.
--
-- Idempotent throughout.

-- ---------------------------------------------------------------------
-- 1 · The column
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists is_admin boolean not null default false;

comment on column public.profiles.is_admin is
  'Operator access. DELIBERATELY separate from `role`, which is the billing plan and is rewritten by the Paystack sync — the two were the same field until 0144, so granting admin cancelled a subscription and the sync then wiped the grant.';

-- Tiny partial index: the admin set is a handful of rows out of every account.
create index if not exists profiles_is_admin_idx on public.profiles (id) where is_admin;

-- ---------------------------------------------------------------------
-- 2 · Seed the operators the application already trusts
--
-- The app's guard accepts `ADMIN_EMAILS`, which SQL cannot read — that
-- divergence IS the bug being fixed, so the known operator address is promoted
-- here and the database stops depending on an env var it cannot see.
--
-- Idempotent, and it only ever GRANTS. Revoking is a deliberate UPDATE, never a
-- side effect of a migration re-running.
-- ---------------------------------------------------------------------
update public.profiles p
   set is_admin = true
  from auth.users u
 where u.id = p.id
   and lower(u.email) = 'nwujuchriss@gmail.com'
   and p.is_admin is distinct from true;

-- ---------------------------------------------------------------------
-- 3 · 🔴 THE NEW COLUMN MUST NOT BE SELF-GRANTABLE
--
-- `profiles` has an UPDATE policy for `auth.uid() = id`, so a member can write
-- to their own row. 0136 added `profiles_protect_role` for exactly this reason:
-- without it, anyone could run `update profiles set role='admin'` on themselves
-- and become an operator.
--
-- Adding `is_admin` in step 1 reopens that hole under a new name unless the
-- same guard covers it — a column that grants operator access and is writable
-- by its own subject is a privilege escalation with extra steps.
--
-- The function is REPLACED rather than a second trigger added: one guard on one
-- table is one thing to reason about, and two triggers racing on the same row
-- is how a protection silently stops applying.
--
-- Server-side callers (service role, migrations, the SQL editor) have no
-- `auth.uid()` and are still free to set both fields — that is how step 2 above
-- works, and how an operator is granted or revoked deliberately.
-- ---------------------------------------------------------------------
create or replace function public.profiles_protect_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- A server-side caller (service role, SQL editor, migrations) has no
  -- `auth.uid()`. Those are trusted and may set any role or flag.
  if auth.uid() is null then
    return new;
  end if;

  -- An end-user session may never change its own role, in either direction.
  -- Demotion is blocked too: an admin tricked into submitting a crafted form
  -- must not be able to lock themselves out.
  if new.role is distinct from old.role then
    new.role := old.role;
  end if;

  -- Same rule, same reasoning, for operator access (0144).
  if new.is_admin is distinct from old.is_admin then
    new.is_admin := old.is_admin;
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
-- 4 · One definition of "admin", for every policy in the database
--
-- Every admin-only policy already calls this function, so correcting it here
-- fixes all of them at once — downloads, analytics, admin_alerts and anything
-- added later — without touching a single policy definition.
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid()
       -- The new, durable signal, OR the historical one so nothing regresses.
       and (is_admin or role = 'admin')
  );
$$;
