-- ═══════════════════════════════════════════════════════════════════════════
--  0289 — Story highlights (Stories Part 5, 2026-10-27)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-27: "build everything so nothing is fake or coming soon in the story features". The Highlight
-- button said "coming soon": keeping a story past its 24 hours needs a place on the profile and an exception in
-- the daily clean-up (Stories Part 1). This is that place.
--
--   story_highlights        a member's named collection, shown as a circle on their profile
--   story_highlight_items   one saved story in it: a COPY of the story's media reference, taken when it is added,
--                           so it outlives the story row (the sweep removes that after 24 hours)
--
-- The clean-up exception needs no code: story_media_references (0285) treats every *_url column in public as a
-- reference, so a file a highlight keeps (media_url, thumbnail_url, cover_url) is never deleted by the sweep.
--
-- Access is the stories model after 0285: anon and authenticated have no table access at all; every read and
-- write goes through the server (lib/social/story-highlights.ts), which applies the stories visibility rule
-- (who may see this member's stories may see their highlights) and owner-only writes.
--
-- source_story_id has no foreign key on purpose: the story row is swept, the highlight item is not.

create table if not exists public.story_highlights (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  cover_url   text,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint story_highlights_title_chk check (char_length(btrim(title)) between 1 and 30)
);

create index if not exists story_highlights_user_idx on public.story_highlights (user_id, position, created_at);

create table if not exists public.story_highlight_items (
  id               uuid primary key default gen_random_uuid(),
  highlight_id     uuid not null references public.story_highlights (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  source_story_id  uuid,
  media_url        text not null,
  media_kind       text not null,
  thumbnail_url    text,
  caption          text,
  story_created_at timestamptz not null default now(),
  added_at         timestamptz not null default now(),
  constraint story_highlight_items_kind_chk check (media_kind in ('image', 'video')),
  constraint story_highlight_items_once unique (highlight_id, source_story_id)
);

create index if not exists story_highlight_items_highlight_idx on public.story_highlight_items (highlight_id, story_created_at);
create index if not exists story_highlight_items_user_idx on public.story_highlight_items (user_id);

alter table public.story_highlights enable row level security;
alter table public.story_highlight_items enable row level security;

revoke all on table public.story_highlights from anon;
revoke all on table public.story_highlights from authenticated;
revoke all on table public.story_highlight_items from anon;
revoke all on table public.story_highlight_items from authenticated;
