-- 0027_collections.sql
-- Collections — user-curated sets of posts ("Save to collection" in the overflow
-- sheet). A collection is a named, privacy-scoped bucket; a collection_item is a
-- pointer to a post (never copies media, like reposts). Each collection carries
-- its own visibility (public | followers | private) so the profile Collections tab
-- honours the same per-tab privacy model as Reposts/Liked/Saved (migration 0026).
-- Idempotent.

create table if not exists public.collections (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  visibility text not null default 'private' check (visibility in ('public', 'followers', 'private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists collections_user_idx on public.collections (user_id, created_at desc);

create table if not exists public.collection_items (
  id            uuid primary key default uuid_generate_v4(),
  collection_id uuid not null references public.collections (id) on delete cascade,
  post_id       uuid not null references public.posts (id) on delete cascade,
  added_at      timestamptz not null default now(),
  unique (collection_id, post_id)
);
create index if not exists collection_items_coll_idx on public.collection_items (collection_id, added_at desc);
create index if not exists collection_items_post_idx on public.collection_items (post_id);

-- RLS is a safety net (the app writes via the service-role admin client). Owners
-- manage their own collections; everyone may read public ones.
alter table public.collections enable row level security;
alter table public.collection_items enable row level security;

drop policy if exists collections_read on public.collections;
create policy collections_read on public.collections
  for select using (visibility = 'public' or user_id = auth.uid());

drop policy if exists collections_write on public.collections;
create policy collections_write on public.collections
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists collection_items_read on public.collection_items;
create policy collection_items_read on public.collection_items
  for select using (
    exists (
      select 1 from public.collections c
      where c.id = collection_id and (c.visibility = 'public' or c.user_id = auth.uid())
    )
  );

drop policy if exists collection_items_write on public.collection_items;
create policy collection_items_write on public.collection_items
  for all using (
    exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid())
  );
