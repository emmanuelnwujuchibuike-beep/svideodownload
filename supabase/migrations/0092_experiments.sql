-- =====================================================================
-- 0092_experiments.sql
-- Frenzsave · Experiment platform (A/B testing).
--
-- The Gap-Ledger item after feature flags (docs/CONSTITUTION.md). Like
-- flags, experiments are DECLARED in code (`lib/platform/experiments.ts`)
-- — arms, weights and status are typed and reviewable. This migration adds
-- only the two things that must live in the database:
--
--   1. `experiments` — the admin-editable runtime OVERRIDE per experiment:
--      a pause (safety lever) and a forced variant (ship the winner), both
--      without a redeploy. Same access model and shape as `feature_flags`.
--
--   2. `experiment_exposure_counts()` — an aggregate over the existing
--      `events` table so the admin panel can show exposures per variant
--      without pulling every event row. Exposures are logged as
--      type = 'experiment_exposure', metadata { experiment, variant },
--      through the same unified pipeline as every other event (0004).
--
-- Degrades safely: the store treats a missing table / RPC as "no
-- overrides, no stats", so the code is safe to ship before this runs.
-- Idempotent.
-- =====================================================================

create table if not exists public.experiments (
  -- Matches EXPERIMENTS[].id in lib/platform/experiments.ts.
  id            text primary key,
  -- null = run as declared; true = force everyone to control and stop enrolling.
  paused        boolean,
  -- null/empty = normal assignment; a variant id = force every eligible visitor into it.
  force_variant text,
  updated_by    uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now()
);

alter table public.experiments enable row level security;

drop policy if exists "experiments admin all" on public.experiments;
create policy "experiments admin all" on public.experiments
  for all using (public.is_admin()) with check (public.is_admin());

comment on table public.experiments is
  'Admin-editable runtime overrides for code-declared experiments (lib/platform/experiments.ts). Service-role only.';

-- ── Exposure counts ──────────────────────────────────────────────────
-- Grouped over public.events. Called by the service-role admin client
-- (bypasses RLS), so a plain STABLE function is enough. Fixed search_path
-- so the reference to public.events can't be shadowed.
create or replace function public.experiment_exposure_counts()
returns table (experiment text, variant text, exposures bigint)
language sql
stable
set search_path = public
as $$
  select
    metadata->>'experiment' as experiment,
    metadata->>'variant'    as variant,
    count(*)::bigint        as exposures
  from public.events
  where type = 'experiment_exposure'
  group by 1, 2;
$$;

comment on function public.experiment_exposure_counts() is
  'Exposure counts per (experiment, variant) from the events table. For the admin experiments panel.';
