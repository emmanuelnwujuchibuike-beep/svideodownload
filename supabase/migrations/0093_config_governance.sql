-- =====================================================================
-- 0093_config_governance.sql
-- Frenzsave · Runtime Governance for the Configuration Platform.
--
-- Two things the config platform was missing (flags 0091 + experiments
-- 0092 gave us the knobs; this makes changing them GOVERNED):
--
--   1. config_audit_log — every flag/experiment override change is
--      recorded (actor, before → after), giving version history, an audit
--      trail, and the source for a one-click rollback. Overrides are
--      upserts, so without this a change left no trace of what it was.
--
--   2. feature_flags.active_from / active_until — time-based activation and
--      scheduled deactivation, set from the admin without a redeploy.
--
-- Access model: config_audit_log is operator data — admin-only RLS, and
-- written through the service-role client (like the settings/flags stores).
-- Safe if this lags: the stores treat a missing table/column as "no audit /
-- no schedule" and keep working. Idempotent.
-- =====================================================================

create table if not exists public.config_audit_log (
  id         uuid primary key default uuid_generate_v4(),
  actor_id   uuid references auth.users(id) on delete set null,
  -- The config surface changed: 'flag' | 'experiment' (extensible).
  surface    text not null,
  -- The id within that surface (flag id / experiment id).
  target_id  text not null,
  -- Free-text action label, e.g. 'override.set'.
  action     text not null,
  -- The value before and after — enough to render a diff AND to roll back.
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);

create index if not exists config_audit_log_target_idx
  on public.config_audit_log (surface, target_id, created_at desc);
create index if not exists config_audit_log_recent_idx
  on public.config_audit_log (created_at desc);

alter table public.config_audit_log enable row level security;

drop policy if exists "config_audit_log admin read" on public.config_audit_log;
create policy "config_audit_log admin read" on public.config_audit_log
  for select using (public.is_admin());

comment on table public.config_audit_log is
  'Version history + audit trail for runtime config changes (flags/experiments). Admin-read; written by the service role.';

-- ── Scheduled activation / deactivation for flags ────────────────────
-- Nullable: null = no bound. Outside [active_from, active_until] a flag
-- resolves OFF via the normal path (a manual force-on override still wins,
-- for testing — see resolveFlag's order).
alter table public.feature_flags add column if not exists active_from  timestamptz;
alter table public.feature_flags add column if not exists active_until timestamptz;

comment on column public.feature_flags.active_from is
  'Scheduled activation: the flag cannot resolve on before this (null = no bound).';
comment on column public.feature_flags.active_until is
  'Scheduled deactivation: the flag resolves off after this (null = no bound).';
