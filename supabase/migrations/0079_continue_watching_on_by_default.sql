-- =====================================================================
-- 0079_continue_watching_on_by_default.sql
-- =====================================================================
-- Owner, 2026-07-16: "let the continue watching show on default and make a
-- way users can turn it off".
--
-- The DEFAULT for a new row was already correct (`hidden_modules` defaults to
-- '{}', i.e. nothing hidden). What wasn't correct was the live data: the
-- 2026-07-16 investigation into "Continue Watching only shows in the admin
-- account" found three of four existing rows carrying
-- hidden_modules: ["continue_watching"] — hidden by an inline switch that was
-- one accidental tap away and, at the time, had no visible way back. Three of
-- four accounts hiding EXACTLY the same one module is not four independent
-- curation decisions; it's a control that was too easy to hit.
--
-- So this is a one-time repair of that accidental state, not an override of a
-- deliberate preference: it removes ONLY 'continue_watching' from
-- hidden_modules and leaves every other hidden module, the module order, and
-- every other preference on the row exactly as saved.
--
-- Turning it off again is a real, supported action — there's now a labelled
-- hide control on the module itself, and (unlike before) restoring it is one
-- visible tap that takes effect instantly. Re-running this migration would
-- undo a viewer's later deliberate hide, so it is deliberately written to run
-- once: it is guarded by a marker row rather than being blindly idempotent.

-- One-time-repair ledger. A plain migration is normally idempotent (safe to
-- re-run); a DATA repair like the one below is not — re-running it after a
-- viewer has deliberately hidden the module again would silently un-hide it.
-- This records which repairs have already been applied so they run exactly
-- once. No RLS policy is granted: it's touched only by migrations running as
-- the service role, and no client ever reads it.
create table if not exists public.schema_repairs (
  id          text primary key,
  applied_at  timestamptz not null default now()
);

alter table public.schema_repairs enable row level security;

do $$
begin
  -- Guard: only ever perform the repair once, even if migrations are re-run.
  if not exists (
    select 1 from public.schema_repairs where id = '0079_continue_watching_on_by_default'
  ) then
    update public.user_home_preferences
       set hidden_modules = array_remove(hidden_modules, 'continue_watching'),
           updated_at     = now()
     where 'continue_watching' = any (hidden_modules);

    insert into public.schema_repairs (id) values ('0079_continue_watching_on_by_default');
  end if;
end
$$;
