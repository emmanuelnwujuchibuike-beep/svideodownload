-- =====================================================================
-- FrenzSave — Feature 15 Part 5 tranche 4: comment moderation extras
-- (keyword filters + mute-this-commenter). Additive + idempotent.
--
-- Today's moderation is entirely reactive/post-hoc (pin/best/delete/report —
-- see docs/FEATURE_15_PART_5_COMMENTS.md §7/tranche-4). Both of these are
-- pre-publish gates, enforced in app/api/posts/[id]/comments/route.ts
-- alongside the existing commentSpamReason() heuristic.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Keyword filters — account-wide (not per-post), matching how
-- comments_policy already works. A simple text array is enough: no
-- per-keyword metadata, no regex, just literal case-insensitive matches
-- checked in application code (lib/social/engagement.ts).
-- ---------------------------------------------------------------------
alter table public.privacy_settings
  add column if not exists muted_comment_keywords text[] not null default '{}';

-- ---------------------------------------------------------------------
-- Mute-this-commenter-on-my-posts. Deliberately its OWN table, not a column
-- on `blocks` — a block cuts off DMs/following/visibility entirely; muting a
-- commenter is much narrower (they can still follow, message, and see the
-- creator's posts — they just can't comment on them), so conflating the two
-- would silently over-block someone the creator only meant to quiet down in
-- one context.
-- ---------------------------------------------------------------------
create table if not exists public.comment_muted_users (
  creator_id     uuid not null references auth.users (id) on delete cascade,
  muted_user_id  uuid not null references auth.users (id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (creator_id, muted_user_id)
);
create index if not exists comment_muted_users_muted_idx on public.comment_muted_users (muted_user_id);

alter table public.comment_muted_users enable row level security;
drop policy if exists "comment_muted_users self all" on public.comment_muted_users;
create policy "comment_muted_users self all" on public.comment_muted_users
  for all using (auth.uid() = creator_id) with check (auth.uid() = creator_id);
