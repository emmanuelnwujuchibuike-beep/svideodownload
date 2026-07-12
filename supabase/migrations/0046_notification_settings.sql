set lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- Part 6 — per-user notification settings: master switch, channel
-- toggles (push / in-app), per-category enable+push, one quiet-hours
-- window, and a "hide push preview text" privacy toggle.
--
-- category_prefs is JSONB (not one column per NotificationCategory) so a
-- brand-new category added to lib/social/notifications.ts's CATEGORY_BY_TYPE
-- automatically defaults to enabled for every existing user with zero
-- migration — the spec's own "future categories automatically appear in
-- settings" / "administrators can add new categories without an app
-- update" requirement, satisfied at the data layer rather than a bespoke
-- admin UI. Missing/unknown keys are treated as {enabled:true, push:true}
-- by lib/social/notification-settings.ts.
-- ---------------------------------------------------------------------
create table if not exists public.notification_settings (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  master_enabled        boolean not null default true,
  push_enabled          boolean not null default true,
  in_app_enabled        boolean not null default true,
  category_prefs        jsonb not null default '{}'::jsonb,
  quiet_hours_enabled    boolean not null default false,
  -- UTC hour-of-day (0-23) — the browser converts its own local time to UTC
  -- before saving (see notification-settings-editor.tsx); the server has no
  -- reliable timezone for a background push send otherwise.
  quiet_hours_start_utc smallint not null default 22 check (quiet_hours_start_utc between 0 and 23),
  quiet_hours_end_utc   smallint not null default 8 check (quiet_hours_end_utc between 0 and 23),
  hide_push_preview     boolean not null default false,
  updated_at            timestamptz not null default now()
);

alter table public.notification_settings enable row level security;

drop policy if exists "notification settings self all" on public.notification_settings;
create policy "notification settings self all" on public.notification_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
