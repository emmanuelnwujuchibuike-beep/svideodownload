-- =====================================================================
-- FrenzSave — Phase 13: notifications + realtime feed
-- A notifications table fed by triggers on follows / likes / comments, with
-- RLS so users only see their own. Both `notifications` and `posts` are added
-- to the realtime publication so the dashboard can live-update. Idempotent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users (id) on delete cascade,  -- recipient
  actor_id    uuid references auth.users (id) on delete cascade,           -- who triggered it
  type        text not null,                                               -- follow | like | comment
  post_id     uuid references public.posts (id) on delete cascade,
  comment_id  uuid references public.post_comments (id) on delete cascade,
  read        boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint notifications_type_chk check (type in ('follow','like','comment'))
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id) where read = false;

-- Collapse duplicate spam (re-like/unlike/like) into one row per actor+post+type.
create unique index if not exists notifications_dedupe_uidx
  on public.notifications (user_id, actor_id, type, coalesce(post_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where type in ('follow','like');

alter table public.notifications enable row level security;

drop policy if exists "notifications owner read" on public.notifications;
create policy "notifications owner read" on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists "notifications owner update" on public.notifications;
create policy "notifications owner update" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "notifications owner delete" on public.notifications;
create policy "notifications owner delete" on public.notifications
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Trigger fns (security definer: bypass RLS to insert for the recipient)
-- ---------------------------------------------------------------------
create or replace function public.notify_on_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.follower_id = new.following_id then return new; end if;
  insert into public.notifications (user_id, actor_id, type)
  values (new.following_id, new.follower_id, 'follow')
  on conflict do nothing;
  return new;
end $$;

create or replace function public.notify_on_reaction()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner_id uuid;
begin
  if new.type <> 'like' then return new; end if;
  select publisher_id into owner_id from public.posts where id = new.post_id;
  if owner_id is null or owner_id = new.user_id then return new; end if;
  insert into public.notifications (user_id, actor_id, type, post_id)
  values (owner_id, new.user_id, 'like', new.post_id)
  on conflict do nothing;
  return new;
end $$;

create or replace function public.notify_on_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner_id uuid;
begin
  select publisher_id into owner_id from public.posts where id = new.post_id;
  if owner_id is null or owner_id = new.author_id then return new; end if;
  insert into public.notifications (user_id, actor_id, type, post_id, comment_id)
  values (owner_id, new.author_id, 'comment', new.post_id, new.id);
  return new;
end $$;

drop trigger if exists trg_notify_follow on public.follows;
create trigger trg_notify_follow after insert on public.follows
  for each row execute function public.notify_on_follow();

drop trigger if exists trg_notify_reaction on public.post_reactions;
create trigger trg_notify_reaction after insert on public.post_reactions
  for each row execute function public.notify_on_reaction();

drop trigger if exists trg_notify_comment on public.post_comments;
create trigger trg_notify_comment after insert on public.post_comments
  for each row execute function public.notify_on_comment();

-- ---------------------------------------------------------------------
-- Realtime: live notifications + live feed
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'posts'
  ) then
    alter publication supabase_realtime add table public.posts;
  end if;
end $$;
