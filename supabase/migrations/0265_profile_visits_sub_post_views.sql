-- 0265 — Profile visits and exclusive-post views, for Earnings & analytics (step 21, design/Earnings.dc.html;
-- owner 2026-10-19: "Show real data everywhere a design file shows a placeholder", "build any backend attached
-- that needs it for completion").
--
--   profile_visits    one row per (profile, visitor, UTC day): a signed-in visitor by id, a guest by a daily
--                     one-way hash of their network and browser (lib/sub/visits.ts) — never an IP, never kept
--                     raw. The owner's own visits are not recorded. "Profile visits" = rows in the period.
--   sub_post_views    one row per (exclusive post, viewer, UTC day), written when a viewer with access opens
--                     the post (app/api/sub/posts/[id]). The creator's own opens are not recorded. Ranks
--                     "Top exclusive posts".
--
-- Both are written and read ONLY by the server with the service role: RLS on, no policies, so the browser can
-- neither read nor write them. Deduplicated by their primary keys (an insert that repeats does nothing).
--
-- Additive and idempotent. No semicolon inside any quoted string. No dollar-quoted block.

create table if not exists public.profile_visits (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  visitor_key text not null check (char_length(visitor_key) between 8 and 80),
  day         date not null default ((now() at time zone 'utc')::date),
  primary key (profile_id, visitor_key, day)
);
create index if not exists profile_visits_profile_day_idx on public.profile_visits (profile_id, day);
alter table public.profile_visits enable row level security;
revoke all on public.profile_visits from anon, authenticated;

create table if not exists public.sub_post_views (
  post_id    uuid not null references public.sub_posts (id) on delete cascade,
  creator_id uuid not null references public.profiles (id) on delete cascade,
  viewer_id  uuid not null references public.profiles (id) on delete cascade,
  day        date not null default ((now() at time zone 'utc')::date),
  primary key (post_id, viewer_id, day)
);
create index if not exists sub_post_views_creator_day_idx on public.sub_post_views (creator_id, day);
alter table public.sub_post_views enable row level security;
revoke all on public.sub_post_views from anon, authenticated;
