-- =====================================================================
-- 0111_app_ratings.sql
-- Frenzsave · App ratings
--
-- Owner: ask for a rating after two successful downloads, send it to the
-- admin email and the dashboard, and let it be dismissed without nagging.
--
-- ── Why guests can rate ────────────────────────────────────────────────
-- The downloader works with no account, so most people who form an
-- opinion about it are signed out. Requiring sign-in to rate would filter
-- the feedback down to the minority who happen to have an account, which
-- is exactly the population whose opinion is least representative of the
-- product's main use. `user_id` is therefore nullable and `visitor_id`
-- (the analytics visitor cookie) carries the rest.
--
-- ── One rating per rater ───────────────────────────────────────────────
-- Two partial unique indexes rather than one constraint: a signed-in
-- member is unique by `user_id`, a guest by `visitor_id`, and neither
-- index constrains the other. Without this, a guest who later signs in
-- would be blocked, or a single null user_id would block every guest.
-- The API upserts, so re-rating updates rather than failing.
--
-- ── What is NOT stored ─────────────────────────────────────────────────
-- No IP, no user agent, no page history. A rating needs a score, an
-- optional comment and enough to avoid asking twice — nothing else, and
-- collecting more "just in case" is how a feedback box becomes a tracking
-- record.
--
-- Idempotent; safe to re-run.
-- =====================================================================

create table if not exists public.app_ratings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users (id) on delete set null,
  -- The analytics visitor id, so a guest isn't asked twice. Not an identity.
  visitor_id   text,
  rating       smallint not null check (rating between 1 and 5),
  comment      text,
  -- How many downloads they'd completed when asked — the context that makes
  -- a low score actionable ("rated 2 after 2 downloads" reads differently
  -- from "rated 2 after 50").
  downloads    integer,
  -- 'landing' | 'downloads' | 'history' — where the prompt appeared.
  surface      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists app_ratings_user_idx
  on public.app_ratings (user_id) where user_id is not null;
create unique index if not exists app_ratings_visitor_idx
  on public.app_ratings (visitor_id) where user_id is null and visitor_id is not null;
create index if not exists app_ratings_recent_idx
  on public.app_ratings (created_at desc);

alter table public.app_ratings enable row level security;

-- A signed-in member may read and write their OWN rating. Guests write
-- through the server (service role) because they have no auth.uid() to
-- match on. Nobody can read anyone else's rating: the admin dashboard
-- reads through the service role, which RLS does not apply to.
drop policy if exists "app ratings own" on public.app_ratings;
create policy "app ratings own" on public.app_ratings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
