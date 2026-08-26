-- ============================================================================
-- 0138 — batch_sessions.anon_id: the column 0134 declared but the DB never got
-- ============================================================================
--
-- Owner, 2026-08-26: "multi links still show 2 remaining to anonymous and
-- signed in free users even after using 2."
--
-- 🔴 PROBED LIVE before writing this (2026-08-26). The deployed table is:
--
--     id, batch_id, user_id, ip_hash, created_at        -- no anon_id
--     row count: 0
--
-- while 0134 — in the only version it has ever had in git — declares
-- `anon_id uuid`. 0134 opens with `create table if not exists`, so a table that
-- already existed in an earlier shape was left exactly as it was and the
-- declared column never appeared. `if not exists` guards the TABLE, never its
-- columns; it cannot reconcile a definition that has drifted.
--
-- What that broke, and why nobody saw it:
--
--   `commitBatch` upserts { batch_id, user_id, anon_id, ip_hash }. Naming a
--   column that does not exist fails the whole statement — for SIGNED-IN
--   callers too, which is why the report covers both. The failure lands in
--   commitBatch's catch, which returns `{ allowed: true, used: 0, remaining:
--   limit }` — a clean, full allowance. So every commit reported "0 used, 2
--   remaining", the counter never moved, and the daily cap was not merely
--   displayed wrong: it was NEVER ENFORCED. Zero rows in the table is the
--   proof — not one batch has ever been recorded.
--
--   This is the SAME failure 0134 itself was written to fix ("it just shows a
--   constant you have 2 remaining"), reappearing one layer down: 0134 correctly
--   moved the counter off a fail-open Redis path, and then the column it needed
--   never landed, so the write fell into another fail-open catch.
--
-- Nothing to backfill: the table is empty, and a batch spent before today left
-- no record anywhere to recover a count from. Everyone starts today at zero,
-- which is the generous direction and the only honest one available.

alter table public.batch_sessions add column if not exists anon_id uuid;

comment on column public.batch_sessions.anon_id is
  'Anonymous browser identity (the server-minted httpOnly frenz_sid cookie). NULL for a signed-in member, whose account is the identity. Counting key for signed-out visitors — see lib/downloads/multi-link.ts.';

-- ── The indexes the counting query actually uses ────────────────────────────
--
-- 0134's index is on `(coalesce(user_id::text, ip_hash), created_at desc)`.
-- `batchesUsedToday` does not query that shape — it filters `user_id = $1` OR
-- `anon_id = $1`, and a coalesce expression index serves neither. These two
-- partial indexes match the two queries exactly.
create index if not exists batch_sessions_user_day_idx
  on public.batch_sessions (user_id, created_at desc)
  where user_id is not null;

create index if not exists batch_sessions_anon_day_idx
  on public.batch_sessions (anon_id, created_at desc)
  where anon_id is not null;
