-- 0177 — Make the 90-day aggregates fast, and stop them hanging the dashboard.
--
-- ═════════════════════════════════════════════════════════════════════════════
--  0176 MADE THE SYMPTOM WORSE, AND THIS CORRECTS IT
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-09-27, after 0176 shipped: "Sections in the admin dashboard
-- doesn't load or takes time to load, it shows white."
--
-- 0176 raised `statement_timeout` to 30s on the six aggregates the 90-day
-- summary awaits, so that a 7.75s read would stop failing at the role's 8s
-- limit. It did stop failing. Measured again after it applied:
--
--   analytics_traffic_totals   12,261 ms   (was 7,751 ms, and failing)
--   analytics_visitor_split     5,962 ms
--
-- 🔴 A BANNER AFTER EIGHT SECONDS WAS BAD. A BLANK PANEL FOR TWELVE IS WORSE.
-- The revenue section is its own Suspense boundary, so the rest of /admin
-- paints — but that boundary now holds an empty card for as long as the read
-- takes, which is exactly what "it shows white" describes. Raising a timeout
-- treats the reported error and not the cause; the cause is that the query is
-- slow.
--
-- ── What is actually slow ───────────────────────────────────────────────────
--
-- `analytics_traffic_totals` counts DISTINCT visitor_id and DISTINCT session_id
-- across the window, and derives bounced sessions by grouping every session in
-- it. 146,763 rows exist and effectively all of them are inside 90 days, so
-- this reads the whole table and sorts it — twice — with only
-- `analytics_events_human_time_idx (received_at desc) where is_bot = false` to
-- help, which orders the rows but carries none of the columns being counted.
-- Every row therefore costs a heap fetch.
--
-- ── The index ───────────────────────────────────────────────────────────────
--
-- `(received_at, visitor_id, session_id, event_type) where is_bot = false`
-- carries every column these aggregates touch, in the order they scan, so the
-- range read becomes index-only: no heap at all.
--
-- ⚠️ IT IS WIDER THAN THIS PROJECT'S USUAL RULE and that is a deliberate,
-- stated trade. `analytics_events` already carried nine indexes before today
-- and takes ~4,000 inserts a day; this is a tenth, and a four-column one. The
-- alternative is an admin dashboard that cannot show its own figures. Write
-- cost on 4,000 daily inserts is not the binding constraint here — a twelve
-- second read that an operator looks at daily is.
--
-- ⚠️ NOT `CONCURRENTLY`. It cannot run inside a transaction block and this
-- runner wraps a migration in one, so it would abort the whole file. On 146,763
-- rows a plain build is a couple of seconds of write blocking on a table whose
-- writers are all fire-and-forget analytics beacons that retry — the correct
-- thing to make wait, if anything has to.
--
-- ── And the timeout comes back down ─────────────────────────────────────────
--
-- 30s was a hang dressed as a fix. 15s is enough headroom for a cold cache on a
-- window this size once the index is in, and still fails loudly rather than
-- holding a panel — and a connection — for half a minute.

create index if not exists analytics_events_aggregate_idx
  on public.analytics_events (received_at, visitor_id, session_id, event_type)
  where is_bot = false;

-- Fresh statistics, so the planner knows the new index exists and what it
-- holds. Without this the index can sit unused until autovacuum gets to a table
-- it has just been told nothing about — which would look exactly like this
-- migration having done nothing.
analyze public.analytics_events;

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN. NO PLAIN DDL BELOW THIS LINE.
-- ═════════════════════════════════════════════════════════════════════════════

do $timeouts$
declare
  fn text;
begin
  foreach fn in array array[
    'public.analytics_traffic_totals(timestamptz, timestamptz, timestamptz)',
    'public.analytics_visitor_split(timestamptz)',
    'public.analytics_download_totals(timestamptz, timestamptz)',
    'public.analytics_timeseries(timestamptz, text)',
    'public.analytics_page_traffic(timestamptz)',
    'public.analytics_breakdown(timestamptz, text, integer)'
  ]
  loop
    begin
      execute format('alter function %s set statement_timeout = %L', fn, '15s');
    exception
      when undefined_function then
        raise warning 'statement_timeout not set — no such function: %', fn;
    end;
  end loop;
end
$timeouts$;
