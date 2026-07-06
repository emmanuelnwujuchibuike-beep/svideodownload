-- 0032_post_media.sql
-- Multi-media posts (carousels / albums / reel albums): ordered media items
-- attached to a post. The posts row keeps its cover media_url/thumbnail (first
-- item) for full back-compat — single-media posts don't use this table at all.
-- Destination rules enforced at the API: photos → feed; multi-video → feed or
-- reels; MIXED photos+videos → feed only. Idempotent.

create table if not exists public.post_media (
  id            uuid primary key default uuid_generate_v4(),
  post_id       uuid not null references public.posts (id) on delete cascade,
  idx           integer not null,
  media_kind    text not null check (media_kind in ('image', 'video')),
  media_url     text not null,
  thumbnail_url text,
  media_width   integer,
  media_height  integer,
  created_at    timestamptz not null default now(),
  unique (post_id, idx)
);

create index if not exists post_media_post_idx on public.post_media (post_id, idx);

alter table public.post_media enable row level security;

-- Readable wherever the post is (visibility is enforced on the parent post by
-- every query path); writes go through the service role only — no user-facing
-- write policies on purpose.
drop policy if exists "post_media public read" on public.post_media;
create policy "post_media public read" on public.post_media for select using (true);
