-- =====================================================================
-- 0035_muted_creators.sql — per-viewer creator muting
-- =====================================================================
-- "Mute creator" already exists as a menu row in the reel and image viewers
-- (features/feed/reel-viewer.tsx, features/feed/image-viewer.tsx) but has
-- never had a table behind it — tapping it just toasts "coming soon". This
-- is that table.
--
-- Deliberately NOT the same as a block: muting is one-directional, silent
-- (the muted creator is never notified, unlike a block which severs follows
-- both ways), and only affects what the MUTER's own feed shows them — it
-- never touches the muted creator's ability to see or interact with the
-- muter. Structurally mirrors public.blocks (see 0006_social_identity.sql)
-- for the same reasons: a simple directed pair + a self-mute guard.

create table if not exists public.muted_creators (
  muter_id   uuid not null references auth.users (id) on delete cascade,
  muted_id   uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  constraint muted_creators_no_self check (muter_id <> muted_id)
);
create index if not exists muted_creators_muted_idx on public.muted_creators (muted_id);

alter table public.muted_creators enable row level security;

-- Only the muter can see or manage their own mutes — a muted creator must
-- never be able to discover they've been muted via a readable table.
drop policy if exists "muted self all" on public.muted_creators;
create policy "muted self all" on public.muted_creators
  for all using (auth.uid() = muter_id) with check (auth.uid() = muter_id);
