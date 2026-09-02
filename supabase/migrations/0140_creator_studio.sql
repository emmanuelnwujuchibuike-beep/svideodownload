-- ============================================================================
-- 0140 — Feature 15 Part 9: Creator Studio™
-- ============================================================================
--
-- The creator-facing half of the data Part 8 built for the viewer. Four
-- changes, each closing a gap the Part 9 audit found had no answer anywhere in
-- the previous 139 migrations:
--
--   1. posts gains a LIFECYCLE — pin, archive, schedule. `posts.status` was
--      published | under_review | removed: there was no way to hide a post
--      from the world while keeping it, no way to say "publish this later",
--      and no way to pin work to the top of a profile.
--   2. creator_studio_prefs — the dashboard a creator arranged for themselves.
--   3. content_plan — calendar entries that are not yet posts.
--   4. post_collaborators — a post has exactly one publisher_id today.
--
-- 🔴 ORDERING: every plain DDL statement comes FIRST and every dollar-quoted
-- `do $$ … $$` block comes LAST. Migration 0130 on this project applied
-- PARTIALLY — plain DDL placed after a dollar-quoted block silently did not
-- run, and nothing reported an error. That rule is why this file is shaped
-- the way it is; do not interleave them.
--
-- Idempotent throughout.

-- ---------------------------------------------------------------------
-- 1 · posts — lifecycle
--
-- Why BOTH timestamps and new status values, rather than timestamps alone:
-- every feed read in this codebase already filters `status = 'published'`
-- (getHomeFeed, getFeed, search, Orbits, the profile grid, both sitemaps). A
-- row moved to 'scheduled' or 'archived' therefore disappears from all of them
-- the instant it is written, with no change to any call site and no risk of a
-- forgotten one leaking an archived post into a feed. The timestamps carry the
-- WHEN; the status carries the VISIBILITY, in the vocabulary the schema had.
-- ---------------------------------------------------------------------
alter table public.posts add column if not exists pinned_at    timestamptz;
alter table public.posts add column if not exists archived_at  timestamptz;
alter table public.posts add column if not exists scheduled_at timestamptz;

comment on column public.posts.pinned_at is
  'When the creator pinned this to their profile. NULL = not pinned. Newest pin sorts first.';
comment on column public.posts.archived_at is
  'When the creator archived this. Paired with status=''archived'' — visible to its creator only, restorable.';
comment on column public.posts.scheduled_at is
  'Publish at or after this instant. Paired with status=''scheduled''. NULL with status=''scheduled'' means a dateless draft.';

-- Extend the status vocabulary. Dropping and re-adding is the only way to widen
-- a CHECK; both halves are guarded so a re-run is a no-op.
alter table public.posts drop constraint if exists posts_status_chk;
alter table public.posts add constraint posts_status_chk
  check (status in ('published', 'under_review', 'removed', 'scheduled', 'archived'));

-- The scheduled-publish sweep reads exactly this: due rows, oldest first. The
-- partial predicate keeps the index to the handful of rows actually waiting,
-- not the whole posts table.
create index if not exists posts_scheduled_due_idx
  on public.posts (scheduled_at)
  where status = 'scheduled' and scheduled_at is not null;

-- A profile grid asks for "this creator's pins, newest first".
create index if not exists posts_publisher_pinned_idx
  on public.posts (publisher_id, pinned_at desc)
  where pinned_at is not null;

-- The Studio content manager pages a creator's own work across every status,
-- which the existing posts_publisher_idx (status-agnostic) already serves —
-- no third index for it.

-- ---------------------------------------------------------------------
-- 2 · creator_studio_prefs — the dashboard the creator arranged
--
-- One self-owned row, the same posture as user_home_preferences (0040): the
-- owner reads and writes their own row and nobody else's, and a member who has
-- never opened the customiser simply has no row (the code supplies defaults
-- rather than the database pre-seeding 100% of members).
-- ---------------------------------------------------------------------
create table if not exists public.creator_studio_prefs (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  -- Ordered widget ids. Unknown ids are ignored on read and dropped on write,
  -- so removing a widget from the catalogue can never strand a saved layout.
  widget_order   text[] not null default '{}',
  hidden_widgets text[] not null default '{}',
  -- Up to four metric ids surfaced in the header strip.
  pinned_metrics text[] not null default '{}',
  accent         text   not null default 'default',
  -- Posts the creator wants to publish per week. 0 = no goal set, which is a
  -- different thing from a goal of zero and is rendered differently.
  weekly_goal    int    not null default 0,
  updated_at     timestamptz not null default now(),
  constraint creator_studio_prefs_goal_chk check (weekly_goal >= 0 and weekly_goal <= 100)
);

-- ---------------------------------------------------------------------
-- 3 · content_plan — the calendar's non-post rows
--
-- Deliberately NOT a post. A plan has no media, no source URL, no publisher
-- semantics and must never be reachable by a feed query; putting it in `posts`
-- would place non-content rows behind every read in the product and rely on
-- every one of them filtering it back out.
-- ---------------------------------------------------------------------
create table if not exists public.content_plan (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  note        text,
  kind        text not null default 'idea',
  planned_for date not null,
  status      text not null default 'planned',
  created_at  timestamptz not null default now(),
  constraint content_plan_kind_chk   check (kind in ('idea', 'campaign', 'event', 'launch', 'collab', 'seasonal')),
  constraint content_plan_status_chk check (status in ('planned', 'done', 'cancelled')),
  constraint content_plan_title_chk  check (char_length(title) between 1 and 200)
);
create index if not exists content_plan_user_date_idx on public.content_plan (user_id, planned_for);

-- ---------------------------------------------------------------------
-- 4 · post_collaborators — permission-based co-creation
--
-- An invite is `pending` until the invitee accepts it. Only an `accepted`
-- collaborator is credited on the post or may open its analytics, and that is
-- enforced in the read path server-side, not by hiding a button.
--
-- No revenue split column, and its absence is deliberate: this platform has no
-- payout rails (lib/platform/commerce-platform.ts lists the Creator Payout
-- Service as planned), so a percentage stored here would settle nothing and
-- would read as a promise the product cannot keep.
-- ---------------------------------------------------------------------
create table if not exists public.post_collaborators (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  invited_by uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'collaborator',
  status     text not null default 'pending',
  created_at timestamptz not null default now(),
  primary key (post_id, user_id),
  constraint post_collaborators_role_chk   check (role in ('collaborator', 'co_author')),
  constraint post_collaborators_status_chk check (status in ('pending', 'accepted', 'declined'))
);
create index if not exists post_collaborators_user_idx
  on public.post_collaborators (user_id, status, created_at desc);

alter table public.creator_studio_prefs enable row level security;
alter table public.content_plan         enable row level security;
alter table public.post_collaborators   enable row level security;

-- ---------------------------------------------------------------------
-- 🔴 DOLLAR-QUOTED BLOCKS ONLY BELOW THIS LINE. Nothing plain may follow.
-- ---------------------------------------------------------------------

do $$ begin
  create policy creator_studio_prefs_self_all on public.creator_studio_prefs
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy content_plan_self_all on public.content_plan
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- A collaborator row is readable by the invitee and by the post's publisher.
-- Writes go through the service role (POST /api/studio/collab), which is why
-- there is no insert/update policy here: the invite path has to check post
-- ownership and block state, and neither is expressible in a row policy.
do $$ begin
  create policy post_collaborators_visible on public.post_collaborators
    for select using (
      auth.uid() = user_id
      or auth.uid() = invited_by
      or exists (
        select 1 from public.posts p
        where p.id = post_collaborators.post_id and p.publisher_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;
