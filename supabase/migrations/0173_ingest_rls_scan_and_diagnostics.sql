-- 0173 — Two defects the 0172 probe found on the live database.
--
-- Both were invisible to the build, the tests and the typechecker, and one of
-- them was invisible to the probe as well until the probe asked the right
-- question. Written the same session, straight after 0172.
--
-- ⚠️ Plain DDL first, dollar-quoted blocks last. See 0172's header for the
-- `0130_streaks.sql` partial-apply this ordering exists to avoid.

-- ═════════════════════════════════════════════════════════════════════════════
--  1 · A DENIED READ SCANNED 145,796 ROWS AND TIMED OUT
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Measured: `select event_id from analytics_events limit 5` with the ANON key
-- answered `57014 canceling statement due to statement timeout`.
--
-- It did not leak — the policy held, nothing came back. But the shape of the
-- failure is the problem. `using (public.is_admin())` is a per-row filter as far
-- as the planner is concerned, so a non-admin `limit 5` keeps scanning looking
-- for five rows that will never match, all the way through the table, on the
-- single largest and fastest-growing table in the database. Any anonymous caller
-- could make Postgres do that, repeatedly, for free.
--
-- 🔴 THE FIX IS THE PARENTHESES. Wrapping the call in a scalar subquery makes
-- Postgres evaluate it ONCE as an InitPlan; when it is false the scan is never
-- started. This is Supabase's own documented RLS performance pattern and the
-- difference is a full sequential scan versus nothing at all.
--
-- `public.is_admin()` is already `stable`, which is what makes hoisting legal.
drop policy if exists analytics_events_admin_read on public.analytics_events;
create policy analytics_events_admin_read
  on public.analytics_events
  for select
  using ((select public.is_admin()));

-- ═════════════════════════════════════════════════════════════════════════════
--  2 · `track_download_state` SILENTLY INSERTED NOTHING
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Every call returned 0 and wrote no row — a bare-minimum payload included,
-- while the same row upserted into the same table by hand succeeded, and
-- `track_events` (the same jsonb shape, the same guards, the same
-- `security definer`) worked perfectly.
--
-- ── 🔴 THE REAL DEFECT WAS THE EXCEPTION HANDLER, NOT THE STATEMENT ─────────
--
-- `exception when others then return 0` is right about one thing: analytics must
-- never raise into a download. It is wrong about everything else. It made a
-- raised error and "nothing matched the WHERE clause" the same observable
-- answer, so the function could fail completely while reporting a plausible
-- zero — and this project has been bitten by exactly that shape before
-- (`push_delivery_log` wrote nothing for weeks behind a swallowed rejection,
-- while pushes kept delivering).
--
-- So the handler now keeps the guarantee and drops the silence: it still returns
-- 0 to the caller, and it `raise warning`s the SQLSTATE and SQLERRM into the
-- Postgres log, where Supabase's dashboard shows it. A warning cannot fail the
-- statement and never reaches the browser.
--
-- The statement is also restructured into a per-row loop. Two reasons, and the
-- second is the one that matters:
--
--   • One bad row can no longer cost the batch. The set-based INSERT was all or
--     nothing, which is why the shape guards in 0172 had to be exhaustive; a
--     loop only loses the row that failed, so the guards are a second line of
--     defence rather than the only one.
--   • It is legible. The set-based version's `on conflict do update` referenced
--     `excluded` and the target table across nineteen columns, and reading it
--     was how a whole session got spent not finding the bug.

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN. NO PLAIN DDL BELOW THIS LINE.
-- ═════════════════════════════════════════════════════════════════════════════

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
  r       jsonb;
  v_at    timestamptz;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return 0;
  end if;
  if jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 50 then
    return 0;
  end if;

  for r in select * from jsonb_array_elements(p_rows)
  loop
    begin
      -- Both are NOT NULL columns. `?` is not enough: a key present with a JSON
      -- null value passes it and then violates the constraint.
      continue when (r->>'download_id') is null or (r->>'visitor_id') is null;
      continue when r->>'download_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

      -- Clamped exactly as in `track_events`: a wrong or forged device clock
      -- cannot park a row in the future, nor before the 24-hour floor.
      v_at := greatest(
        least(
          coalesce(
            case
              when r->>'last_event_at' ~ '^\d{4}-\d{2}-\d{2}T' then (r->>'last_event_at')::timestamptz
            end,
            v_now
          ),
          v_now
        ),
        v_now - interval '24 hours'
      );

      insert into public.analytics_downloads as d (
        download_id, visitor_id, session_id, user_id,
        platform, media_kind, quality, status, error_reason,
        file_size, duration_ms, retry_of, batch_id, link_key,
        country, device, is_bot, last_event_at, updated_at
      )
      values (
        (r->>'download_id')::uuid,
        left(r->>'visitor_id', 64),
        left(r->>'session_id', 64),
        v_uid,
        left(r->>'platform', 64),
        left(r->>'media_kind', 32),
        left(r->>'quality', 64),
        coalesce(left(r->>'status', 32), 'requested'),
        left(r->>'error_reason', 256),
        case when r->>'file_size'   ~ '^[0-9]+$' then (r->>'file_size')::bigint   end,
        case when r->>'duration_ms' ~ '^[0-9]+$' then (r->>'duration_ms')::bigint end,
        left(r->>'retry_of', 64),
        left(r->>'batch_id', 64),
        left(r->>'link_key', 64),
        left(r->>'country', 8),
        left(r->>'device', 32),
        coalesce(r->>'is_bot', '') = 'true',
        v_at,
        v_now
      )
      on conflict (download_id) do update set
        -- 🔴 LATEST WINS. An older arrival changes nothing, because the client
        -- re-queues a failed batch to the FRONT of its queue — so a retried
        -- batch genuinely does arrive after the one behind it, and a plain
        -- last-write-wins upsert reverted completed downloads to 'requested'
        -- and nulled their file size. Status and its reason share one predicate
        -- so a late batch cannot land a partial mix of old and new values.
        status       = case when excluded.last_event_at >= d.last_event_at then excluded.status       else d.status end,
        error_reason = case when excluded.last_event_at >= d.last_event_at then excluded.error_reason else d.error_reason end,
        -- A value that arrived is never erased by a later event that carries
        -- none: `completed` knows the file size, `cancelled` does not.
        file_size     = coalesce(excluded.file_size, d.file_size),
        duration_ms   = coalesce(excluded.duration_ms, d.duration_ms),
        platform      = coalesce(excluded.platform, d.platform),
        media_kind    = coalesce(excluded.media_kind, d.media_kind),
        quality       = coalesce(excluded.quality, d.quality),
        retry_of      = coalesce(excluded.retry_of, d.retry_of),
        batch_id      = coalesce(excluded.batch_id, d.batch_id),
        link_key      = coalesce(excluded.link_key, d.link_key),
        user_id       = coalesce(excluded.user_id, d.user_id),
        last_event_at = greatest(excluded.last_event_at, d.last_event_at),
        updated_at    = v_now;

      v_count := v_count + 1;
    exception
      when others then
        /*
          One row lost, the batch kept — and SAID OUT LOUD. A warning goes to
          the Postgres log (visible in the Supabase dashboard) and cannot fail
          the statement or reach the browser.
        */
        raise warning 'track_download_state row skipped: % / %', sqlstate, sqlerrm;
    end;
  end loop;

  return v_count;
exception
  when others then
    raise warning 'track_download_state failed: % / %', sqlstate, sqlerrm;
    return 0;
end;
$track_download_state$;

-- ---------------------------------------------------------------------
-- `track_events` keeps its shape but loses its silence
--
-- It works — verified live, fourteen checks including the clock clamp, the
-- ignored payload user_id, the rejected junk event_type and exactly-once replay.
-- Only the handler changes, for the same reason as above: the next time this
-- function stops writing, something has to say so.
--
-- The set-based INSERT is KEPT here deliberately, unlike the download function.
-- This is the hot path — every page view in the product goes through it — and
-- one statement for a batch of up to fifty is the difference that makes writing
-- straight from the browser cheap. Its shape guards are exhaustive and now
-- proven against junk uuids, junk timestamps and junk event types on the live
-- database, so the all-or-nothing risk is covered by evidence rather than hope.
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
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    return 0;
  end if;
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
    -- 🔴 auth.uid(), never the payload. The 0141 law.
    v_uid,
    case
      when e->>'download_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (e->>'download_id')::uuid
    end,
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
    coalesce(e->>'is_bot', '') = 'true',
    left(e->>'feature', 32),
    coalesce(
      case when jsonb_typeof(e->'properties') = 'object' then e->'properties' end,
      '{}'::jsonb
    )
  from jsonb_array_elements(p_events) as e
  where e ? 'event_id'
    and e ? 'event_type'
    and (e->>'visitor_id') is not null
    and (e->>'session_id') is not null
    and e->>'event_type' ~ '^[a-z][a-z0-9_]{2,63}$'
    and e->>'event_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  on conflict (event_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
exception
  when others then
    raise warning 'track_events failed: % / %', sqlstate, sqlerrm;
    return 0;
end;
$track_events$;

-- ---------------------------------------------------------------------
-- The grants, re-applied inside a `do` block
--
-- `create or replace function` PRESERVES existing privileges, so strictly these
-- are already in place. Re-applied anyway, and idempotently: if a future edit
-- ever drops and recreates one of these instead of replacing it, the browser
-- loses the ability to record anything, and the client swallows analytics
-- failures by design, so nothing would report it.
-- ---------------------------------------------------------------------
do $grants$
begin
  execute 'revoke all on function public.track_events(jsonb) from public';
  execute 'grant execute on function public.track_events(jsonb) to anon, authenticated';
  execute 'revoke all on function public.track_download_state(jsonb) from public';
  execute 'grant execute on function public.track_download_state(jsonb) to anon, authenticated';
end
$grants$;
