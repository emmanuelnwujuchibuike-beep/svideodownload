-- 0021_friend_favorites.sql
-- Friends Hub: Favorite Friends — a private, per-user star on a friendship so
-- favorites always sort to the top of the hub. One row per (owner, friend).
-- Owner-only visibility; writes go through the API (service role) so the
-- "must actually be friends" invariant is enforced server-side. Idempotent.

create table if not exists public.friend_favorites (
  user_id    uuid not null references auth.users (id) on delete cascade,
  friend_id  uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  constraint friend_favorites_not_self check (user_id <> friend_id)
);
create index if not exists friend_favorites_user_idx
  on public.friend_favorites (user_id, created_at desc);

alter table public.friend_favorites enable row level security;

drop policy if exists "friend favorites owner read" on public.friend_favorites;
create policy "friend favorites owner read" on public.friend_favorites
  for select using (user_id = auth.uid());
