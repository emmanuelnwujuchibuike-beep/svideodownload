-- 0116_repost_intelligence.sql
-- Feature 15 · Part 4 — The Recommendation Engine.
--
-- Three additions to `reposts` and one new ledger. Design doc:
-- docs/FEATURE_15_PART_4_REPOST.md. Idempotent; safe to re-run.
--
--   1. audience          — a repost can now be private. Note this touches only
--                          the POINTER row, never posts.visibility (which is a
--                          CHECK referenced by the feed indexes and an RLS
--                          policy that a dozen queries depend on).
--   2. source_repost_id  — provenance: WHERE the reposter found it. This one
--                          column is what makes Social Ripple™, Discovery
--                          Bridge™ and second-degree ranking possible at all.
--   3. quote_media       — the quote repost's optional attachment.
--   4. repost_attributions — the consequence ledger: what a repost actually
--                          caused. Every analytics figure in this feature is a
--                          count of rows in here and nothing else.

-- ── 1. Audience ────────────────────────────────────────────────────────────
-- Defaults to 'public' so every EXISTING repost keeps exactly the behaviour it
-- had. Defaulting to anything narrower would retroactively hide reposts people
-- made publicly, which is a silent change to something already published.
alter table public.reposts add column if not exists audience text not null default 'public';

do $$ begin
  alter table public.reposts add constraint reposts_audience_chk
    check (audience in ('public','followers','friends','close_friends','private'));
exception when duplicate_object then null; end $$;

-- ── 2. Provenance ──────────────────────────────────────────────────────────
-- on delete SET NULL, never cascade: if Chris deletes his repost, the people who
-- found the reel through him keep theirs. Cascading would delete other people's
-- content because someone upstream changed their mind.
alter table public.reposts add column if not exists source_repost_id uuid;

do $$ begin
  alter table public.reposts add constraint reposts_source_fk
    foreign key (source_repost_id) references public.reposts (id) on delete set null;
exception when duplicate_object then null; end $$;

-- A repost may never cite itself as its own source.
do $$ begin
  alter table public.reposts add constraint reposts_source_not_self
    check (source_repost_id is null or source_repost_id <> id);
exception when duplicate_object then null; end $$;

create index if not exists reposts_source_idx
  on public.reposts (source_repost_id) where source_repost_id is not null;

-- Audience-aware distribution reads: "public reposts of these posts, newest first".
create index if not exists reposts_post_audience_idx
  on public.reposts (post_id, audience, created_at desc);

-- ── 2b. Throttling ─────────────────────────────────────────────────────────
-- The middle verdict from lib/social/repost/antispam.ts. A throttled repost is
-- WRITTEN — the member sees it on their own profile and nothing tells them
-- anything went wrong — but the distribution engine skips it.
--
-- This is a column rather than a Redis flag because distribution reads reposts
-- in bulk: checking a cache key per candidate would turn one query into fifty.
alter table public.reposts add column if not exists throttled_at timestamptz;

-- ── 3. Quote media ─────────────────────────────────────────────────────────
-- jsonb, shape { kind: 'image'|'gif', url, width, height }. jsonb rather than
-- columns because the shape is owned by the composer and will grow (voice,
-- music) — and because a quote has at most one attachment, so this is never a
-- collection masquerading as a document.
alter table public.reposts add column if not exists quote_media jsonb;

-- ── 4. RLS: a private repost must not be readable by anon key ──────────────
-- Every application read of this table goes through the service role, so the
-- primary audience gate is in code (lib/social/repost/audience.ts) where the
-- relationship data already lives. This policy is the second line: it makes a
-- hand-rolled anon-key query unable to enumerate non-public reposts, which the
-- old `using (true)` allowed.
drop policy if exists "reposts public read" on public.reposts;
create policy "reposts public read" on public.reposts
  for select using (audience = 'public' or user_id = auth.uid());

-- ── 5. The attribution ledger ──────────────────────────────────────────────
-- One row per (repost, actor, event). The unique index is the honesty guarantee:
-- scrolling past a repost twice, or liking / unliking / re-liking, can never
-- inflate a reach number.
--
-- actor_id is nullable and ON DELETE SET NULL: a deleted account must not erase
-- the reach it contributed, but must not remain identifiable either.
create table if not exists public.repost_attributions (
  id         uuid primary key default uuid_generate_v4(),
  repost_id  uuid not null references public.reposts (id) on delete cascade,
  post_id    uuid not null references public.posts (id) on delete cascade,
  actor_id   uuid references auth.users (id) on delete set null,
  event      text not null,
  created_at timestamptz not null default now(),
  constraint repost_attributions_event_chk check (
    event in ('impression','open','like','comment','save','repost','follow_creator')
  )
);

-- Dedupe. coalesce() because a signed-out impression has no actor: those collapse
-- into a single row per repost per event rather than being counted per session,
-- which would be a view counter wearing an attribution costume.
create unique index if not exists repost_attributions_dedupe_uidx
  on public.repost_attributions
     (repost_id, event, coalesce(actor_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists repost_attributions_repost_idx
  on public.repost_attributions (repost_id, event);
create index if not exists repost_attributions_post_idx
  on public.repost_attributions (post_id, created_at desc);

alter table public.repost_attributions enable row level security;

-- No client reads this table directly — insights are aggregated server-side and
-- returned as COUNTS, because "who saw your repost" is not a thing this product
-- will answer. The only policy is the reposter reading their own rows, which is
-- what a future client-side insights view would need.
drop policy if exists "repost attributions owner read" on public.repost_attributions;
create policy "repost attributions owner read" on public.repost_attributions
  for select using (
    exists (
      select 1 from public.reposts r
      where r.id = repost_attributions.repost_id and r.user_id = auth.uid()
    )
  );

-- ── 6. Discovery Bridge™ notification type ─────────────────────────────────
-- 🔴 STANDING RULE for this constraint (learned the hard way when 0036 failed in
-- production): notifications_type_chk has been widened EIGHT times — 0013, 0018,
-- 0020, 0036, 0037, 0042, 0044, 0049, 0059. Never rebuild it from the last
-- migration you happened to find. The list below is 0059's full set (the most
-- recent) plus this migration's single addition.
alter table public.notifications drop constraint if exists notifications_type_chk;
alter table public.notifications add constraint notifications_type_chk check (
  type in (
    -- social
    'follow','like','love','comment','reply','mention','tag','quote','repost',
    'share','save','profile_view','invite','milestone','repost_engagement',
    'comment_reaction',
    -- Feature 15 Part 4: someone followed a creator through your repost
    'repost_discovery',
    -- messaging
    'message','message_reaction','message_mention',
    -- friends
    'friend_request','friend_accepted','friend_reminder',
    -- downloads
    'download_complete','download_failed','download_ready','processing_finished',
    -- community
    'community_invite','community_accepted','community_announcement','community_event',
    -- news
    'news_breaking','news_trending','news_following','news_recommended',
    -- premium
    'subscription_activated','payment_successful','renewal_reminder','premium_expiring',
    -- security
    'security_login','security_new_device','security_password','security_2fa',
    'security_suspicious','security_recovery',
    'security_2fa_disabled','security_recovery_used',
    'security_passkey_enrolled','security_passkey_removed',
    -- system
    'system','admin_broadcast',
    -- trust & safety
    'post_under_review'
  )
);

-- Same rule for the paired dedupe index — carry 0036's full list forward and add
-- repost_discovery. One discovery notification per (reposter, follower, post).
drop index if exists notifications_dedupe_uidx;
create unique index if not exists notifications_dedupe_uidx
  on public.notifications (user_id, actor_id, type, coalesce(post_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where type in ('follow','like','save','friend_request','friend_accepted','repost_engagement','repost_discovery');
