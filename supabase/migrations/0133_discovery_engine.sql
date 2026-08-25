-- =====================================================================
-- FrenzSave — Feature 15 Part 8: Discovery Engine, Personalization,
-- Social Recommendations & Content Intelligence
--
-- Closes the one real gap the Part 8 audit found: no watch-time/completion
-- signal existed anywhere (only deduped view COUNTS via post_views). Everything
-- else this part needs (relationship/quality/freshness ranking, hot_score
-- trending, muted/boosted categories, muted_creators) already existed and is
-- extended, not rebuilt. Idempotent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- post_watch_events — how much of a post a viewer actually watched.
-- Mirrors post_views' identity/dedup shape (viewer_id OR ip_hash), but is NOT
-- deduped — a rewatch is a real, separate signal (a completed rewatch is
-- stronger evidence of quality than one partial view), unlike a view count
-- which exists to resist inflation. `source` records which discovery surface
-- served the post (for_you / following / trending / an Orbit id / a
-- collection id) — the real, honest input for creator Traffic Sources.
-- ---------------------------------------------------------------------
create table if not exists public.post_watch_events (
  id          uuid primary key default uuid_generate_v4(),
  post_id     uuid not null references public.posts (id) on delete cascade,
  viewer_id   uuid references auth.users (id) on delete set null,
  ip_hash     text not null default '',
  watch_ms    int not null default 0,
  duration_ms int not null default 0,
  source      text,
  created_at  timestamptz not null default now(),
  constraint post_watch_events_ms_chk check (watch_ms >= 0 and duration_ms >= 0)
);
create index if not exists post_watch_events_post_idx on public.post_watch_events (post_id, created_at desc);
create index if not exists post_watch_events_viewer_idx on public.post_watch_events (viewer_id, created_at desc) where viewer_id is not null;
-- Prunable by age (14-day rolling window is all recompute_momentum_scores reads) —
-- no retention job added here since nothing in this app runs scheduled DELETEs
-- yet; the index above keeps a full table scan out of the read path either way.

alter table public.post_watch_events enable row level security;
-- Writes/reads via the service role only (no client policies) — identical
-- posture to post_views (migration 0007): the client never inserts a row
-- directly, it POSTs to /api/watch, which uses the admin client server-side.

-- ---------------------------------------------------------------------
-- posts — momentum + completion (materialized, same posture as hot_score)
-- ---------------------------------------------------------------------
alter table public.posts add column if not exists momentum_score  double precision not null default 0;
alter table public.posts add column if not exists completion_rate double precision not null default 0;
create index if not exists posts_public_momentum_idx
  on public.posts (momentum_score desc) where status = 'published' and visibility = 'public';

-- post_views gains an optional surface tag — same field, same purpose as
-- post_watch_events.source, added here too so a single-page view (the
-- /p/[id] route, which records via post_views not post_watch_events) can
-- still be attributed in Discovery Analytics.
alter table public.post_views add column if not exists source text;

-- ---------------------------------------------------------------------
-- recompute_momentum_scores — RISING content, not just big content.
--
-- Deliberately a DIFFERENT shape from recompute_hot_scores: hot_score rewards
-- lifetime engagement discounted by age (so an old, heavily-liked post can
-- still rank), which is exactly right for "Trending" but wrong for a
-- Momentum Engine, whose whole point is surfacing a post/creator BEFORE they
-- are widely popular. Velocity here is engagement-per-hour-since-posting
-- (no engagement-history table exists to measure a true recent delta, so
-- "still young and already earning engagement" is the honest, available
-- proxy for rising). completion_rate comes from post_watch_events — genuine
-- watch depth, not just a view count — and is the one signal here that
-- can't be inflated by a single tap.
-- ---------------------------------------------------------------------
create or replace function public.recompute_momentum_scores(
  w_completion double precision,
  w_velocity   double precision,
  w_repost     double precision,
  gravity      double precision,
  max_age_hours int
) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.posts p set
    completion_rate = coalesce(w.completion, 0),
    momentum_score =
      w_velocity * (
        (p.likes_count + 2 * p.comments_count + 3 * p.shares_count + 2 * p.saves_count)::double precision
        / power(extract(epoch from (now() - p.created_at)) / 3600.0 + 2.0, gravity)
      )
      + w_completion * coalesce(w.completion, 0) * 20
      + w_repost * p.shares_count
  from (
    select id, created_at from public.posts
    where status = 'published' and created_at > now() - make_interval(hours => max_age_hours)
  ) target
  left join (
    select post_id,
           avg(case when duration_ms > 0 then least(1.0, watch_ms::double precision / duration_ms) else 0 end) as completion
    from public.post_watch_events
    where created_at > now() - interval '14 days'
    group by post_id
  ) w on w.post_id = target.id
  where p.id = target.id;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- user_interest_profile — FrenzDNA™. A private, per-category weight derived
-- from the viewer's OWN real engagement (likes/saves/shares/watch depth on
-- posts of that category) — never from what OTHER people like, never
-- inferred demographics, nothing bought or fabricated. RLS restricts reads
-- to the owner; there is no client-facing write policy at all, because it is
-- only ever written by the admin-client compute in lib/social/frenz-dna.ts,
-- the same "self-owned data, service-role writes" posture as post_views'
-- counters.
-- ---------------------------------------------------------------------
create table if not exists public.user_interest_profile (
  user_id    uuid not null references auth.users (id) on delete cascade,
  category   text not null,
  weight     double precision not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, category)
);

alter table public.user_interest_profile enable row level security;
do $$ begin
  create policy user_interest_profile_self_select on public.user_interest_profile
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- user_home_preferences — Discovery Controls additions (Feature 15 Part 8).
-- Same self-owned row this table already was (migration 0040) — three new
-- columns, no new table, so every existing read/write path (getHomePreferences,
-- rankForYou, /api/home-preferences) gains them for free.
-- ---------------------------------------------------------------------
alter table public.user_home_preferences add column if not exists personalization_paused boolean not null default false;
alter table public.user_home_preferences add column if not exists sensitive_content       boolean not null default false;
alter table public.user_home_preferences add column if not exists preferred_languages     text[]  not null default '{}';
