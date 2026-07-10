-- =====================================================================
-- 0040_home_preferences.sql — personalization/preferences (Feature 17 Part 13)
-- =====================================================================
-- The "Cloud State" / cross-device preference-sync table Part 12's audit
-- confirmed didn't exist anywhere: Home module order/visibility, muted/
-- boosted content categories, feed-behavior toggles, and Quiet Mode. One
-- row per user, structurally mirrors `privacy_settings` (0006_social_identity.sql)
-- — a single self-owned settings row, RLS-restricted to its owner. Idempotent.

create table if not exists public.user_home_preferences (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  -- Home module order/visibility — a fixed key set (see HOME_MODULE_KEYS in
  -- lib/social/home-preferences.ts); the main feed itself is never in this
  -- list, it always renders last (infinite, can't be meaningfully "moved").
  hidden_modules    text[] not null default '{}',
  module_order      text[] not null default '{}',
  -- Content preferences: a category the viewer wants LESS of is excluded
  -- from "for_you" ranking entirely (mirrors the absolute "mute" semantics
  -- of muted_creators); a category they want MORE of gets a ranking bonus,
  -- never an exclusion of everything else.
  muted_categories   text[] not null default '{}',
  boosted_categories text[] not null default '{}',
  prefer_friends    boolean not null default false,
  fewer_reposts     boolean not null default false,
  quiet_mode        boolean not null default false,
  updated_at        timestamptz not null default now()
);

alter table public.user_home_preferences enable row level security;

drop policy if exists "home prefs self all" on public.user_home_preferences;
create policy "home prefs self all" on public.user_home_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
