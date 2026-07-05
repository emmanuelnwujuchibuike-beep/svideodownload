-- 0025_reposts.sql
-- Reposts — the attribution-preserving repost model (Twitter-retweet style):
-- a repost is a lightweight POINTER to the original post, never a media copy, so
-- the original creator + timestamps stay intact and repost metrics are tracked
-- separately from the original engagement. One row per (user, post). Maintains
-- posts.reposts_count and notifies the original creator. Idempotent.

create table if not exists public.reposts (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references auth.users (id) on delete cascade,   -- the reposter
  post_id    uuid not null references public.posts (id) on delete cascade,  -- the original
  created_at timestamptz not null default now(),
  unique (user_id, post_id)
);

create index if not exists reposts_user_idx on public.reposts (user_id, created_at desc);
create index if not exists reposts_post_idx on public.reposts (post_id, created_at desc);

alter table public.reposts enable row level security;

-- Reposts are public (profiles + repost badges surface them); writes are owner-only.
drop policy if exists "reposts public read" on public.reposts;
create policy "reposts public read" on public.reposts for select using (true);

drop policy if exists "reposts owner insert" on public.reposts;
create policy "reposts owner insert" on public.reposts
  for insert with check (user_id = auth.uid());

drop policy if exists "reposts owner delete" on public.reposts;
create policy "reposts owner delete" on public.reposts
  for delete using (user_id = auth.uid());

-- Denormalized count on posts (separate from likes/comments/shares — never merged).
alter table public.posts add column if not exists reposts_count integer not null default 0;

-- Keep posts.reposts_count in sync.
create or replace function public.reposts_count_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set reposts_count = reposts_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' then
    update public.posts set reposts_count = greatest(0, reposts_count - 1) where id = old.post_id;
  end if;
  return null;
end $$;
drop trigger if exists reposts_count_sync_trg on public.reposts;
create trigger reposts_count_sync_trg
  after insert or delete on public.reposts
  for each row execute function public.reposts_count_sync();

-- Notify the original creator on a fresh repost (deduped per reposter+post).
create unique index if not exists notifications_repost_dedupe_uidx
  on public.notifications (user_id, actor_id, type, post_id)
  where type = 'repost';

create or replace function public.notify_on_repost()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner_id uuid;
begin
  select publisher_id into owner_id from public.posts where id = new.post_id;
  if owner_id is null or owner_id = new.user_id then return new; end if;
  insert into public.notifications (user_id, actor_id, type, post_id)
  values (owner_id, new.user_id, 'repost', new.post_id)
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists notify_on_repost_trg on public.reposts;
create trigger notify_on_repost_trg
  after insert on public.reposts
  for each row execute function public.notify_on_repost();
