-- =====================================================================
-- 0089_learning_analytics.sql
-- Frenzsave · Aggregate engagement over the learning corpora — which
-- lessons and articles are actually finished, and which are opened and
-- abandoned.
--
-- ── This is the decision 0088 deliberately deferred ───────────────────
-- 0088 ends with: "There is deliberately no policy granting anyone else
-- read access, including for aggregate stats — an aggregate is a separate
-- decision, and it should be made explicitly rather than fall out of a
-- loose policy." This file is that explicit decision, and it is made as
-- narrowly as the question allows.
--
-- ── No new data is collected ──────────────────────────────────────────
-- There is no events table here and no new write path. This reads the
-- rows 0088 already stores. An analytics table would mean a second record
-- of the same behaviour, retained on a different schedule, with its own
-- RLS to get wrong — for information already derivable. Derive, do not
-- store, applied to the highest-risk data in the system.
--
-- ── The privacy problem, and the k-anonymity floor ────────────────────
-- "Which lessons is someone reading" is a real signal about a person: the
-- security school, the privacy articles. An aggregate is not automatically
-- safe just because it is a COUNT. On a corpus this size, "1 reader
-- completed how-your-account-is-protected" plus any knowledge of who the
-- users are is not an aggregate, it is a disclosure with a count in front
-- of it.
--
-- So a bucket is suppressed entirely below MIN_COHORT distinct readers.
-- The threshold is a hard constant and NOT a parameter: a caller-supplied
-- minimum is authorization by argument, which is the exact shape of bug
-- the security checklist exists to catch — the caller would simply pass 1.
--
-- Known and accepted limitation: suppression is vulnerable to differencing
-- if an unsuppressed grand total is published alongside it. That is why no
-- total is exposed here. If one is ever added, this reasoning has to be
-- redone rather than assumed to still hold.
--
-- ── Nothing identifies a reader ───────────────────────────────────────
-- The function returns counts per ITEM. It never returns user_id, and
-- there is deliberately no per-reader or per-cohort breakdown, no "who
-- completed this", and no time series fine enough to single someone out by
-- when they read something.
--
-- Idempotent; safe to re-run.
-- =====================================================================

-- ── Aggregate engagement per corpus item, admin only ──────────────────
--
-- SECURITY DEFINER because it must read across all users' rows, which is
-- precisely what 0088's RLS policy forbids. That makes the authorization
-- check inside this function the ONLY thing standing between a signed-in
-- user and everyone's reading history, so it is the first statement and it
-- raises rather than returning empty — an empty result is indistinguishable
-- from "no data yet", and a security control should never be silent.
--
-- `set search_path = public` so a caller cannot shadow `is_admin` or the
-- table with objects in their own schema.
create or replace function public.learning_engagement()
returns table (
  item_kind   text,
  item_slug   text,
  readers     bigint,
  completions bigint,
  bookmarks   bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- The suppression floor. A constant, never an argument — see the header.
  MIN_COHORT constant int := 5;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select
      i.item_kind,
      i.item_slug,
      count(distinct i.user_id)::bigint,
      count(*) filter (where i.completed_at is not null)::bigint,
      count(*) filter (where i.bookmarked_at is not null)::bigint
    from public.personal_learning_items i
    group by i.item_kind, i.item_slug
    -- Suppress, do not round or fuzz. A rounded small count still tells you
    -- the cohort is small; an absent row tells you nothing at all.
    having count(distinct i.user_id) >= MIN_COHORT
    order by count(distinct i.user_id) desc, i.item_slug;
end $$;

-- Postgres grants EXECUTE to PUBLIC on function creation. Without this
-- revoke, every role including `anon` could call it — and the definer
-- context means it would run with the owner's privileges. The admin check
-- above would still refuse them, but defence in depth is the whole point:
-- one editing mistake inside the function should not become anonymous
-- access to every reader's history.
revoke all on function public.learning_engagement() from public;
revoke all on function public.learning_engagement() from anon;
grant execute on function public.learning_engagement() to authenticated;

-- ── Deliberately NOT added: an index on (item_kind, item_slug) ────────
-- The aggregate is a full group-by, and an index would make it cheaper.
-- It is not added because the table is optimised for the per-user reads a
-- reader waits on, and every index is a write cost paid on those. This
-- query runs on an admin page, occasionally, on a table that is small and
-- will stay small for a long time — the layer nobody is waiting on. Revisit
-- when the admin page is measurably slow, not before.
comment on function public.learning_engagement() is
  'Aggregate learning engagement per corpus item. Admin only; buckets below 5 distinct readers are suppressed. See 0089.';
