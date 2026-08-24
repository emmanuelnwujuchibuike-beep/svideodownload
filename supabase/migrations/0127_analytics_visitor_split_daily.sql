-- =====================================================================
-- FrenzSave — daily new vs. returning visitors, computed exactly in Postgres
--
-- Owner, 2026-08-23: "returning visitors in admin is glitching, showing 0
-- when new visitors is 92 and total visitors was 144, so returning suppose
-- to be 52."
--
-- ── What was actually wrong ──────────────────────────────────────────────
-- `getVisitorSplitSeries` (lib/analytics/queries.ts) built the daily chart
-- from TWO different sources and subtracted one from the other:
--
--   newVisitors(day)       ← analytics_visitor_split RPC (exact, sees ALL rows)
--   active(day)            ← a JS scan of analytics_events, capped at 50 000
--                            rows, ordered received_at ASCENDING
--   returningVisitors(day) = max(0, active − newVisitors)
--
-- Once 30 days of traffic exceeded that 50 000-row cap, the ASCENDING order
-- meant the scan discarded the NEWEST events — precisely the days the chart
-- is most read. Measured live on 2026-08-24: the scan stopped at
-- 2026-08-23T13:18Z, so that day's `active` was a partial 82 while the RPC
-- correctly reported 92 new visitors. 82 − 92 is negative, clamped to 0, and
-- the day rendered as "0 returning" — a confident, wrong number, of exactly
-- the kind migration 0115's own audit exists to eliminate. The true figure
-- for that window was 52.
--
-- Two defects, not one:
--   1. the truncation threw away the wrong end of the range, and
--   2. a COMPLETE term was subtracted from a TRUNCATED one, so a partially
--      scanned day could not produce anything but nonsense.
--
-- ── Why this is SQL rather than another JS workaround ────────────────────
-- The original chose a capped client-side loop specifically to avoid adding
-- a migration (unapplied migrations being this project's documented
-- recurring failure mode — see MEMORY.md). That trade-off is what broke: no
-- row cap can be both bounded and correct here, because the cap silently
-- changes the ANSWER rather than just the cost. Postgres can group 50 000+
-- rows into per-day distinct-visitor sets on an existing index without
-- shipping a single row to Node, so the exact answer is also the cheap one.
--
-- Also note this needs no per-day subtraction of cumulative RPC calls: a
-- visitor's `first_seen` is a fixed point in time, so "new on day D" is
-- directly expressible as "first_seen falls inside D". new + returning is
-- therefore exactly the day's active-visitor count, by construction — the
-- two can never disagree the way two separate sources could.
--
-- Idempotent.
-- =====================================================================

create or replace function public.analytics_visitor_split_daily(
  p_since timestamptz
)
returns table (
  day                date,
  new_visitors       bigint,
  returning_visitors bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with seen as (
    -- Every visitor's first-ever event, over ALL retained history — not just
    -- the window. This is what makes "returning" meaningful: a visitor is
    -- returning on day D because they existed BEFORE D, which is a fact
    -- about the whole table, not about the window being charted.
    select visitor_id, min(received_at) as first_seen
      from public.analytics_events
     where is_bot = false
     group by visitor_id
  ),
  active as (
    -- One row per (day, visitor) — the day's distinct active visitors.
    select distinct
           (received_at at time zone 'UTC')::date as day,
           visitor_id
      from public.analytics_events
     where is_bot = false
       and received_at >= p_since
  )
  select
    a.day,
    -- first_seen lands inside this same UTC day → the visitor was born today.
    count(*) filter (where (s.first_seen at time zone 'UTC')::date = a.day)::bigint,
    -- first_seen predates this day → they had been here before.
    count(*) filter (where (s.first_seen at time zone 'UTC')::date < a.day)::bigint
  from active a
  join seen s using (visitor_id)
  group by a.day
  order by a.day;
$$;

revoke all on function public.analytics_visitor_split_daily(timestamptz) from public, anon, authenticated;

comment on function public.analytics_visitor_split_daily(timestamptz) is
  'Exact per-UTC-day new vs. returning active visitors since p_since. Replaces the row-capped JS scan in getVisitorSplitSeries, which silently reported 0 returning visitors for the most recent day once traffic exceeded its cap.';
