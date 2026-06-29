-- =====================================================================
-- FrenzSave — Phase 15: Stories (24h ephemeral posts)
-- Users upload from their gallery → a Story that auto-expires after 24h.
-- Media lives in the existing public `post-media` bucket. Idempotent.
-- =====================================================================

create table if not exists public.stories (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  media_url   text not null,
  media_kind  text not null default 'image',          -- image | video
  caption     text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '24 hours'),
  constraint stories_kind_chk check (media_kind in ('image','video'))
);

create index if not exists stories_active_idx on public.stories (expires_at desc, created_at desc);
create index if not exists stories_user_idx   on public.stories (user_id, created_at desc);

alter table public.stories enable row level security;

-- Anyone may read stories that haven't expired.
drop policy if exists "stories public read" on public.stories;
create policy "stories public read" on public.stories
  for select using (expires_at > now());

-- Owners manage their own stories.
drop policy if exists "stories owner insert" on public.stories;
create policy "stories owner insert" on public.stories
  for insert with check (user_id = auth.uid());

drop policy if exists "stories owner delete" on public.stories;
create policy "stories owner delete" on public.stories
  for delete using (user_id = auth.uid());
