-- 0172 — Event ingest moves OFF the Vercel function and into Postgres.
--
-- Owner, 2026-09-27: "reduce Vercel Observability event usage/cost by moving
-- FrenzSave's custom application/user event tracking from Vercel Observability
-- to Supabase."
--
-- ═════════════════════════════════════════════════════════════════════════════
--  WHAT THIS ACTUALLY CHANGES, BECAUSE THE PREMISE NEEDED CORRECTING
-- ═════════════════════════════════════════════════════════════════════════════
--
-- There is no Vercel analytics SDK in this project — no @vercel/analytics, no
-- @vercel/otel, no OTLP exporter (lib/observability/trace.ts is an in-memory
-- Map and a ring buffer; setSpanExporter is called only from its own test).
-- The events being billed are FUNCTION INVOCATIONS and LOG LINES.
--
-- Product analytics already lands in THIS table. What it pays Vercel for is the
-- relay: every batched beacon woke `/api/analytics/collect`, a Node function,
-- purely to forward rows here. ~22,000 events in the last 7 days did that.
--
-- So the table does not move. The HOP does: the browser now calls
-- `track_events()` on this database directly, and no Vercel function is
-- involved in the analytics path at all.
--
-- ── Why not a new `user_events` table ───────────────────────────────────────
--
-- The brief suggests one. `analytics_events` already IS it: 145,796 rows, ~20
-- admin queries and several SQL aggregates built on top. A parallel table would
-- either duplicate every write — the exact double-counting the brief's Phase 10
-- forbids — or split the admin's history across two stores, losing metrics the
-- brief's Phase 7 says to keep. The brief licenses this: "the exact schema
-- should be based on the existing project architecture". Section 5 records why
-- a `user_events` view was written and then deliberately removed.
--
-- ⚠️ ORDER IS LOAD-BEARING. Plain DDL first, every dollar-quoted block LAST —
-- INCLUDING the grants, which is why they live in a `do` block at the bottom
-- rather than beside the functions they apply to. `0130_streaks.sql` silently
-- skipped two trailing `alter table` statements that sat after a
-- `create function`, and nothing reported an error for weeks. Here the stakes
-- are higher than a missing column: a `revoke` that landed while its `grant`
-- was skipped would leave the browser unable to write ANY event.

-- ---------------------------------------------------------------------
-- 1 · `feature` — the column the per-section admin subscriptions filter on
--
-- The brief's Phase 5 wants "Admin → Downloads subscribes only to the download
-- event stream". Realtime filters match ONE column with a simple operator, so
-- that needs a coarse category to exist as a column of its own; deriving it
-- from `event_type` in the client would mean every section receiving every
-- event and discarding most of them, which is the firehose being avoided.
--
-- Nullable with no default and no backfill: 145,796 existing rows genuinely
-- predate the column and labelling them by guesswork would be a fabricated
-- stat. The admin says "unclassified" for them.
-- ---------------------------------------------------------------------
alter table public.analytics_events add column if not exists feature text null;

-- ---------------------------------------------------------------------
-- 2 · Indexes — two added, one dropped, net +1
--
-- "Optimize for … date-range, user-based, event-type, feature-based queries.
-- Do not over-index the table."
--
-- This table already carries NINE indexes (six from 0103, three bot-filtered
-- from 0115) against ~3,950 writes a day, so write amplification is already the
-- binding constraint. Net change here is +1: two added, one dropped.
--
-- Already covered: event-type and date-range (0103's (event_type, received_at)
-- and (received_at), plus 0115's `is_bot = false` partials). Missing: feature,
-- and a per-user TIMELINE.
-- ---------------------------------------------------------------------

-- Partial on `is_bot = false`, matching 0115's established pattern — the comment
-- there is "every aggregate filters on this, so it leads the index", and the
-- per-section admin reads are aggregates like any other.
create index if not exists analytics_events_feature_time_idx
  on public.analytics_events (feature, received_at desc)
  where feature is not null and is_bot = false;

-- A per-user timeline ("detailed activities for this member, newest first")
-- currently has to sort after the index lookup, because 0103 indexed `user_id`
-- alone. The composite serves every query the single-column index served AND
-- the ordering, so the old one is redundant rather than complementary —
-- dropping it keeps the write cost of this high-volume table flat.
--
-- ⚠️ Deliberately NOT partial on `is_bot = false`, unlike the feature index
-- above. An operator reading one member's activity needs to see everything that
-- member did, including anything a mis-parsed user agent flagged as automated —
-- a partial index would push that read into a sequential scan, or worse, invite
-- a bot filter that renders a real member's timeline empty.
create index if not exists analytics_events_user_time_idx
  on public.analytics_events (user_id, received_at desc)
  where user_id is not null;
drop index if exists public.analytics_events_user_idx;

-- ---------------------------------------------------------------------
-- 3 · RLS — an admin may READ; nobody else may read anything
--
-- 0103 enabled RLS and wrote NO policies, so only the service role could touch
-- this table. That is exactly why a Vercel function had to stand in the middle.
--
-- 🔴 SELECT FOR ADMINS ONLY. Not "for the owner of the row": a member being
-- able to read their own analytics rows sounds harmless and is not — the rows
-- carry `visitor_id`, which is stable across sign-out, so a member could read
-- their own visitor id here and then recognise it in any other surface that
-- exposes one. The admin dashboard is the only reader, and `public.is_admin()`
-- is the one definition of admin every other policy in this database uses (0144).
--
-- There is deliberately NO insert/update/delete policy. Writes arrive through
-- the `security definer` functions below, which bypass RLS and are the only
-- door — so a client cannot forge a row shape those functions would not build.
-- ---------------------------------------------------------------------
drop policy if exists analytics_events_admin_read on public.analytics_events;
create policy analytics_events_admin_read
  on public.analytics_events
  for select
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- 4 · NO `user_events` VIEW — written, then deliberately removed
--
-- The brief names the table `user_events`. A view under that name existed in a
-- draft of this migration and was taken out, because it would have been
-- actively dangerous rather than merely redundant:
--
--   • 🔴 A Postgres view defaults to `security_invoker = false`, i.e. it runs
--     with its OWNER's rights and BYPASSES the base table's RLS. Supabase's
--     default privileges also grant select on new objects to `anon`. So the
--     convenience alias would have handed every signed-out visitor the whole
--     145k-row event log — straight through the policy in section 3 written to
--     stop exactly that. It is fixable (`with (security_invoker = true)` plus
--     explicit revokes), but a footgun that has to be defused is a poor trade
--     for an alias.
--   • This schema contains NO views at all. It would be the first, and the
--     first of anything carries the cost of a pattern nobody here maintains.
--   • It buys nothing. Realtime cannot subscribe to a view, so the admin
--     subscribes to `analytics_events` regardless, and every existing query
--     already names the real table.
--
-- The brief's own instruction — "the exact schema should be based on the
-- existing project architecture" — is what this follows.
-- ---------------------------------------------------------------------

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN. NO PLAIN DDL BELOW THIS LINE.
-- ═════════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------
-- 5 · Realtime — publish the table; RLS is the filter
--
-- Realtime's postgres_changes respects RLS, so the admin-only SELECT policy in
-- section 3 IS the gate: a member subscribing to this table receives nothing.
--
-- ⚠️ DEFAULT replica identity, NOT `full`. Only INSERTs are broadcast (this is
-- an append-only log), and an INSERT payload carries every column regardless.
-- `replica identity full` would add a WAL cost per row on the highest-write
-- table in the database, for an UPDATE stream that never happens.
-- ---------------------------------------------------------------------
do $realtime$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'analytics_events'
  ) then
    alter publication supabase_realtime add table public.analytics_events;
  end if;
end
$realtime$;

-- ---------------------------------------------------------------------
-- 6 · `track_events` — the one door, called straight from the browser
--
-- 🔴 IT TAKES NO USER ID. The hard law from 0141: a `security definer`
-- function with a `p_user_id` argument lets anyone write as anyone. Identity
-- here is `auth.uid()`, read inside the function from the caller's own JWT, and
-- any `user_id` in the payload is IGNORED. A guest gets null, which is correct
-- and is what the whole signed-out funnel depends on.
--
-- Unlike every other function in this schema, EXECUTE is granted to `anon` —
-- deliberately, and it is the point: a signed-out visitor's page views are the
-- majority of this table. What makes that safe is that the function's only
-- effect is an append to a log whose every trustworthy field it computes
-- itself:
--
--   user_id      auth.uid()  — cannot be forged
--   received_at  now()       — cannot be forged; every admin window uses it
--   occurred_at  clamped to [now - 24h, now] — a wrong device clock, or a
--                forged one, cannot park rows in the future where they would
--                sit at the top of every "recent" query for ever
--
-- What a hostile caller CAN still do is insert plausible rows: fake page views,
-- a fake country. It could already do that today by POSTing to
-- /api/analytics/collect, so this is not a new exposure — but it is a real
-- limit, and `is_bot`/geo are now client-relayed (stamped by the server that
-- rendered the document) rather than derived per request. Stated, not hidden.
--
-- `on conflict do nothing` keeps the exactly-once guarantee 0103 was built for:
-- the client re-queues a failed batch, so the same event_id genuinely does
-- arrive twice.
-- ---------------------------------------------------------------------
create or replace function public.track_events(p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $track_events$
declare
  v_uid   uuid        := auth.uid();
  v_now   timestamptz := now();
  v_count integer     := 0;
begin
  -- A malformed payload is dropped quietly. Analytics must never be able to
  -- surface an error into the page that fired it.
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    return 0;
  end if;
  -- Bounded, so one call cannot become an unbounded write. Mirrors the 50-event
  -- ceiling the collect route's zod schema enforced.
  if jsonb_array_length(p_events) = 0 or jsonb_array_length(p_events) > 50 then
    return 0;
  end if;

  insert into public.analytics_events (
    event_id, event_type, visitor_id, session_id, user_id, download_id,
    occurred_at, received_at, path, referrer,
    country, region, city, device, browser, os, is_bot,
    feature, properties
  )
  select
    (e->>'event_id')::uuid,
    e->>'event_type',
    left(e->>'visitor_id', 64),
    left(e->>'session_id', 64),
    v_uid,
    /*
      🔴 EVERY OPTIONAL CAST IS GUARDED BY A SHAPE TEST, NOT BY THE EXCEPTION
      HANDLER AT THE BOTTOM.

      A cast that raises would be caught down there — and the handler returns 0
      for the WHOLE batch, so one malformed field in one event would silently
      discard the other 49. Analytics failing quietly is the intended behaviour;
      analytics failing quietly and taking good data with it is not. So a bad
      value becomes null for that one column and the row still lands.
    */
    case
      when e->>'download_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (e->>'download_id')::uuid
    end,
    -- least() first so a future timestamp is pulled back to now, then
    -- greatest() so an ancient one is pulled forward to the 24h floor.
    greatest(
      least(
        coalesce(
          case when e->>'occurred_at' ~ '^\d{4}-\d{2}-\d{2}T' then (e->>'occurred_at')::timestamptz end,
          v_now
        ),
        v_now
      ),
      v_now - interval '24 hours'
    ),
    v_now,
    left(e->>'path', 512),
    left(e->>'referrer', 1024),
    left(e->>'country', 8),
    left(e->>'region', 16),
    left(e->>'city', 128),
    left(e->>'device', 32),
    left(e->>'browser', 64),
    left(e->>'os', 64),
    -- A string comparison, not a ::boolean cast — `is_bot` is `not null default
    -- false` (0115), so an absent key must land false rather than raise or null.
    coalesce(e->>'is_bot', '') = 'true',
    left(e->>'feature', 32),
    coalesce(
      case when jsonb_typeof(e->'properties') = 'object' then e->'properties' end,
      '{}'::jsonb
    )
  from jsonb_array_elements(p_events) as e
  where e ? 'event_id'
    and e ? 'event_type'
    /*
      `is not null`, not `?`. Both columns are NOT NULL, and `e ? 'key'` is
      true for a key whose value is JSON null — which would become a SQL null,
      violate the constraint, abort the INSERT, and hand all 50 events to the
      exception handler. A key being present is not the same as it carrying a
      value.
    */
    and (e->>'visitor_id') is not null
    and (e->>'session_id') is not null
    -- A shape guard, not a security boundary: the TypeScript
    -- `AnalyticsEventType` union stays the source of truth for WHICH events
    -- exist (a migration is a heavier place to add one than a deploy). This
    -- only keeps junk and oversized strings out of a column the admin feed
    -- renders and groups by.
    and e->>'event_type' ~ '^[a-z][a-z0-9_]{2,63}$'
    -- An unparseable uuid would abort the whole batch; skip the row instead.
    and e->>'event_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  on conflict (event_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
exception
  -- 🔴 The whole point of this function is that analytics cannot break a
  -- download, a sign-in or a navigation. A caller gets 0, never an error.
  when others then
    return 0;
end;
$track_events$;

-- ---------------------------------------------------------------------
-- 7 · `track_download_state` — the canonical per-download row
--
-- `analytics_downloads` is one row per download, and its rule is "the LATEST
-- event by its own clock wins, not the last one to arrive". The collect route
-- enforced that in TypeScript plus a `last_event_at` guard. Moving ingest into
-- the database means the rule has to live here, or a re-queued batch would
-- revert a completed download to 'requested' and null its file size — the
-- exact regression 0115's guard was written for.
--
-- Same identity rule as section 6: no user id argument, `auth.uid()` only.
-- ---------------------------------------------------------------------
create or replace function public.track_download_state(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $track_download_state$
declare
  v_uid   uuid        := auth.uid();
  v_now   timestamptz := now();
  v_count integer     := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return 0;
  end if;
  if jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 50 then
    return 0;
  end if;

  insert into public.analytics_downloads (
    download_id, visitor_id, session_id, user_id,
    platform, media_kind, quality, status, error_reason,
    file_size, duration_ms, retry_of, batch_id, link_key,
    country, device, is_bot, last_event_at, updated_at
  )
  select
    (r->>'download_id')::uuid,
    left(r->>'visitor_id', 64),
    left(r->>'session_id', 64),
    v_uid,
    left(r->>'platform', 64),
    left(r->>'media_kind', 32),
    left(r->>'quality', 64),
    coalesce(left(r->>'status', 32), 'requested'),
    left(r->>'error_reason', 256),
    -- Guarded for the same reason section 6's casts are: a non-numeric value
    -- would raise, and the handler at the bottom discards the whole batch
    -- rather than this one field.
    case when r->>'file_size'   ~ '^[0-9]+$' then (r->>'file_size')::bigint   end,
    case when r->>'duration_ms' ~ '^[0-9]+$' then (r->>'duration_ms')::bigint end,
    left(r->>'retry_of', 64),
    left(r->>'batch_id', 64),
    left(r->>'link_key', 64),
    left(r->>'country', 8),
    left(r->>'device', 32),
    coalesce(r->>'is_bot', '') = 'true',
    greatest(
      least(
        coalesce(
          case when r->>'last_event_at' ~ '^\d{4}-\d{2}-\d{2}T' then (r->>'last_event_at')::timestamptz end,
          v_now
        ),
        v_now
      ),
      v_now - interval '24 hours'
    ),
    v_now
  from jsonb_array_elements(p_rows) as r
  where (r->>'visitor_id') is not null -- a NOT NULL column; see section 6
    and r->>'download_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  on conflict (download_id) do update set
    -- 🔴 LATEST WINS, and an older arrival changes nothing at all. Status and
    -- its reason share one predicate so a late batch cannot land a partial mix
    -- of old and new values.
    status       = case when excluded.last_event_at >= analytics_downloads.last_event_at then excluded.status       else analytics_downloads.status end,
    error_reason = case when excluded.last_event_at >= analytics_downloads.last_event_at then excluded.error_reason else analytics_downloads.error_reason end,
    -- A size/duration that arrives is never thrown away by a later event that
    -- does not carry one: `completed` knows the file size, `cancelled` does not.
    file_size     = coalesce(excluded.file_size, analytics_downloads.file_size),
    duration_ms   = coalesce(excluded.duration_ms, analytics_downloads.duration_ms),
    platform      = coalesce(excluded.platform, analytics_downloads.platform),
    media_kind    = coalesce(excluded.media_kind, analytics_downloads.media_kind),
    quality       = coalesce(excluded.quality, analytics_downloads.quality),
    retry_of      = coalesce(excluded.retry_of, analytics_downloads.retry_of),
    batch_id      = coalesce(excluded.batch_id, analytics_downloads.batch_id),
    link_key      = coalesce(excluded.link_key, analytics_downloads.link_key),
    user_id       = coalesce(excluded.user_id, analytics_downloads.user_id),
    last_event_at = greatest(excluded.last_event_at, analytics_downloads.last_event_at),
    updated_at    = v_now;

  get diagnostics v_count = row_count;
  return v_count;
exception
  when others then
    return 0;
end;
$track_download_state$;

-- ---------------------------------------------------------------------
-- 8 · The grants — inside a `do` block, on purpose
--
-- Postgres grants EXECUTE to PUBLIC by default, so "grant to anon" alone would
-- leave a wider grant sitting underneath it; the revoke has to come first.
--
-- ⚠️ Both statements are wrapped in a dollar-quoted block because plain DDL
-- placed after a `create function` in the same file has silently failed to
-- apply in this project before (`0130_streaks.sql`). If the revoke landed and
-- the grant did not, every browser would lose the ability to record an event,
-- and — because the client swallows analytics failures by design — nothing
-- would report it. Probe the effect after deploy, not the file.
-- ---------------------------------------------------------------------
do $grants$
begin
  execute 'revoke all on function public.track_events(jsonb) from public';
  execute 'grant execute on function public.track_events(jsonb) to anon, authenticated';
  execute 'revoke all on function public.track_download_state(jsonb) from public';
  execute 'grant execute on function public.track_download_state(jsonb) to anon, authenticated';
end
$grants$;
