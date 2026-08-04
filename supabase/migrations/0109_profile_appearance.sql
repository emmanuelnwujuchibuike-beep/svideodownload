-- =====================================================================
-- 0109_profile_appearance.sql
-- Frenzsave · Profile Layout Studio™ (Feature 18 · Part 16)
--
-- A member's visual preferences for their own profile: a theme, the card
-- surface, corner radius and typography scale.
--
-- ── Why a table and not four more columns on `profiles` ────────────────
-- `profiles` already carries status, mood, accent, identity media, the
-- reputation bonus, profile type and landing module. It is the hottest row
-- in the database — read on every profile view, every feed card and every
-- follower list — and every column added to it is width paid on all of
-- those reads, forever, for a preference only its owner ever edits.
--
-- One row per member here, read once by the profile page and by nothing
-- else. A member who has never opened the Layout Studio has NO row at all
-- and costs nothing; the engine resolves defaults in code
-- (`lib/profile/theme.ts`), which is also what makes the feature work
-- before this migration is applied.
--
-- The accent deliberately stays on `profiles` (migration 0096). It shipped
-- there, it is already read by the hero, and moving it would be a data
-- migration for no benefit — the theme engine reads both and lets the
-- member's own accent win.
--
-- ── Values are not constrained here ────────────────────────────────────
-- No CHECK constraints on theme/surface/radius. The registries in
-- `lib/profile/theme.ts` are the source of truth, the API validates
-- against them, and the reader falls back for anything unknown. A CHECK
-- would mean a database migration every time a theme is added, and would
-- turn a renamed theme into a write failure instead of a graceful default.
--
-- ── Security ───────────────────────────────────────────────────────────
-- RLS: owner-only for reads and writes. Public reads go through the
-- service role in `lib/social/profile-appearance.ts`, the same pattern as
-- the rest of the profile platform — a visitor must see the theme, but
-- must never be able to write it.
--
-- Idempotent; safe to re-run.
-- =====================================================================

create table if not exists public.profile_appearance (
  user_id     uuid primary key references auth.users (id) on delete cascade,

  -- 'classic' | 'minimal' | 'glass' | 'titanium' | 'carbon' | 'aurora'
  -- | 'midnight' | 'ocean' | 'sunrise' | 'forest'
  theme       text,
  -- 'solid' | 'glass' | 'floating' | 'outlined'
  surface     text,
  -- 'sharp' | 'soft' | 'rounded' | 'pill'
  radius      text,
  -- 'compact' | 'default' | 'comfortable' | 'large'
  font_scale  text,

  updated_at  timestamptz not null default now()
);

alter table public.profile_appearance enable row level security;

drop policy if exists "profile appearance own" on public.profile_appearance;
create policy "profile appearance own" on public.profile_appearance
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
