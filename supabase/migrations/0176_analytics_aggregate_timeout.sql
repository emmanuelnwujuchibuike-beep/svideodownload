-- 0176 — The 90-day analytics aggregates are allowed to take longer than 8s.
--
-- ═════════════════════════════════════════════════════════════════════════════
--  THE MEASUREMENT
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-09-27: "revenue page still shows same visitors and other stats
-- error."
--
-- /admin's revenue section calls `getAnalyticsSummary("90d")`. Timed against
-- production, with the arguments the dashboard actually sends:
--
--   analytics_traffic_totals   7,751 ms
--   analytics_visitor_split    4,374 ms
--   analytics_download_totals  1,798 ms
--   everything else            < 1,000 ms
--
-- The same calls over a SEVEN-day window are 1.8s and under, which is why the
-- earlier check looked healthy: it was asking a much smaller question than the
-- page does. 146,763 rows exist and roughly all of them are inside 90 days, so
-- the distinct-visitor and distinct-session counts read essentially the whole
-- table.
--
-- PostgREST's role gets an 8-second statement timeout. 7.75s is not a margin —
-- it is a coin toss, and every lost toss returns null, which `getAnalyticsSummary`
-- turns into `exactAggregates: false` and the panel turns into the banner the
-- owner keeps seeing.
--
-- ── Why a timeout and not an index ──────────────────────────────────────────
--
-- An index is the faster answer and it is deliberately NOT this migration.
-- Adding two indexes and a publication to `analytics_events` earlier today
-- locked that table long enough to take the admin dashboard down while it
-- built. This is a one-line catalogue update with no lock, no table rewrite and
-- no write amplification on a table taking ~4,000 inserts a day — and it fixes
-- the reported symptom completely, because the query is not broken, it is
-- merely bigger than the default allowance.
--
-- A covering index on (received_at, visitor_id, session_id) where is_bot=false
-- would make these index-only and is the right follow-up, at a quiet moment,
-- measured before and after.
--
-- ── Why this does not hang the dashboard ────────────────────────────────────
--
-- These reads were moved OFF the blocking path earlier today: the revenue
-- section is a `Suspense` boundary of its own, so it streams in while the rest
-- of /admin paints. A read that takes nine seconds now delays one panel and
-- fills it with real figures, instead of failing at eight and filling it with
-- a banner.
--
-- 30s, not "unlimited": it is a ceiling that still fails loudly if one of these
-- ever becomes genuinely pathological, rather than tying up a connection.
--
-- ⚠️ `alter function … set` REPLACES that setting for the function and leaves
-- every other property alone, so the bodies, the grants and the
-- `security definer` marking are all untouched by this file.

do $timeouts$
declare
  fn text;
begin
  /*
    Every aggregate the 90-day summary awaits. Named explicitly rather than
    matched by prefix: `analytics_%` would also sweep up anything added later
    that has no business running for half a minute.
  */
  foreach fn in array array[
    'public.analytics_traffic_totals(timestamptz, timestamptz, timestamptz)',
    'public.analytics_visitor_split(timestamptz)',
    -- Two arguments, not one: `p_until timestamptz default null` (0115). A
    -- DEFAULT is still part of the signature ALTER FUNCTION has to match, and
    -- naming it wrong would have been skipped with a warning nobody reads.
    'public.analytics_download_totals(timestamptz, timestamptz)',
    'public.analytics_timeseries(timestamptz, text)',
    'public.analytics_page_traffic(timestamptz)',
    'public.analytics_breakdown(timestamptz, text, integer)'
  ]
  loop
    begin
      execute format('alter function %s set statement_timeout = %L', fn, '30s');
    exception
      when undefined_function then
        -- A signature that does not exist on this database is skipped rather
        -- than failing the migration: these were created across several
        -- migrations and one of them may legitimately differ.
        raise warning 'statement_timeout not set — no such function: %', fn;
    end;
  end loop;
end
$timeouts$;
