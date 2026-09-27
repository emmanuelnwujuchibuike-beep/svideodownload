-- 0174 — A diagnostic, because `track_download_state` fails invisibly.
--
-- ═════════════════════════════════════════════════════════════════════════════
--  WHAT IS KNOWN, MEASURED AGAINST THE LIVE DATABASE
-- ═════════════════════════════════════════════════════════════════════════════
--
--   ✓ `track_events` inserts into `analytics_events` through the same
--     mechanism — same `security definer`, same pinned search_path, same jsonb
--     shape, same anon grant — and works. Fourteen behavioural checks pass,
--     including the clock clamp and the ignored payload user_id.
--   ✓ A hand-written PostgREST upsert of the identical row into
--     `analytics_downloads` succeeds (201), so the table, its columns, its
--     `status` value and its unique index on download_id are all fine.
--   ✗ `track_download_state` returns 0 and writes nothing — for a fresh INSERT
--     and for an ON CONFLICT DO UPDATE against a row seeded by hand. Every
--     field combination, down to the bare minimum, behaves identically.
--   ✗ Restructuring it from one set-based INSERT into a per-row loop (0173)
--     changed nothing, which rules out the statement's shape.
--
-- The remaining suspect is therefore not the SQL but the ENVIRONMENT the
-- function runs in: what its owner is allowed to do to `analytics_downloads`,
-- as opposed to `analytics_events`. A `security definer` function bypasses RLS
-- only because its owner owns the table or holds BYPASSRLS, and it needs an
-- ordinary INSERT/UPDATE grant on top of that. Either could differ between two
-- tables created by different migrations.
--
-- ── Why a diagnostic instead of another blind fix ───────────────────────────
--
-- Two rewrites have now failed to move the needle, and guessing again would be
-- a third. `raise warning` (0173) puts the real error in the Postgres log, but
-- the log is not reachable from here, and this needs to be readable from a probe
-- script.
--
-- 🔴 THIS FUNCTION IS TEMPORARY AND MUST BE DROPPED. It is deliberately
-- service_role ONLY — never anon, never authenticated — because it returns raw
-- database error text, which is exactly the kind of internal detail that must
-- not reach a browser. 0175 removes it once the cause is known.

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN. NO PLAIN DDL BELOW THIS LINE.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.track_ingest_diag(p_rows jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $diag$
declare
  v_uid  uuid        := auth.uid();
  v_now  timestamptz := now();
  r      jsonb       := p_rows->0;
  v_who  text;
  v_can  text;
begin
  -- Who does this function actually run as, and what may that role do?
  select current_user into v_who;
  select string_agg(p, ',') into v_can
    from (
      select 'insert' as p where has_table_privilege('public.analytics_downloads', 'INSERT')
      union all
      select 'update'    where has_table_privilege('public.analytics_downloads', 'UPDATE')
      union all
      select 'select'    where has_table_privilege('public.analytics_downloads', 'SELECT')
      union all
      select 'ev:insert' where has_table_privilege('public.analytics_events', 'INSERT')
    ) t;

  begin
    insert into public.analytics_downloads (
      download_id, visitor_id, session_id, user_id, status, is_bot, last_event_at, updated_at
    )
    values (
      (r->>'download_id')::uuid,
      left(r->>'visitor_id', 64),
      left(r->>'session_id', 64),
      v_uid,
      coalesce(left(r->>'status', 32), 'requested'),
      coalesce(r->>'is_bot', '') = 'true',
      v_now,
      v_now
    )
    on conflict (download_id) do update set
      status     = excluded.status,
      updated_at = v_now;
    return format('OK user=%s privs=%s', v_who, coalesce(v_can, 'NONE'));
  exception
    when others then
      -- The whole point: the real SQLSTATE and message, returned rather than swallowed.
      return format('FAIL %s / %s | user=%s privs=%s', sqlstate, sqlerrm, v_who, coalesce(v_can, 'NONE'));
  end;
end;
$diag$;

do $diag_grants$
begin
  -- service_role ONLY. Raw error text must never be reachable by a browser.
  execute 'revoke all on function public.track_ingest_diag(jsonb) from public';
  execute 'revoke all on function public.track_ingest_diag(jsonb) from anon, authenticated';
  execute 'grant execute on function public.track_ingest_diag(jsonb) to service_role';
end
$diag_grants$;
