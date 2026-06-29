-- =====================================================================
-- FrenzSave — Phase 7 (content P1): published downloads ("posts")
-- Directory model: posts store METADATA + a source reference only — NO media
-- file is hosted. The public page re-extracts from source on demand via the
-- existing /api/download pipeline. Denormalized counters are trigger/function
-- maintained for O(1) reads; privacy is enforced in RLS. Idempotent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- posts
-- ---------------------------------------------------------------------
create table if not exists public.posts (
  id              uuid primary key default uuid_generate_v4(),
  publisher_id    uuid not null references auth.users (id) on delete cascade,
  source_url      text not null,
  source_url_hash text not null,                 -- sha256(normalized url)
  platform        text not null,
  source_author   text,                          -- original platform author (attribution)
  media_kind      text not null default 'video', -- video | image | audio
  title           text not null,
  description     text,
  category        text,
  thumbnail_url   text,
  duration_sec    int,
  visibility      text not null default 'public',
  status          text not null default 'published',
  is_nsfw         boolean not null default false,
  -- denormalized counters
  views_count     bigint not null default 0,
  likes_count     int not null default 0,
  saves_count     int not null default 0,
  shares_count    int not null default 0,
  comments_count  int not null default 0,
  downloads_count int not null default 0,
  -- trending (materialized; Phase 3)
  hot_score       double precision not null default 0,
  created_at      timestamptz not null default now(),
  constraint posts_visibility_chk check (visibility in ('public','followers','private')),
  constraint posts_status_chk     check (status in ('published','under_review','removed')),
  constraint posts_kind_chk       check (media_kind in ('video','image','audio'))
);

-- A user can't publish the same source twice (anti-spam dedupe).
create unique index if not exists posts_publisher_source_uidx
  on public.posts (publisher_id, source_url_hash);
create index if not exists posts_publisher_idx on public.posts (publisher_id, created_at desc);
create index if not exists posts_feed_idx      on public.posts (status, visibility, hot_score desc);
create index if not exists posts_category_idx  on public.posts (category, hot_score desc);
create index if not exists posts_recent_idx    on public.posts (status, visibility, created_at desc);

-- ---------------------------------------------------------------------
-- post_views — deduped per (viewer|ip, post, day) to resist view spam
-- ---------------------------------------------------------------------
create table if not exists public.post_views (
  id         uuid primary key default uuid_generate_v4(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  viewer_id  uuid references auth.users (id) on delete set null,
  ip_hash    text not null default '',
  day        date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);
-- One unique view per identity per post per day. coalesce(viewer_id, ip_hash)
-- so ANONYMOUS views dedupe too (a nullable column alone wouldn't — NULLs are
-- distinct in a unique index).
create unique index if not exists post_views_unique_idx
  on public.post_views (post_id, (coalesce(viewer_id::text, ip_hash)), day);

-- ---------------------------------------------------------------------
-- reports — content + user moderation queue
-- ---------------------------------------------------------------------
create table if not exists public.reports (
  id          uuid primary key default uuid_generate_v4(),
  reporter_id uuid references auth.users (id) on delete set null,
  target_type text not null,                 -- post | comment | user
  target_id   uuid not null,
  reason      text not null,
  note        text,
  status      text not null default 'open',  -- open | actioned | dismissed
  created_at  timestamptz not null default now(),
  constraint reports_target_chk check (target_type in ('post','comment','user')),
  constraint reports_status_chk check (status in ('open','actioned','dismissed'))
);
create index if not exists reports_status_idx on public.reports (status, created_at desc);

-- ---------------------------------------------------------------------
-- Counters
-- ---------------------------------------------------------------------
-- views_count maintained by a trigger on the deduped post_views table.
create or replace function public.bump_post_views()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.posts set views_count = views_count + 1 where id = NEW.post_id;
  return null;
end $$;
drop trigger if exists post_views_count_trg on public.post_views;
create trigger post_views_count_trg
  after insert on public.post_views
  for each row execute function public.bump_post_views();

-- Safe, whitelisted counter bump for share/download events (no dynamic SQL).
create or replace function public.bump_post_counter(p_id uuid, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.posts set
    shares_count    = shares_count    + (p_kind = 'share')::int,
    downloads_count = downloads_count + (p_kind = 'download')::int
  where id = p_id;
end $$;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.posts      enable row level security;
alter table public.post_views enable row level security;
alter table public.reports    enable row level security;

-- posts: public read of published, visible posts from non-suspended publishers
-- who haven't blocked the viewer. (Server reads use the service role + apply
-- privacy in code; this is defense-in-depth for any direct client reads.)
drop policy if exists "posts public read" on public.posts;
create policy "posts public read" on public.posts
  for select using (
    status = 'published'
    and not exists (select 1 from public.profiles p where p.id = posts.publisher_id and p.is_suspended)
    and not exists (select 1 from public.blocks b where b.blocker_id = posts.publisher_id and b.blocked_id = auth.uid())
    and (
      visibility = 'public'
      or auth.uid() = publisher_id
      or (visibility = 'followers' and exists (
        select 1 from public.follows f where f.following_id = posts.publisher_id and f.follower_id = auth.uid()
      ))
    )
  );
drop policy if exists "posts owner all" on public.posts;
create policy "posts owner all" on public.posts
  for all using (auth.uid() = publisher_id or public.is_admin())
  with check (auth.uid() = publisher_id or public.is_admin());

-- post_views: writes/reads via the service role only (no client policies).

-- reports: a signed-in user files reports as themselves; admins read all.
drop policy if exists "reports self insert" on public.reports;
create policy "reports self insert" on public.reports
  for insert with check (auth.uid() = reporter_id);
drop policy if exists "reports admin read" on public.reports;
create policy "reports admin read" on public.reports
  for select using (public.is_admin());
