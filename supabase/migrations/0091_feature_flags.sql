-- =====================================================================
-- 0091_feature_flags.sql
-- Frenzsave · Runtime feature-flag OVERRIDES.
--
-- The Config/Feature-Flag service from the Engineering Constitution's Gap
-- Ledger (docs/CONSTITUTION.md, Article VI). Flags themselves are DECLARED
-- in code (`lib/platform/flags.ts`) — typed, reviewable, impossible to
-- typo at a call site. This table holds only the admin-editable STATE of a
-- flag: a manual kill switch and/or a rollout percentage, one row per id.
--
-- ── Access model: operator config, service-role only ──────────────────
-- Read and written exclusively through the service-role client
-- (`lib/platform/flags-store.ts`), never a user session — the same model
-- as the monetization `settings`. RLS is still enabled and admin-scoped
-- via public.is_admin() so the table is closed to the anon/user key by
-- construction; the service role bypasses RLS by design.
--
-- ── Safe if this lags ─────────────────────────────────────────────────
-- The store degrades to "no overrides" when this table is absent (every
-- flag falls back to its declared default), so shipping the code before
-- this migration changes nothing. Idempotent; safe to re-run.
-- =====================================================================

create table if not exists public.feature_flags (
  -- Matches FLAGS[].id in lib/platform/flags.ts. No FK — the code registry is
  -- the source of truth; the store refuses to write ids it doesn't know.
  id                 text primary key,
  -- null = defer to rollout/default; true = force ON; false = kill switch.
  enabled            boolean,
  -- null = no override; 0–100 = ramp to this share of users (deterministic).
  rollout_percentage int,
  updated_by         uuid references auth.users(id) on delete set null,
  updated_at         timestamptz not null default now(),
  constraint feature_flags_rollout_range
    check (rollout_percentage is null or rollout_percentage between 0 and 100)
);

alter table public.feature_flags enable row level security;

-- Admin-only for both read and write. Service-role access (the only caller
-- today) bypasses RLS regardless; this keeps the table closed to everyone else.
drop policy if exists "feature_flags admin all" on public.feature_flags;
create policy "feature_flags admin all" on public.feature_flags
  for all using (public.is_admin()) with check (public.is_admin());

comment on table public.feature_flags is
  'Admin-editable overrides for code-declared flags (lib/platform/flags.ts). Operator config; service-role only.';
comment on column public.feature_flags.enabled is
  'null = use rollout/default; true = force on; false = kill switch (wins over rollout).';
comment on column public.feature_flags.rollout_percentage is
  '0–100 deterministic per-user ramp. Overridden by a non-null enabled.';
