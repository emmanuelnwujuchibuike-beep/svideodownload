-- =====================================================================
-- 0100_journal_entries.sql
-- Frenzsave · Private Journal (Feature 18 · Life Memories) — short private
-- notes the owner writes about their own life. Never shown to anyone else.
--
-- Always private, always self-owned — there is deliberately no visibility
-- column and no policy granting anyone else access, including "friends"
-- or "public": a journal that could ever be shared is a different
-- feature, not a visibility setting on this one.
--
-- Idempotent; safe to re-run.
-- =====================================================================

create table if not exists public.journal_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  content     text not null,
  -- Optional mood tag — reuses the same PROFILE_MOODS vocabulary as the
  -- profile's own Status & Mood field (lib/social/profile.ts), rather than
  -- inventing a second mood catalog.
  mood        text,
  created_at  timestamptz not null default now()
);

create index if not exists journal_entries_user_idx
  on public.journal_entries (user_id, created_at desc);

alter table public.journal_entries enable row level security;

drop policy if exists "journal_entries self all" on public.journal_entries;
create policy "journal_entries self all" on public.journal_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
