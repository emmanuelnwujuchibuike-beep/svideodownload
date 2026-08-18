-- =====================================================================
-- FrenzSave — Feature 15 Part 6 tranche 2: a minimal share history log.
--
-- A graded allow/throttle/block antispam module (matching repost's
-- lib/social/repost/antispam.ts) needs the sharer's OWN recent history to
-- evaluate — repost has this for free (one row per repost in `reposts`);
-- plain share never had an equivalent table (§5/§12 of
-- FEATURE_15_PART_6_SHARING.md: "no `shares` table exists anywhere").
-- Rather than build the full attribution ledger tranche 3 will eventually
-- need (per-recipient delivery, destination breakdown, conversion) just to
-- unblock antispam, this is the deliberately minimal slice: enough rows to
-- reason about RATE, not yet enough for analytics. Tranche 3 extends this
-- table rather than replacing it.
-- =====================================================================

create table if not exists public.share_events (
  id              uuid primary key default uuid_generate_v4(),
  sharer_id       uuid not null references auth.users (id) on delete cascade,
  post_id         uuid not null references public.posts (id) on delete cascade,
  creator_id      uuid not null references auth.users (id) on delete cascade,
  recipient_count integer not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists share_events_sharer_recent_idx on public.share_events (sharer_id, created_at desc);
create index if not exists share_events_post_idx on public.share_events (post_id);

alter table public.share_events enable row level security;

-- Self-insert only — the API route (service role via createAdminClient)
-- writes these, but the policy exists for the same "not the primary gate,
-- but a real backstop against a hand-rolled anon-key query" reason Part 4
-- already established for reposts.
drop policy if exists "share_events self insert" on public.share_events;
create policy "share_events self insert" on public.share_events
  for insert with check (auth.uid() = sharer_id);

-- A sharer can read their own history (what the antispam check itself does,
-- server-side via the admin client) and a post's creator can see who shared
-- their post shared it — same "the creator sees engagement on their own
-- post" precedent every other engagement table in this app already follows.
drop policy if exists "share_events read own or creator" on public.share_events;
create policy "share_events read own or creator" on public.share_events
  for select using (auth.uid() = sharer_id or auth.uid() = creator_id);
