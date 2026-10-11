-- 0229 — Shared Memories™ and Life Journey™ (Feature 19 · Part 14, 2026-10-11).
--
-- A memory is something a member CHOSE to keep. Nothing here is written by a
-- background job: the Shared Memory Engine proposes memories from moments other
-- tables already own (lib/social/memories/sources.ts), and a row exists only once
-- the member keeps one or writes their own. So every memory is private by default
-- and under its owner's control.
--
--   memories                  the memory: title, note, category, date, optional
--                             place and feeling, where it came from, who may see it
--   memory_people             the people it is shared with / about
--   memory_media              references to EXISTING media (a post, or an https
--                             URL on our own hosts) — no new storage
--   memory_versions           every previous version (written by a trigger)
--   memory_collections(+items) albums, made by hand or accepted from a suggestion
--   memory_reminder_dismissals "on this day" cards a member dismissed
--
-- Visibility: private | people (the people on it) | friends | circle (one of the
-- owner's circles). The server checks it on every read (lib/social/memories/server.ts);
-- RLS lets an owner read their own rows and nothing else from a browser.
-- Archive hides; delete moves to a 30-day trash the owner can restore from.
--
-- Idempotent. No semicolon inside any quoted string. Every dollar-quoted block is at the end.

create table if not exists public.memories (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  note        text,
  category    text not null default 'friendship',
  occurred_on date not null default current_date,
  place       text,
  feeling     text,
  link_url    text,
  source_kind text not null default 'manual',
  source_ref  text,
  visibility  text not null default 'private',
  circle_id   uuid references public.social_circles (id) on delete set null,
  pinned      boolean not null default false,
  version     integer not null default 1,
  archived_at timestamptz,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  search      tsvector generated always as (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(note, '') || ' ' || coalesce(category, '') || ' ' || coalesce(place, ''))) stored
);
create index if not exists memories_owner_idx on public.memories (owner_id, occurred_on desc) where deleted_at is null;
create index if not exists memories_search_idx on public.memories using gin (search);
-- a suggestion is kept once: the same source can never become two memories
create unique index if not exists memories_source_uidx on public.memories (owner_id, source_kind, source_ref) where source_ref is not null;
alter table public.memories enable row level security;
drop policy if exists "memories owner read" on public.memories;
create policy "memories owner read" on public.memories for select using ((select auth.uid()) = owner_id);

create table if not exists public.memory_people (
  memory_id uuid not null references public.memories (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (memory_id, user_id)
);
create index if not exists memory_people_user_idx on public.memory_people (user_id);
alter table public.memory_people enable row level security;

create table if not exists public.memory_media (
  memory_id uuid not null references public.memories (id) on delete cascade,
  idx       smallint not null,
  kind      text not null,
  post_id   uuid references public.posts (id) on delete set null,
  url       text,
  primary key (memory_id, idx)
);
alter table public.memory_media enable row level security;

create table if not exists public.memory_versions (
  memory_id  uuid not null references public.memories (id) on delete cascade,
  version    integer not null,
  snapshot   jsonb not null,
  created_at timestamptz not null default now(),
  primary key (memory_id, version)
);
alter table public.memory_versions enable row level security;

create table if not exists public.memory_collections (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,
  title         text not null,
  description   text,
  visibility    text not null default 'private',
  suggestion_key text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists memory_collections_owner_idx on public.memory_collections (owner_id, updated_at desc);
alter table public.memory_collections enable row level security;
drop policy if exists "memory collections owner read" on public.memory_collections;
create policy "memory collections owner read" on public.memory_collections for select using ((select auth.uid()) = owner_id);

create table if not exists public.memory_collection_items (
  collection_id uuid not null references public.memory_collections (id) on delete cascade,
  memory_id     uuid not null references public.memories (id) on delete cascade,
  added_at      timestamptz not null default now(),
  primary key (collection_id, memory_id)
);
alter table public.memory_collection_items enable row level security;

create table if not exists public.memory_reminder_dismissals (
  owner_id     uuid not null references auth.users (id) on delete cascade,
  key          text not null,
  dismissed_at timestamptz not null default now(),
  primary key (owner_id, key)
);
alter table public.memory_reminder_dismissals enable row level security;

comment on table public.memories is '0229: a memory a member kept (manual or accepted from a suggestion). Private by default. Never written by a background job.';
comment on table public.memory_versions is '0229: every previous version of a memory, written by memories_version_trg. Restorable by the owner.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
begin
  begin
    alter table public.memories add constraint memories_chk check (
      char_length(title) between 1 and 120
      and (note is null or char_length(note) <= 4000)
      and category in ('friendship', 'travel', 'education', 'business', 'photography', 'programming', 'fitness', 'music', 'gaming', 'nature', 'communities', 'events', 'family', 'projects', 'marketplace', 'creator')
      and (place is null or char_length(place) <= 120)
      and (feeling is null or feeling in ('joyful', 'grateful', 'proud', 'calm', 'excited', 'nostalgic', 'loved', 'inspired'))
      and (link_url is null or (link_url like 'https://%' and char_length(link_url) <= 600))
      and source_kind in ('manual', 'friendship', 'first_message', 'collaboration', 'pro_connection', 'recommendation', 'membership', 'capsule', 'first_post', 'post')
      and (source_ref is null or char_length(source_ref) <= 200)
      and visibility in ('private', 'people', 'friends', 'circle')
      and (visibility <> 'circle' or circle_id is not null)
      and occurred_on between date '1900-01-01' and date '2200-01-01');
  exception when duplicate_object then null;
  end;
  begin
    alter table public.memory_media add constraint memory_media_chk check (
      kind in ('post', 'image', 'video', 'link') and idx between 0 and 19
      and ((kind = 'post' and post_id is not null) or (kind <> 'post' and url is not null and url like 'https://%' and char_length(url) <= 600)));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.memory_collections add constraint memory_collections_chk check (
      char_length(title) between 1 and 80 and (description is null or char_length(description) <= 400)
      and visibility in ('private', 'people', 'friends'));
  exception when duplicate_object then null;
  end;
end $$;

-- every edit keeps the version it replaced (title, note, category, date, place,
-- feeling, link, visibility, circle and pin), so any version can be restored
create or replace function public.memories_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (old.title, old.note, old.category, old.occurred_on, old.place, old.feeling, old.link_url, old.visibility, old.circle_id, old.pinned)
     is not distinct from (new.title, new.note, new.category, new.occurred_on, new.place, new.feeling, new.link_url, new.visibility, new.circle_id, new.pinned) then
    return new;
  end if;
  insert into public.memory_versions (memory_id, version, snapshot)
  values (old.id, old.version, jsonb_build_object('title', old.title, 'note', old.note, 'category', old.category, 'occurred_on', old.occurred_on, 'place', old.place, 'feeling', old.feeling, 'link_url', old.link_url, 'visibility', old.visibility, 'circle_id', old.circle_id, 'pinned', old.pinned))
  on conflict (memory_id, version) do nothing;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

do $$
begin
  drop trigger if exists memories_version_trg on public.memories;
  create trigger memories_version_trg before update on public.memories for each row execute function public.memories_version();
  revoke all on function public.memories_version() from public, anon, authenticated;
end $$;
