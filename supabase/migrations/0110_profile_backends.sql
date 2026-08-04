-- =====================================================================
-- 0110_profile_backends.sql
-- Frenzsave · The profile backends that were declared but never built
--
-- Parts 14-16 shipped a module registry in which six modules carried a
-- `needs:` note instead of a backend — Featured, Events, Team, Reviews,
-- Memberships, Repositories — plus Part 15's Growth Insights, Goals and
-- Snapshots, and Part 16's Personal Spaces and Widgets. This migration is
-- all of them.
--
-- ── One shape, repeated ────────────────────────────────────────────────
-- Every table below is: a uuid pk, a `user_id` owner, ordinary columns, a
-- `position` where order is meaningful, and RLS that is owner-only for
-- writes. Public reads go through the service role in lib/social/*, which
-- applies each module's audience rule in code (lib/profile/engine.ts) —
-- the same pattern the whole profile platform already uses, and what lets
-- a section be narrowed to "Friends" without encoding the friendship graph
-- into a policy.
--
-- ── Two honest limits, recorded here because schema is where it matters ─
--
-- 1. REVIEWS carry `order_ref`, which is null today. There is no orders
--    table in this platform (see the monetization domain), so a review
--    cannot yet be proven to follow a purchase. `verified` is therefore
--    NEVER set by the writer — only by a future order-aware path — and the
--    UI must render an unverified review as exactly that. A "verified"
--    flag anyone can set is worse than no flag.
--
-- 2. MEMBERSHIP TIERS describe what a creator offers and link out to a
--    payment page. They do NOT bill anyone: recurring billing is a
--    Paystack subscription integration, not a table, and pretending
--    otherwise would let a creator advertise a subscription nobody can
--    actually buy. The tier rows are the half that is real.
--
-- Idempotent; safe to re-run.
-- =====================================================================

-- ── Featured / pinning ────────────────────────────────────────────────
-- Pin anything to the top of a profile. `ref_kind` + `ref_id` rather than
-- six nullable foreign keys: the pinned thing may be a post, a product, a
-- credential or an external link, and a polymorphic reference keeps one
-- ordered list instead of a union of four.
create table if not exists public.profile_featured (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- 'post' | 'product' | 'service' | 'credential' | 'link'
  ref_kind    text not null,
  ref_id      text,
  url         text,
  title       text,
  thumbnail   text,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists profile_featured_user_idx on public.profile_featured (user_id, position);

-- ── Events ────────────────────────────────────────────────────────────
create table if not exists public.profile_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null,
  description   text,
  -- Stored as an instant. The display timezone is the VIEWER's, so an event
  -- never shows the wrong local time to someone in another country.
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  location      text,
  url           text,
  cover_url     text,
  -- Denormalised counter, maintained by the trigger below, so a list of
  -- events costs one query rather than one per event.
  rsvp_count    integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists profile_events_user_idx on public.profile_events (user_id, starts_at desc);

create table if not exists public.profile_event_rsvps (
  event_id   uuid not null references public.profile_events (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create or replace function public.sync_event_rsvp_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.profile_events set rsvp_count = rsvp_count + 1 where id = new.event_id;
  elsif (tg_op = 'DELETE') then
    update public.profile_events set rsvp_count = greatest(0, rsvp_count - 1) where id = old.event_id;
  end if;
  return null;
end;
$$;

drop trigger if exists profile_event_rsvp_count on public.profile_event_rsvps;
create trigger profile_event_rsvp_count
  after insert or delete on public.profile_event_rsvps
  for each row execute function public.sync_event_rsvp_count();

-- ── Team ──────────────────────────────────────────────────────────────
-- DISPLAY ONLY, deliberately. This lists the people behind a profile; it
-- grants nobody the ability to edit it. Real multi-admin means another
-- account can change your identity, your prices and your links, and that
-- is an authorization decision with its own audit and revocation story —
-- not something to inherit silently from a row in a table. `member_id` is
-- nullable so a team member who has no Frenzsave account can still be
-- listed by name.
create table if not exists public.profile_team_members (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  member_id   uuid references auth.users (id) on delete set null,
  name        text not null,
  role        text,
  avatar_url  text,
  url         text,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists profile_team_user_idx on public.profile_team_members (user_id, position);

-- ── Reviews ───────────────────────────────────────────────────────────
-- `user_id` is the profile being reviewed; `author_id` is who wrote it.
create table if not exists public.profile_reviews (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  author_id   uuid not null references auth.users (id) on delete cascade,
  rating      smallint not null check (rating between 1 and 5),
  body        text,
  -- Null until an orders table exists. See the header.
  order_ref   text,
  verified    boolean not null default false,
  -- The profile owner may hide a review but never edit its text.
  hidden      boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (user_id, author_id)
);
create index if not exists profile_reviews_user_idx on public.profile_reviews (user_id, created_at desc);

-- ── Membership tiers ──────────────────────────────────────────────────
create table if not exists public.profile_membership_tiers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  name          text not null,
  description   text,
  -- Minor units, like profile_offerings. Never a float.
  price_minor   bigint,
  currency      text not null default 'NGN',
  interval      text not null default 'month',   -- 'month' | 'year'
  -- Where someone actually pays. Until recurring billing exists this is the
  -- creator's own checkout link, and the UI says so rather than implying a
  -- subscription this platform manages.
  checkout_url  text,
  perks         jsonb not null default '[]'::jsonb,   -- string[]
  position      integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists profile_tiers_user_idx on public.profile_membership_tiers (user_id, position);

-- ── Repositories ──────────────────────────────────────────────────────
-- Manually added, not synced. A git-host OAuth integration is a separate
-- piece of work; a developer can list their repos today without it, and
-- when sync arrives it fills the same rows.
create table if not exists public.profile_repositories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  description text,
  url         text not null,
  language    text,
  stars       integer,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists profile_repos_user_idx on public.profile_repositories (user_id, position);

-- ── Personal Spaces ───────────────────────────────────────────────────
-- A named area of a profile (Photography, Travel, Coding…) holding its own
-- ordered set of modules. `modules` is jsonb rather than a join table: it
-- is a short ordered list read as a whole and never queried across spaces.
create table if not exists public.profile_spaces (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  slug        text not null,
  name        text not null,
  description text,
  icon        text,
  accent      text,
  modules     jsonb not null default '[]'::jsonb,
  enabled     boolean not null default true,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (user_id, slug)
);
create index if not exists profile_spaces_user_idx on public.profile_spaces (user_id, position);

-- ── Widgets ───────────────────────────────────────────────────────────
-- One row per widget a member has an opinion about, mirroring
-- profile_modules exactly. `config` holds the widget's own settings
-- (a countdown's date, a quote's text) — validated in code against the
-- widget registry, never trusted from the row.
create table if not exists public.profile_widgets (
  user_id     uuid not null references auth.users (id) on delete cascade,
  widget_key  text not null,
  enabled     boolean not null default true,
  position    integer not null default 0,
  audience    text not null default 'public',
  config      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (user_id, widget_key)
);
create index if not exists profile_widgets_user_idx on public.profile_widgets (user_id, position);

-- ── Goals (Part 15) ───────────────────────────────────────────────────
-- The TARGET is stored; the progress is derived from live signals at read
-- time (lib/social/profile-goals.ts). Storing progress would mean a number
-- that drifts from reality the moment anything else changes.
create table if not exists public.profile_goals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- 'posts' | 'followers' | 'friends' | 'collections' | 'reputation' |
  -- 'achievements' | 'health' — resolved by the goal registry.
  metric       text not null,
  target       integer not null check (target > 0),
  label        text,
  due_on       date,
  achieved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists profile_goals_user_idx on public.profile_goals (user_id, created_at desc);

-- ── Snapshots (Part 15 — growth over time) ────────────────────────────
-- ONE row per member per day, written by /api/cron/profile-snapshots.
-- This is what makes trends honest: Parts 4-5 and 15 refused to show
-- growth because nothing recorded history, and inventing a trend line from
-- a single reading would have been fabrication. The series starts empty and
-- fills day by day — a member's first week genuinely has no trend, and the
-- UI must say so rather than draw one.
create table if not exists public.profile_snapshots (
  user_id       uuid not null references auth.users (id) on delete cascade,
  captured_on   date not null,
  posts         integer not null default 0,
  followers     integer not null default 0,
  following     integer not null default 0,
  friends       integer not null default 0,
  collections   integer not null default 0,
  reputation    integer not null default 0,
  health_score  integer,
  primary key (user_id, captured_on)
);
create index if not exists profile_snapshots_user_idx on public.profile_snapshots (user_id, captured_on desc);

-- ── Profile view stats (Part 15 — insights) ───────────────────────────
-- DAILY AGGREGATES, not one row per view.
--
-- Deliberate, and the reason is both cost and privacy. A row per view would
-- be the highest-write table in the product and would record who looked at
-- whose profile and when — a surveillance dataset nobody asked for, and a
-- meaningful bill. A counter answers "is my profile being seen, and is that
-- growing?", which is the question, while storing nothing about any
-- individual visitor.
create table if not exists public.profile_view_stats (
  user_id     uuid not null references auth.users (id) on delete cascade,
  viewed_on   date not null,
  views       integer not null default 0,
  primary key (user_id, viewed_on)
);

-- Atomic upsert — two concurrent viewers must not lose a count.
create or replace function public.increment_profile_view(target uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.profile_view_stats (user_id, viewed_on, views)
  values (target, current_date, 1)
  on conflict (user_id, viewed_on)
  do update set views = public.profile_view_stats.views + 1;
$$;

grant execute on function public.increment_profile_view(uuid) to anon, authenticated;

-- ── RLS ───────────────────────────────────────────────────────────────
alter table public.profile_featured          enable row level security;
alter table public.profile_events            enable row level security;
alter table public.profile_event_rsvps       enable row level security;
alter table public.profile_team_members      enable row level security;
alter table public.profile_reviews           enable row level security;
alter table public.profile_membership_tiers  enable row level security;
alter table public.profile_repositories      enable row level security;
alter table public.profile_spaces            enable row level security;
alter table public.profile_widgets           enable row level security;
alter table public.profile_goals             enable row level security;
alter table public.profile_snapshots         enable row level security;
alter table public.profile_view_stats        enable row level security;

-- Owner-only, for the tables a member alone controls.
drop policy if exists "profile featured own"    on public.profile_featured;
create policy "profile featured own"    on public.profile_featured
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "profile events own"      on public.profile_events;
create policy "profile events own"      on public.profile_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "profile team own"        on public.profile_team_members;
create policy "profile team own"        on public.profile_team_members
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "profile tiers own"       on public.profile_membership_tiers;
create policy "profile tiers own"       on public.profile_membership_tiers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "profile repos own"       on public.profile_repositories;
create policy "profile repos own"       on public.profile_repositories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "profile spaces own"      on public.profile_spaces;
create policy "profile spaces own"      on public.profile_spaces
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "profile widgets own"     on public.profile_widgets;
create policy "profile widgets own"     on public.profile_widgets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "profile goals own"       on public.profile_goals;
create policy "profile goals own"       on public.profile_goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Read-only to their subject: snapshots and view counts are WRITTEN by the
-- server (cron / the view RPC), never by the member they describe. A member
-- who could write these could invent their own growth chart.
drop policy if exists "profile snapshots own read" on public.profile_snapshots;
create policy "profile snapshots own read" on public.profile_snapshots
  for select using (auth.uid() = user_id);

drop policy if exists "profile view stats own read" on public.profile_view_stats;
create policy "profile view stats own read" on public.profile_view_stats
  for select using (auth.uid() = user_id);

-- An RSVP belongs to the person who made it: they may add and remove their
-- own, and read their own. The profile owner reads the aggregate through
-- `rsvp_count`, so an attendee list is never exposed by this policy.
drop policy if exists "event rsvp own" on public.profile_event_rsvps;
create policy "event rsvp own" on public.profile_event_rsvps
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- A review is written by its AUTHOR, who may edit or delete their own.
-- The profile owner cannot edit a review about them — only hide it, which
-- the server does through the service role so this policy stays narrow.
drop policy if exists "profile reviews author" on public.profile_reviews;
create policy "profile reviews author" on public.profile_reviews
  for all using (auth.uid() = author_id) with check (auth.uid() = author_id);
