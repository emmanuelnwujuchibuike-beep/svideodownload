-- 0175 — The bug, found: `retry_of` is a uuid and the function handed it text.
--
-- ═════════════════════════════════════════════════════════════════════════════
--  WHAT IT WAS
-- ═════════════════════════════════════════════════════════════════════════════
--
-- `analytics_downloads.retry_of` is declared `uuid` (0103). Every version of
-- `track_download_state` passed `left(r->>'retry_of', 64)`, which is TEXT.
--
-- Postgres has no assignment cast from text to uuid, so this failed while the
-- statement was being PLANNED:
--
--   column "retry_of" is of type uuid but expression is of type text
--
-- 🔴 A PLAN-TIME FAILURE IGNORES THE DATA, and that is why it looked so
-- baffling. It fired for every payload, including ones with no `retry_of` at
-- all, including the bare minimum; for a fresh INSERT and for an ON CONFLICT
-- DO UPDATE; for the set-based version in 0172 and the per-row loop in 0173,
-- because both named the same column in the same way. A null cannot fail a
-- cast — but a null never got that far.
--
-- It was invisible for two more reasons, both now fixed:
--   • `exception when others then return 0` swallowed it (0173 added the
--     warning that would have said this on the first call).
--   • The old collect route never hit it: PostgREST coerces JSON to the
--     column's type at the API layer, so writing the same field through
--     `.upsert()` worked and writing it from inside SQL did not.
--
-- Found by 0174's diagnostic, which inserted a SUBSET of the columns and
-- succeeded — `OK user=postgres privs=insert,update,select,ev:insert`. That
-- ruled out ownership, RLS and grants in one call and pointed straight at a
-- column the real function wrote and the diagnostic did not.
--
-- `batch_id` and `link_key` were checked at the same time and are `text`
-- (0137), so they were never part of this.

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
        /*
          🔴 THE FIX. A uuid COLUMN, so the expression must be uuid-typed — and
          typed the same way whether or not a value is present, because the type
          is settled when the statement is planned, not when the row arrives.
          The regex guard is the same one `download_id` uses: a malformed value
          becomes null rather than raising.
        */
        case
          when r->>'retry_of' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (r->>'retry_of')::uuid
        end,
        -- text columns (0137), unlike retry_of. Checked, not assumed.
        left(r->>'batch_id', 64),
        left(r->>'link_key', 64),
        left(r->>'country', 8),
        left(r->>'device', 32),
        coalesce(r->>'is_bot', '') = 'true',
        v_at,
        v_now
      )
      on conflict (download_id) do update set
        -- LATEST WINS. An older arrival changes nothing: the client re-queues a
        -- failed batch to the FRONT, so a retried batch genuinely arrives after
        -- the one behind it. Status and its reason share one predicate so a late
        -- batch cannot land a partial mix of old and new values.
        status       = case when excluded.last_event_at >= d.last_event_at then excluded.status       else d.status end,
        error_reason = case when excluded.last_event_at >= d.last_event_at then excluded.error_reason else d.error_reason end,
        -- A value that arrived is never erased by a later event carrying none:
        -- `completed` knows the file size, `cancelled` does not.
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
        -- One row lost, the batch kept — and said out loud. This is the line
        -- that would have named the bug above on its first call.
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
-- The diagnostic goes
--
-- 0174 said it was temporary and this is that. It returned raw database error
-- text, which has no business existing a moment longer than the investigation
-- it was written for.
-- ---------------------------------------------------------------------
do $cleanup$
begin
  execute 'drop function if exists public.track_ingest_diag(jsonb)';
  execute 'revoke all on function public.track_download_state(jsonb) from public';
  execute 'grant execute on function public.track_download_state(jsonb) to anon, authenticated';
end
$cleanup$;
