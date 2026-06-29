-- =====================================================================
-- FrenzSave — Phase 8 (content P2): engagement — reactions + comments
-- Likes/saves (post_reactions) and threaded comments (post_comments). The
-- denormalized counters on `posts` (likes_count, saves_count, comments_count)
-- are trigger-maintained. Shares are already counted via bump_post_counter.
-- Privacy/policy (comments_policy) is enforced in the API; RLS is the backstop.
-- Idempotent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- post_reactions — like / save (one row per (user, post, type))
-- ---------------------------------------------------------------------
create table if not exists public.post_reactions (
  user_id    uuid not null references auth.users (id) on delete cascade,
  post_id    uuid not null references public.posts (id) on delete cascade,
  type       text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id, type),
  constraint post_reactions_type_chk check (type in ('like','save'))
);
create index if not exists post_reactions_post_idx on public.post_reactions (post_id, type);
create index if not exists post_reactions_user_save_idx
  on public.post_reactions (user_id, created_at desc) where type = 'save';

-- ---------------------------------------------------------------------
-- post_comments — 1-level threads (parent_id null = top-level)
-- ---------------------------------------------------------------------
create table if not exists public.post_comments (
  id          uuid primary key default uuid_generate_v4(),
  post_id     uuid not null references public.posts (id) on delete cascade,
  author_id   uuid not null references auth.users (id) on delete cascade,
  parent_id   uuid references public.post_comments (id) on delete cascade,
  body        text not null,
  status      text not null default 'visible',
  likes_count int not null default 0,
  created_at  timestamptz not null default now(),
  constraint post_comments_status_chk check (status in ('visible','hidden','removed'))
);
create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at);
create index if not exists post_comments_parent_idx on public.post_comments (parent_id, created_at);

-- ---------------------------------------------------------------------
-- Counter triggers
-- ---------------------------------------------------------------------
create or replace function public.bump_post_reactions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (TG_OP = 'INSERT') then
    update public.posts set
      likes_count = likes_count + (NEW.type = 'like')::int,
      saves_count = saves_count + (NEW.type = 'save')::int
    where id = NEW.post_id;
  elsif (TG_OP = 'DELETE') then
    update public.posts set
      likes_count = greatest(0, likes_count - (OLD.type = 'like')::int),
      saves_count = greatest(0, saves_count - (OLD.type = 'save')::int)
    where id = OLD.post_id;
  end if;
  return null;
end $$;
drop trigger if exists post_reactions_count_trg on public.post_reactions;
create trigger post_reactions_count_trg
  after insert or delete on public.post_reactions
  for each row execute function public.bump_post_reactions();

create or replace function public.bump_post_comments()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (TG_OP = 'INSERT') then
    if NEW.status = 'visible' then
      update public.posts set comments_count = comments_count + 1 where id = NEW.post_id;
    end if;
  elsif (TG_OP = 'DELETE') then
    if OLD.status = 'visible' then
      update public.posts set comments_count = greatest(0, comments_count - 1) where id = OLD.post_id;
    end if;
  elsif (TG_OP = 'UPDATE') then
    if OLD.status = 'visible' and NEW.status <> 'visible' then
      update public.posts set comments_count = greatest(0, comments_count - 1) where id = NEW.post_id;
    elsif OLD.status <> 'visible' and NEW.status = 'visible' then
      update public.posts set comments_count = comments_count + 1 where id = NEW.post_id;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists post_comments_count_trg on public.post_comments;
create trigger post_comments_count_trg
  after insert or delete or update on public.post_comments
  for each row execute function public.bump_post_comments();

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.post_reactions enable row level security;
alter table public.post_comments  enable row level security;

-- reactions: a user manages + reads only their OWN reactions (counts are public
-- via the denormalized columns; who-liked-what stays private).
drop policy if exists "post_reactions self all" on public.post_reactions;
create policy "post_reactions self all" on public.post_reactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- comments: public read of visible comments; author inserts as self; author OR
-- the post's publisher OR an admin can remove. (Server reads via service role +
-- code filters; this is the backstop.)
drop policy if exists "post_comments public read" on public.post_comments;
create policy "post_comments public read" on public.post_comments
  for select using (status = 'visible' or auth.uid() = author_id or public.is_admin());
drop policy if exists "post_comments self insert" on public.post_comments;
create policy "post_comments self insert" on public.post_comments
  for insert with check (auth.uid() = author_id);
drop policy if exists "post_comments delete" on public.post_comments;
create policy "post_comments delete" on public.post_comments
  for delete using (
    auth.uid() = author_id
    or public.is_admin()
    or exists (select 1 from public.posts p where p.id = post_comments.post_id and p.publisher_id = auth.uid())
  );
drop policy if exists "post_comments owner update" on public.post_comments;
create policy "post_comments owner update" on public.post_comments
  for update using (
    auth.uid() = author_id
    or public.is_admin()
    or exists (select 1 from public.posts p where p.id = post_comments.post_id and p.publisher_id = auth.uid())
  );
