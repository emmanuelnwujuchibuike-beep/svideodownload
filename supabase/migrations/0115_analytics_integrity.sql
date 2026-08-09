-- 0115 — Analytics integrity + exact aggregates (owner audit, 2026-08-09).
--
-- The Phase-1 pipeline (0103) got the hard part right: `event_id` is the primary
-- key, so a replayed batch is idempotent. This migration fixes the three things
-- it did NOT protect, each of which was silently corrupting a headline number.
--
-- 1. OUT-OF-ORDER DOWNLOAD EVENTS REGRESSED THE STATUS.
--    `analytics_downloads` is upserted on `download_id` with a plain
--    `on conflict do update`, so the LAST WRITE won — not the latest event.
--    The client batches on a 3s debounce and re-queues a failed batch to the
--    FRONT for the next flush (lib/analytics/client.ts `queue.unshift`), so a
--    batch that fails once is delivered AFTER the batch behind it. A completed
--    download whose earlier `requested` event was retried therefore reverted to
--    status 'requested', and its `file_size` was overwritten with NULL.
--    Both "Downloads completed" and "Success rate" undercount as a result, and
--    the error is biased towards flaky connections — the users most worth
--    measuring.
--
--    Fixed by ordering on the EVENT's own clock (`last_event_at`) rather than on
--    arrival, and by never letting a NULL erase a known value. Ordering on event
--    time rather than a status rank is what keeps a manual retry working: a
--    retry genuinely is a later event, so it is allowed to move a failed
--    download back into flight, while a stale replay never is.
--
-- 2. BOTS AND CRAWLERS COUNTED AS PEOPLE.
--    Nothing in the pipeline looked at the user agent. Headless crawlers,
--    uptime monitors and preview fetchers that execute JS were counted as
--    visitors, sessions and page views. Marked (not dropped) so the filtering is
--    auditable and reversible — a dropped row cannot be re-examined.
--
-- 3. EVERY DISTINCT-COUNT WAS A 20k SAMPLE.
--    `getAnalyticsSummary` pulled up to SAMPLE_CAP rows and counted distinct
--    visitors in JS. Past 20k events in a range, "Unique visitors" silently
--    stopped growing — it converged on the number of distinct visitors within
--    the most recent 20k events, which is an undercount that LOOKS like a
--    plateau. The RPCs below compute the real aggregates in Postgres.
--
-- Security: these are `security definer` so they can read a table whose RLS
-- denies everyone, and `search_path` is pinned so a caller cannot shadow the
-- referenced objects. EXECUTE is revoked from anon/authenticated — only the
-- service role (the admin dashboard's server-side reads) may call them.

/* ─────────────────────────── 1. event-time ordering ─────────────────────── */

alter table public.analytics_downloads
  add column if not exists last_event_at timestamptz;

-- Backfill so existing rows participate in the ordering rule immediately.
update public.analytics_downloads
   set last_event_at = coalesce(last_event_at, updated_at, created_at)
 where last_event_at is null;

create or replace function public.analytics_downloads_apply_latest()
returns trigger
language plpgsql
as $$
begin
  /*
    Ignore an event older than the one this row already reflects.

    `is not distinct from` guards the NULL case: a row written before this
    migration may have no stored clock, in which case the incoming event wins
    rather than being dropped.
  */
  if OLD.last_event_at is not null
     and NEW.last_event_at is not null
     and NEW.last_event_at <= OLD.last_event_at then
    return OLD;
  end if;

  /*
    A later event never ERASES a known value. Only `completed` carries a file
    size and a duration; a `failed` or `cancelled` arriving afterwards (a manual
    retry that then fails, say) would otherwise null them out. Same for the
    descriptive columns, which only the first event reliably carries.
  */
  NEW.file_size    := coalesce(NEW.file_size,    OLD.file_size);
  NEW.duration_ms  := coalesce(NEW.duration_ms,  OLD.duration_ms);
  NEW.platform     := coalesce(NEW.platform,     OLD.platform);
  NEW.media_kind   := coalesce(NEW.media_kind,   OLD.media_kind);
  NEW.quality      := coalesce(NEW.quality,      OLD.quality);
  NEW.country      := coalesce(NEW.country,      OLD.country);
  NEW.device       := coalesce(NEW.device,       OLD.device);
  NEW.user_id      := coalesce(NEW.user_id,      OLD.user_id);
  NEW.retry_of     := coalesce(NEW.retry_of,     OLD.retry_of);
  -- An error reason belongs to a failure. Clear it when the download is no
  -- longer failed, keep the newest one when it is.
  if NEW.status = 'failed' then
    NEW.error_reason := coalesce(NEW.error_reason, OLD.error_reason);
  end if;
  -- created_at is the moment the download was FIRST seen, always.
  NEW.created_at := least(coalesce(OLD.created_at, NEW.created_at), coalesce(NEW.created_at, OLD.created_at));
  return NEW;
end;
$$;

drop trigger if exists analytics_downloads_latest_wins on public.analytics_downloads;
create trigger analytics_downloads_latest_wins
  before update on public.analytics_downloads
  for each row execute function public.analytics_downloads_apply_latest();

/* ──────────────────────────────── 2. bot marking ────────────────────────── */

alter table public.analytics_events
  add column if not exists is_bot boolean not null default false;

-- Every aggregate filters on this, so it leads the index.
create index if not exists analytics_events_human_time_idx
  on public.analytics_events (received_at desc) where is_bot = false;
create index if not exists analytics_events_human_type_idx
  on public.analytics_events (event_type, received_at desc) where is_bot = false;
create index if not exists analytics_events_human_visitor_idx
  on public.analytics_events (visitor_id, received_at desc) where is_bot = false;

alter table public.analytics_downloads
  add column if not exists is_bot boolean not null default false;
create index if not exists analytics_downloads_human_idx
  on public.analytics_downloads (status, created_at desc) where is_bot = false;

/* ───────────────────────────── 3. exact aggregates ──────────────────────── */

/**
 * Traffic totals for a window — every one an exact aggregate, not a sample.
 *
 * `bounced_sessions` uses the standard definition: a session with exactly one
 * page view. `engaged_seconds` is the summed dwell reported by `page_exit`
 * events (see lib/analytics/client.ts) — real measured time on page, never the
 * "last event minus first event" estimate, which counts a session's final page
 * as zero seconds and so always reads low.
 */
create or replace function public.analytics_traffic_totals(
  p_since timestamptz,
  p_live_since timestamptz,
  -- Upper bound, exclusive. NULL means "up to now" (the current window); the
  -- dashboard passes a real value to measure the PRECEDING window of equal
  -- length, which is what every trend arrow is computed against.
  p_until timestamptz default null
)
returns table (
  total_events     bigint,
  page_views       bigint,
  unique_visitors  bigint,
  sessions         bigint,
  live_visitors    bigint,
  bounced_sessions bigint,
  dwell_samples    bigint,
  dwell_seconds    numeric,
  rewards_watched  bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with human as (
    select * from public.analytics_events
     where received_at >= p_since
       and is_bot = false
       and (p_until is null or received_at < p_until)
  ),
  per_session as (
    select session_id, count(*) filter (where event_type = 'page_view') as views
      from human group by session_id
  )
  select
    (select count(*) from human),
    (select count(*) from human where event_type = 'page_view'),
    (select count(distinct visitor_id) from human),
    -- DISTINCT session ids, not a count of `session_start` events. Two tabs
    -- opening at once can both decide a session has expired and each emit a
    -- start; counting the ids makes that race harmless.
    (select count(distinct session_id) from human),
    (select count(distinct visitor_id) from human where received_at >= p_live_since),
    (select count(*) from per_session where views = 1),
    (select count(*) from human where event_type = 'page_exit'
       and (properties ->> 'dwellMs') ~ '^[0-9]+$'),
    (select coalesce(sum(least((properties ->> 'dwellMs')::numeric, 1800000)) / 1000.0, 0)
       from human where event_type = 'page_exit'
       and (properties ->> 'dwellMs') ~ '^[0-9]+$'),
    -- Rewarded ads actually watched to the point of claiming the unlock.
    (select count(*) from human where event_type = 'reward_completed');
$$;

/**
 * A grouped tally over one dimension — exact, top-N, computed in Postgres.
 *
 * The dimension is validated against a whitelist rather than interpolated, so
 * this cannot become an injection point even though it takes a column name.
 */
create or replace function public.analytics_breakdown(
  p_since timestamptz,
  p_dimension text,
  p_limit integer default 8
)
returns table (key text, count bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_dimension not in ('device', 'browser', 'os', 'country', 'region', 'path', 'referrer') then
    raise exception 'unsupported dimension: %', p_dimension;
  end if;

  return query execute format($q$
    select coalesce(nullif(%I, ''), 'Unknown')::text as key, count(*)::bigint
      from public.analytics_events
     where received_at >= $1 and is_bot = false
       %s
     group by 1
     order by 2 desc
     limit $2
  $q$, p_dimension,
     -- Referrer and path are properties of a PAGE VIEW; counting them over
     -- every event type would weight them by how chatty a page happens to be.
     case when p_dimension in ('path', 'referrer') then 'and event_type = ''page_view''' else '' end)
  using p_since, p_limit;
end;
$$;

/** Exact download counts per status, plus the bytes actually delivered. */
create or replace function public.analytics_download_totals(
  p_since timestamptz,
  p_until timestamptz default null
)
returns table (status text, downloads bigint, bytes bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select status::text, count(*)::bigint, coalesce(sum(file_size), 0)::bigint
    from public.analytics_downloads
   where created_at >= p_since
     and is_bot = false
     and (p_until is null or created_at < p_until)
   group by status;
$$;

/**
 * Downloads per platform — exact.
 *
 * This was the last sampled number on the dashboard: it read up to 20 000
 * download rows and tallied them in JS, so on a busy month the platform split
 * described the most recent 20 000 downloads rather than the range.
 */
create or replace function public.analytics_platform_totals(
  p_since timestamptz,
  p_limit integer default 12
)
returns table (key text, count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(nullif(platform, ''), 'unknown')::text, count(*)::bigint
    from public.analytics_downloads
   where created_at >= p_since and is_bot = false
   group by 1
   order by 2 desc
   limit p_limit;
$$;

/**
 * New vs returning — exact, by first-seen date.
 *
 * The JS version sampled 500 visitors, asked whether each had any earlier
 * event, and SCALED the observed rate up to the full unique count. That is an
 * estimate with an unreported error bar presented as a number.
 */
create or replace function public.analytics_visitor_split(p_since timestamptz)
returns table (new_visitors bigint, returning_visitors bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with seen as (
    select visitor_id, min(received_at) as first_seen
      from public.analytics_events
     where is_bot = false
     group by visitor_id
  ),
  active as (
    select distinct visitor_id
      from public.analytics_events
     where received_at >= p_since and is_bot = false
  )
  select
    count(*) filter (where s.first_seen >= p_since)::bigint,
    count(*) filter (where s.first_seen <  p_since)::bigint
  from active a join seen s using (visitor_id);
$$;

/** Per-page traffic, exact, for the catalogue table. */
create or replace function public.analytics_page_traffic(p_since timestamptz)
returns table (path text, views bigint, visitors bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(path, '/')::text, count(*)::bigint, count(distinct visitor_id)::bigint
    from public.analytics_events
   where received_at >= p_since and is_bot = false and event_type = 'page_view'
   group by 1;
$$;

/** Time-bucketed traffic for the trend chart — exact, gap-free filled in JS. */
create or replace function public.analytics_timeseries(
  p_since timestamptz,
  p_bucket text
)
returns table (bucket timestamptz, visitors bigint, page_views bigint, downloads bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_bucket not in ('hour', 'day') then
    raise exception 'unsupported bucket: %', p_bucket;
  end if;

  return query
  with ev as (
    select date_trunc(p_bucket, received_at) as b,
           visitor_id,
           event_type
      from public.analytics_events
     where received_at >= p_since and is_bot = false
  ),
  dl as (
    select date_trunc(p_bucket, created_at) as b, count(*)::bigint as n
      from public.analytics_downloads
     where created_at >= p_since and is_bot = false
     group by 1
  ),
  agg as (
    select b,
           count(distinct visitor_id)::bigint as visitors,
           count(*) filter (where event_type = 'page_view')::bigint as page_views
      from ev group by b
  )
  select coalesce(agg.b, dl.b),
         coalesce(agg.visitors, 0),
         coalesce(agg.page_views, 0),
         coalesce(dl.n, 0)
    from agg full outer join dl on dl.b = agg.b;
end;
$$;

/**
 * Every download, newest first, for the admin download-history view.
 *
 * Owner, 2026-08-09: "Admin should be able to see all users failed and
 * Successful downloads history details and link in the admin dashboard".
 *
 * The SOURCE URL is joined back from the event log: `analytics_downloads` never
 * stored one. It is carried in the `download_requested` event's properties, so
 * the link the owner asked for is recoverable for every download recorded since
 * that property started being sent — and NULL, honestly, for older ones.
 */
create or replace function public.analytics_download_log(
  p_since timestamptz,
  p_status text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  download_id  uuid,
  status       text,
  platform     text,
  media_kind   text,
  quality      text,
  file_size    bigint,
  duration_ms  integer,
  error_reason text,
  country      text,
  device       text,
  user_id      uuid,
  visitor_id   text,
  created_at   timestamptz,
  updated_at   timestamptz,
  source_url   text,
  title        text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.download_id, d.status, d.platform, d.media_kind, d.quality,
         d.file_size, d.duration_ms, d.error_reason, d.country, d.device,
         d.user_id, d.visitor_id, d.created_at, d.updated_at,
         e.properties ->> 'sourceUrl',
         e.properties ->> 'title'
    from public.analytics_downloads d
    left join lateral (
      select properties
        from public.analytics_events
       where download_id = d.download_id
         and properties ? 'sourceUrl'
       order by occurred_at asc
       limit 1
    ) e on true
   where d.created_at >= p_since
     and d.is_bot = false
     and (p_status is null or d.status = p_status)
   order by d.created_at desc
   limit p_limit offset p_offset;
$$;

/* ───────────────────────────────── grants ───────────────────────────────── */

do $$
declare fn text;
begin
  foreach fn in array array[
    'analytics_traffic_totals(timestamptz, timestamptz, timestamptz)',
    'analytics_breakdown(timestamptz, text, integer)',
    'analytics_download_totals(timestamptz, timestamptz)',
    'analytics_platform_totals(timestamptz, integer)',
    'analytics_visitor_split(timestamptz)',
    'analytics_page_traffic(timestamptz)',
    'analytics_timeseries(timestamptz, text)',
    'analytics_download_log(timestamptz, text, integer, integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end;
$$;
