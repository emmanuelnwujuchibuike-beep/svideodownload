-- Guest likes — an anonymous, deduped "like" from a signed-out visitor, used by
-- the landing-page reels mockup. Mirrors post_views (0007) exactly: a nullable
-- viewer_id + an ip_hash, deduped per identity/post/day via a coalesce() unique
-- index (a plain nullable column would NOT dedupe — NULLs are distinct in a
-- unique index). This keeps real reactions (post_reactions, which require a real
-- user) completely separate from anonymous appreciation.
--
-- Why a separate counter (guest_likes_count) rather than bumping likes_count:
-- likes_count reflects real, attributable reactions from real accounts. Guest
-- likes are honest but anonymous, so they get their own column and the app adds
-- the two only where it wants to show a combined figure. Nothing here can inflate
-- the real likes_count.

alter table public.posts
  add column if not exists guest_likes_count bigint not null default 0;

create table if not exists public.post_guest_likes (
  id         uuid primary key default uuid_generate_v4(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  viewer_id  uuid references auth.users (id) on delete set null,
  ip_hash    text not null default '',
  day        date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);

-- One guest like per identity per post per day. coalesce(viewer_id, ip_hash) so
-- anonymous likes dedupe too — identical to post_views_unique_idx.
create unique index if not exists post_guest_likes_unique_idx
  on public.post_guest_likes (post_id, (coalesce(viewer_id::text, ip_hash)), day);

create index if not exists post_guest_likes_post_idx
  on public.post_guest_likes (post_id);

-- guest_likes_count maintained by a trigger on the deduped table, exactly like
-- bump_post_views. Only a genuinely new (non-duplicate) insert bumps the count,
-- because the unique index makes a repeat a no-op before the trigger fires.
create or replace function public.bump_post_guest_likes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.posts set guest_likes_count = guest_likes_count + 1 where id = NEW.post_id;
  return null;
end $$;

drop trigger if exists post_guest_likes_count_trg on public.post_guest_likes;
create trigger post_guest_likes_count_trg
  after insert on public.post_guest_likes
  for each row execute function public.bump_post_guest_likes();

-- Writes come only from the server (service-role endpoint), never the browser
-- directly, so RLS is closed by default. Enable RLS with no policies = deny all
-- to anon/authenticated; the service role bypasses it. Matches post_views.
alter table public.post_guest_likes enable row level security;

-- Collapse ALL guest likes on one post into a SINGLE "Someone liked" notification
-- for the poster, rather than one row per anonymous liker. The notifications
-- table's own dedup index (0013) keys on actor_id, which is NULL for a guest and
-- therefore never collapses (NULLs distinct again), so guest likes need their own
-- partial unique index. The endpoint inserts with ON CONFLICT DO NOTHING against
-- this.
create unique index if not exists notifications_guest_like_unique_idx
  on public.notifications (user_id, post_id)
  where type = 'like' and actor_id is null;
