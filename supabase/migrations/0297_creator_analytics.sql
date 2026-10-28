-- ═══════════════════════════════════════════════════════════════════════════
--  0297 — Creator analytics: the missing signals, and the aggregates the new dashboard reads (2026-10-27)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The rebuilt Creator analytics (design/creator-analytics.html) shows only measured numbers. This adds what was not
-- measured, from the day it ships (nothing is back-filled or estimated), and the aggregates, computed here so a year
-- of rows is never shipped to the app.
--
-- ── New signals ─────────────────────────────────────────────────────────────
--   post_views.country / .city      the viewer's country (ISO 3166 alpha-2) and city, from the hosting platform's
--                                    request geolocation at the moment of the view. Never an IP, never coordinates.
--   post_download_events            one row per counted download of a post (the counter alone has no date)
--   follow_events                   unfollows, written by a trigger when a follow row is deleted (a deleted row
--                                    otherwise leaves no trace). Follows themselves are already dated in follows.
--   sub_preview_events              an exclusive post's locked preview SEEN, and SUBSCRIBE tapped on it — once per
--                                    viewer, post, kind and day (the funnel's first two steps)
--
-- ── Aggregates (service role only, every one scoped to p_creator) ──────────
--   creator_daily_metrics      per local day: views, unique viewers, likes, saves, comments, shares, reposts, new
--                              followers, unfollows, downloads, gifts received and their FGC share
--   creator_view_sources       views by discovery surface
--   creator_heatmap            views by local weekday x 4-hour block
--   creator_locations          views by country or city (rows with no location are not counted)
--   creator_top_engaging       posts by interactions in the window per view in the window
--   creator_unique_viewers     distinct viewers in the window, signed-in ones, and how many of them follow
--   creator_post_curve         one post's views by day since publishing, and the creator's average curve
--   creator_feature_usage      the creator's audience in a month and how many of them used each feature
--
-- "Audience" (Feature of the month): every signed-in member who followed the creator by the end of the month, or
-- viewed one of the creator's posts in it. A feature is "used" by a member who did its own action in that month,
-- read from the feature's own table — nothing is inferred. A local day uses the creator's time zone (p_tz, checked
-- against pg_timezone_names, UTC when unknown).
--
-- Depends on 0006, 0007, 0008, 0011, 0015, 0025, 0105, 0121, 0133, 0141, 0181, 0227, 0293. Safe to run twice.
-- No semicolon inside any quoted string or comment. Every dollar-quoted block is at the end.

alter table public.post_views add column if not exists country text;
alter table public.post_views add column if not exists city text;
alter table public.post_views drop constraint if exists post_views_country_chk;
alter table public.post_views add constraint post_views_country_chk check (country is null or country ~ '^[A-Z]{2}$');
alter table public.post_views drop constraint if exists post_views_city_chk;
alter table public.post_views add constraint post_views_city_chk check (city is null or char_length(city) between 1 and 80);
create index if not exists post_views_post_created_idx on public.post_views (post_id, created_at);

create table if not exists public.post_download_events (
  id          bigint generated always as identity primary key,
  post_id     uuid not null references public.posts (id) on delete cascade,
  creator_id  uuid not null references auth.users (id) on delete cascade,
  user_id     uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists post_download_events_creator_idx on public.post_download_events (creator_id, created_at);
create index if not exists post_download_events_post_idx on public.post_download_events (post_id, created_at);
alter table public.post_download_events enable row level security;
revoke all on public.post_download_events from public, anon, authenticated;
grant all on public.post_download_events to service_role;
comment on table public.post_download_events is '0297: one row per counted download of a post (the dated twin of posts.downloads_count). Server only.';

create table if not exists public.follow_events (
  id           bigint generated always as identity primary key,
  follower_id  uuid not null references auth.users (id) on delete cascade,
  following_id uuid not null references auth.users (id) on delete cascade,
  kind         text not null default 'unfollow',
  created_at   timestamptz not null default now(),
  constraint follow_events_kind_chk check (kind in ('unfollow'))
);
create index if not exists follow_events_following_idx on public.follow_events (following_id, created_at);
alter table public.follow_events enable row level security;
revoke all on public.follow_events from public, anon, authenticated;
grant all on public.follow_events to service_role;
comment on table public.follow_events is '0297: unfollows (a deleted follows row leaves no other trace), written by a trigger. Server only.';

create table if not exists public.sub_preview_events (
  post_id     uuid not null references public.sub_posts (id) on delete cascade,
  creator_id  uuid not null references auth.users (id) on delete cascade,
  viewer_id   uuid not null references auth.users (id) on delete cascade,
  kind        text not null,
  day         date not null default ((now() at time zone 'utc')::date),
  created_at  timestamptz not null default now(),
  primary key (post_id, viewer_id, kind, day),
  constraint sub_preview_events_kind_chk check (kind in ('preview_seen', 'subscribe_tapped'))
);
create index if not exists sub_preview_events_creator_idx on public.sub_preview_events (creator_id, day);
alter table public.sub_preview_events enable row level security;
revoke all on public.sub_preview_events from public, anon, authenticated;
grant all on public.sub_preview_events to service_role;
comment on table public.sub_preview_events is '0297: an exclusive post locked preview seen, and Subscribe tapped on it - once per viewer, post, kind and day. Server only.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.follow_events_on_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.follow_events (follower_id, following_id, kind) values (old.follower_id, old.following_id, 'unfollow');
  return old;
end;
$$;

-- The creator's time zone, or UTC when it is not a real one.
create or replace function public.analytics_tz(p_tz text) returns text
language sql stable as $$
  select coalesce((select name from pg_timezone_names where name = p_tz limit 1), 'UTC')
$$;

create or replace function public.creator_daily_metrics(p_creator uuid, p_since timestamptz, p_tz text default 'UTC') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text := public.analytics_tz(p_tz);
begin
  return coalesce((
    with posts_of as (select id from public.posts where publisher_id = p_creator),
    days as (
      select generate_series(date_trunc('day', p_since at time zone v_tz), date_trunc('day', now() at time zone v_tz), interval '1 day')::date as d
    ),
    v as (select (created_at at time zone v_tz)::date d, count(*) n, count(distinct coalesce(viewer_id::text, ip_hash)) u
            from public.post_views where post_id in (select id from posts_of) and created_at >= p_since group by 1),
    r as (select (created_at at time zone v_tz)::date d, count(*) filter (where type = 'like') likes, count(*) filter (where type = 'save') saves
            from public.post_reactions where post_id in (select id from posts_of) and created_at >= p_since group by 1),
    c as (select (created_at at time zone v_tz)::date d, count(*) n from public.post_comments where post_id in (select id from posts_of) and created_at >= p_since group by 1),
    s as (select (created_at at time zone v_tz)::date d, count(*) n from public.share_events where creator_id = p_creator and created_at >= p_since group by 1),
    rp as (select (created_at at time zone v_tz)::date d, count(*) n from public.reposts where post_id in (select id from posts_of) and created_at >= p_since group by 1),
    f as (select (created_at at time zone v_tz)::date d, count(*) n from public.follows where following_id = p_creator and created_at >= p_since group by 1),
    uf as (select (created_at at time zone v_tz)::date d, count(*) n from public.follow_events where following_id = p_creator and created_at >= p_since group by 1),
    dl as (select (created_at at time zone v_tz)::date d, count(*) n from public.post_download_events where creator_id = p_creator and created_at >= p_since group by 1),
    g as (select (created_at at time zone v_tz)::date d, count(*) n, sum(recipient_share) fgc
            from public.gift_sends where recipient_id = p_creator and status <> 'reversed' and created_at >= p_since group by 1)
    select jsonb_agg(jsonb_build_object(
             'day', days.d, 'views', coalesce(v.n, 0), 'unique', coalesce(v.u, 0), 'likes', coalesce(r.likes, 0), 'saves', coalesce(r.saves, 0),
             'comments', coalesce(c.n, 0), 'shares', coalesce(s.n, 0), 'reposts', coalesce(rp.n, 0), 'follows', coalesce(f.n, 0),
             'unfollows', coalesce(uf.n, 0), 'downloads', coalesce(dl.n, 0), 'gifts', coalesce(g.n, 0), 'gift_fgc', coalesce(g.fgc, 0)) order by days.d)
      from days left join v using (d) left join r using (d) left join c using (d) left join s using (d) left join rp using (d)
      left join f using (d) left join uf using (d) left join dl using (d) left join g using (d)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.creator_view_sources(p_creator uuid, p_since timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('source', src, 'count', n) order by n desc), '[]'::jsonb)
    from (select coalesce(nullif(source, ''), 'untagged') src, count(*) n from public.post_views
           where post_id in (select id from public.posts where publisher_id = p_creator) and created_at >= p_since group by 1) x
$$;

-- Weekday 0 = Monday. Block 0 = 00:00-04:00, 1 = 04:00-08:00 ... 5 = 20:00-24:00, in the creator's time zone.
create or replace function public.creator_heatmap(p_creator uuid, p_since timestamptz, p_tz text default 'UTC') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text := public.analytics_tz(p_tz);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('dow', dow, 'block', blk, 'count', n))
    from (select (extract(isodow from created_at at time zone v_tz)::int - 1) dow, (extract(hour from created_at at time zone v_tz)::int / 4) blk, count(*) n
            from public.post_views where post_id in (select id from public.posts where publisher_id = p_creator) and created_at >= p_since group by 1, 2) x), '[]'::jsonb);
end;
$$;

create or replace function public.creator_locations(p_creator uuid, p_since timestamptz, p_kind text default 'country') returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', n) order by n desc), '[]'::jsonb)
    from (select case when p_kind = 'city' then city else country end name, count(*) n from public.post_views
           where post_id in (select id from public.posts where publisher_id = p_creator) and created_at >= p_since
             and (case when p_kind = 'city' then city else country end) is not null
           group by 1 order by 2 desc limit 10) x
$$;

create or replace function public.creator_top_engaging(p_creator uuid, p_since timestamptz, p_limit integer default 5) returns jsonb
language sql stable security definer set search_path = public as $$
  with p as (select id, title, thumbnail_url from public.posts where publisher_id = p_creator and status <> 'removed'),
  v as (select post_id, count(*) n from public.post_views where post_id in (select id from p) and created_at >= p_since group by 1),
  i as (select post_id, count(*) n from (
          select post_id from public.post_reactions where post_id in (select id from p) and created_at >= p_since
          union all select post_id from public.post_comments where post_id in (select id from p) and created_at >= p_since
          union all select post_id from public.share_events where creator_id = p_creator and post_id in (select id from p) and created_at >= p_since
          union all select post_id from public.reposts where post_id in (select id from p) and created_at >= p_since) z group by 1)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'thumbnail_url', thumbnail_url, 'views', views, 'interactions', inter) order by inter desc, views desc), '[]'::jsonb)
    from (select p.id, p.title, p.thumbnail_url, coalesce(v.n, 0) views, coalesce(i.n, 0) inter from p join v on v.post_id = p.id left join i on i.post_id = p.id
           where coalesce(i.n, 0) > 0 order by coalesce(i.n, 0)::numeric / greatest(v.n, 1) desc, v.n desc limit greatest(1, least(p_limit, 20))) x
$$;

-- One post: views per day since publishing (day 0 = the publishing day, up to 30 days), the creator's average per
-- day-since-publishing over their other posts, and the post's download funnel.
create or replace function public.creator_post_curve(p_creator uuid, p_post uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_post public.posts%rowtype;
begin
  select * into v_post from public.posts where id = p_post and publisher_id = p_creator;
  if v_post.id is null then return null; end if;
  return jsonb_build_object(
    'post', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'views', n) order by d), '[]'::jsonb)
               from (select (created_at::date - v_post.created_at::date) d, count(*) n from public.post_views
                      where post_id = p_post and created_at < v_post.created_at + interval '31 days' group by 1) x),
    'average', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'views', round(n::numeric / greatest(posts, 1), 2)) order by d), '[]'::jsonb)
                  from (select (v.created_at::date - p.created_at::date) d, count(*) n, (select count(*) from public.posts where publisher_id = p_creator and id <> p_post and status <> 'removed') posts
                          from public.post_views v join public.posts p on p.id = v.post_id
                         where p.publisher_id = p_creator and p.id <> p_post and p.status <> 'removed' and v.created_at < p.created_at + interval '31 days' group by 1) x),
    'opened', (select count(*) from public.post_views where post_id = p_post and source = 'post_page'),
    'downloads_dated', (select count(*) from public.post_download_events where post_id = p_post),
    'avg_watch_ms', (select round(avg(watch_ms)) from public.post_watch_events where post_id = p_post and watch_ms > 0),
    'creator_avg_views', (select round(avg(views_count), 2) from public.posts where publisher_id = p_creator and status <> 'removed'),
    'rank', (select count(*) + 1 from public.posts where publisher_id = p_creator and status <> 'removed' and views_count > v_post.views_count)
  );
end;
$$;

-- Distinct viewers across the whole window (a daily sum would count one person once per day), how many of them were
-- signed in, and how many of those follow the creator now.
create or replace function public.creator_unique_viewers(p_creator uuid, p_since timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  with v as (select distinct viewer_id, coalesce(viewer_id::text, ip_hash) who from public.post_views
              where post_id in (select id from public.posts where publisher_id = p_creator) and created_at >= p_since)
  select jsonb_build_object(
    'unique', (select count(distinct who) from v),
    'signed_in', (select count(distinct viewer_id) from v where viewer_id is not null),
    'following', (select count(distinct v.viewer_id) from v join public.follows f on f.follower_id = v.viewer_id and f.following_id = p_creator))
$$;

create or replace function public.creator_feature_usage(p_creator uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_aud uuid[];
begin
  select coalesce(array_agg(distinct u), '{}') into v_aud from (
    select follower_id u from public.follows where following_id = p_creator and created_at < p_to
    union
    select viewer_id from public.post_views where viewer_id is not null and created_at >= p_from and created_at < p_to
       and post_id in (select id from public.posts where publisher_id = p_creator)
  ) a where u <> p_creator;
  return jsonb_build_object(
    'audience', coalesce(array_length(v_aud, 1), 0),
    'features', jsonb_build_object(
      'sticker_gifts', (select count(distinct sender_id) from public.gift_sends where sender_id = any(v_aud) and created_at >= p_from and created_at < p_to),
      'exclusive', (select count(distinct subscriber_id) from public.sub_purchases where subscriber_id = any(v_aud) and status = 'paid' and created_at >= p_from and created_at < p_to),
      'ai_creation', (select count(distinct user_id) from public.ai_jobs where user_id = any(v_aud) and created_at >= p_from and created_at < p_to),
      'sharing', (select count(distinct sharer_id) from public.share_events where sharer_id = any(v_aud) and created_at >= p_from and created_at < p_to),
      'reposts', (select count(distinct user_id) from public.reposts where user_id = any(v_aud) and created_at >= p_from and created_at < p_to),
      'comments', (select count(distinct author_id) from public.post_comments where author_id = any(v_aud) and created_at >= p_from and created_at < p_to),
      'stories', (select count(distinct viewer_id) from public.story_views where viewer_id = any(v_aud) and viewed_at >= p_from and viewed_at < p_to),
      'wallpapers', (select count(distinct user_id) from public.wallpaper_saves where user_id = any(v_aud) and created_at >= p_from and created_at < p_to),
      'downloader', (select count(distinct user_id) from public.downloads where user_id = any(v_aud) and created_at >= p_from and created_at < p_to),
      'chat', (select count(distinct sender_id) from public.messages where sender_id = any(v_aud) and created_at >= p_from and created_at < p_to)
    ));
end;
$$;

do $$
declare
  f text;
begin
  execute 'drop trigger if exists follows_unfollow_log on public.follows';
  execute 'create trigger follows_unfollow_log after delete on public.follows for each row execute function public.follow_events_on_delete()';
  foreach f in array array[
    'creator_daily_metrics(uuid, timestamptz, text)', 'creator_view_sources(uuid, timestamptz)', 'creator_heatmap(uuid, timestamptz, text)',
    'creator_locations(uuid, timestamptz, text)', 'creator_top_engaging(uuid, timestamptz, integer)', 'creator_post_curve(uuid, uuid)', 'creator_unique_viewers(uuid, timestamptz)',
    'creator_feature_usage(uuid, timestamptz, timestamptz)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to service_role';
  end loop;
end
$$;
