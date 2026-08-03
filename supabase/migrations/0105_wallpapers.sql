-- =====================================================================
-- 0105_wallpapers.sql
-- Frenzsave · Wallpapers — a real, admin-managed library with real
-- engagement, replacing the 12 hard-coded placeholder entries in
-- lib/wallpapers.ts.
--
-- ── Model ──────────────────────────────────────────────────────────────
-- `wallpapers` rows are uploaded by an admin from the dashboard; the bytes
-- live in the PUBLIC `wallpapers` storage bucket. Members can like, save and
-- comment on them, and the reels-style viewer scrolls the published set.
--
-- Counters are stored on the row and maintained by triggers rather than
-- counted on every read: the grid and the viewer both show them for every
-- visible wallpaper at once, and a count(*) per card per render would be the
-- slowest thing on the page. They are REAL counts — the triggers are the only
-- writer, so they cannot drift into decoration.
--
-- ── Security ───────────────────────────────────────────────────────────
-- Anyone (signed in or not) may READ published wallpapers. Only the service
-- role — i.e. the getAdminUser-guarded admin routes — writes the library
-- itself; there is deliberately no policy that lets a member insert one.
-- Likes/saves/comments are scoped to their owner: you may only create, and
-- only delete, your own.
--
-- Idempotent; safe to re-run.
-- =====================================================================

create table if not exists public.wallpapers (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  category        text not null default 'Abstract',
  -- Public URLs in the `wallpapers` bucket. `thumb_url` may be null; the grid
  -- then falls back to the full image.
  image_url       text not null,
  thumb_url       text,
  width           integer,
  height          integer,
  bytes           bigint,
  -- 'published' | 'hidden' — hidden keeps a row (and its engagement) without
  -- showing it, which is what an operator actually wants over a hard delete.
  status          text not null default 'published',
  sort_order      integer not null default 0,
  -- 'admin'  — curated by an operator from the dashboard
  -- 'member' — shared to the public library by a member from their downloads
  source          text not null default 'admin',
  uploaded_by     uuid references auth.users (id) on delete set null,
  likes_count     integer not null default 0,
  saves_count     integer not null default 0,
  comments_count  integer not null default 0,
  downloads_count integer not null default 0,
  created_at      timestamptz not null default now()
);

create table if not exists public.wallpaper_likes (
  wallpaper_id uuid not null references public.wallpapers (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (wallpaper_id, user_id)
);

create table if not exists public.wallpaper_saves (
  wallpaper_id uuid not null references public.wallpapers (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (wallpaper_id, user_id)
);

create table if not exists public.wallpaper_comments (
  id           uuid primary key default gen_random_uuid(),
  wallpaper_id uuid not null references public.wallpapers (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  body         text not null,
  created_at   timestamptz not null default now()
);

create index if not exists wallpapers_published_idx
  on public.wallpapers (status, sort_order, created_at desc);
create index if not exists wallpaper_saves_user_idx
  on public.wallpaper_saves (user_id, created_at desc);
create index if not exists wallpaper_comments_wallpaper_idx
  on public.wallpaper_comments (wallpaper_id, created_at desc);

-- ── Counter triggers ─────────────────────────────────────────────────
create or replace function public.bump_wallpaper_counter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.wallpaper_id, old.wallpaper_id);
  delta  integer := case when tg_op = 'INSERT' then 1 else -1 end;
begin
  if tg_argv[0] = 'likes' then
    update public.wallpapers set likes_count = greatest(0, likes_count + delta) where id = target;
  elsif tg_argv[0] = 'saves' then
    update public.wallpapers set saves_count = greatest(0, saves_count + delta) where id = target;
  elsif tg_argv[0] = 'comments' then
    update public.wallpapers set comments_count = greatest(0, comments_count + delta) where id = target;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists wallpaper_likes_count on public.wallpaper_likes;
create trigger wallpaper_likes_count
  after insert or delete on public.wallpaper_likes
  for each row execute function public.bump_wallpaper_counter('likes');

drop trigger if exists wallpaper_saves_count on public.wallpaper_saves;
create trigger wallpaper_saves_count
  after insert or delete on public.wallpaper_saves
  for each row execute function public.bump_wallpaper_counter('saves');

drop trigger if exists wallpaper_comments_count on public.wallpaper_comments;
create trigger wallpaper_comments_count
  after insert or delete on public.wallpaper_comments
  for each row execute function public.bump_wallpaper_counter('comments');

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.wallpapers         enable row level security;
alter table public.wallpaper_likes    enable row level security;
alter table public.wallpaper_saves    enable row level security;
alter table public.wallpaper_comments enable row level security;

-- The library is public reading matter; signed-out visitors browse it too.
drop policy if exists "wallpapers public read" on public.wallpapers;
create policy "wallpapers public read" on public.wallpapers
  for select using (status = 'published');

-- A member may SHARE an image they downloaded into the public library (owner:
-- "users who signed in can share their wallpaper image download to public").
-- Strictly as themselves, strictly as a member submission: they cannot forge an
-- admin-curated row, cannot backdate counters, and cannot publish on behalf of
-- anyone else. An operator can still hide any row from the dashboard.
drop policy if exists "wallpapers member share" on public.wallpapers;
create policy "wallpapers member share" on public.wallpapers
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and source = 'member'
    and status = 'published'
    and likes_count = 0
    and saves_count = 0
    and comments_count = 0
    and downloads_count = 0
  );

-- …and take their own submission back down.
drop policy if exists "wallpapers member delete own" on public.wallpapers;
create policy "wallpapers member delete own" on public.wallpapers
  for delete to authenticated
  using (uploaded_by = auth.uid() and source = 'member');

drop policy if exists "wallpaper likes read" on public.wallpaper_likes;
create policy "wallpaper likes read" on public.wallpaper_likes for select using (true);

drop policy if exists "wallpaper likes own write" on public.wallpaper_likes;
create policy "wallpaper likes own write" on public.wallpaper_likes
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "wallpaper likes own delete" on public.wallpaper_likes;
create policy "wallpaper likes own delete" on public.wallpaper_likes
  for delete to authenticated using (auth.uid() = user_id);

-- Saves are private: what you keep is nobody else's business.
drop policy if exists "wallpaper saves own read" on public.wallpaper_saves;
create policy "wallpaper saves own read" on public.wallpaper_saves
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "wallpaper saves own write" on public.wallpaper_saves;
create policy "wallpaper saves own write" on public.wallpaper_saves
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "wallpaper saves own delete" on public.wallpaper_saves;
create policy "wallpaper saves own delete" on public.wallpaper_saves
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "wallpaper comments read" on public.wallpaper_comments;
create policy "wallpaper comments read" on public.wallpaper_comments for select using (true);

drop policy if exists "wallpaper comments own write" on public.wallpaper_comments;
create policy "wallpaper comments own write" on public.wallpaper_comments
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "wallpaper comments own delete" on public.wallpaper_comments;
create policy "wallpaper comments own delete" on public.wallpaper_comments
  for delete to authenticated using (auth.uid() = user_id);

-- ── Storage ──────────────────────────────────────────────────────────
-- Public: these are wallpapers, meant to be looked at and downloaded. Writes
-- still go through the admin route (service role), so there is no member
-- insert policy here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wallpapers',
  'wallpapers',
  true,
  20971520,                                    -- 20 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "wallpapers public read" on storage.objects;
create policy "wallpapers public read" on storage.objects
  for select using (bucket_id = 'wallpapers');

-- Member shares upload into `members/<uid>/…`. Admin uploads go through the
-- service role, which bypasses this, so operators are unaffected by the folder
-- rule while members are confined to their own.
drop policy if exists "wallpapers member upload" on storage.objects;
create policy "wallpapers member upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'wallpapers'
    and (storage.foldername(name))[1] = 'members'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "wallpapers member delete own" on storage.objects;
create policy "wallpapers member delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'wallpapers'
    and (storage.foldername(name))[1] = 'members'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
