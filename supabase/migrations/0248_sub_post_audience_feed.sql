-- 0248 — Frenz Exclusive Part 3: hidden exclusive posts and the Exclusive feed
-- (docs/SUB_MONETIZATION.md "Frenz Exclusive Part 3").
--
--   sub_posts.audience   'locked' (the default, and every existing post): a viewer without access
--                        may see the post's public tile — its cover (if any), date and item count,
--                        never the caption or the media. 'hidden': a viewer without access gets
--                        NOTHING — no id, no tile, no count, no date. The server filters it before a
--                        response is built (lib/sub/posts.ts, lib/sub/feed.ts); there is no client
--                        policy on sub_posts beyond the owner's, so nothing reaches a browser any
--                        other way.
--   sub_posts_feed_idx   (creator_id, created_at desc, id desc) on published posts: the Exclusive
--                        feed and the gallery page by (created_at, id) — a deterministic order with
--                        a tie-breaker, so a page boundary never skips or repeats a post.
--
-- Additive and idempotent. Existing rows become 'locked' through the column default, which is
-- exactly how they behaved before. No policy, grant or function changes.
-- No semicolon inside any quoted string. Every dollar-quoted block is at the end.

alter table public.sub_posts add column if not exists audience text not null default 'locked';
comment on column public.sub_posts.audience is '0248: locked = non-subscribers see the public tile only. hidden = non-subscribers get nothing at all.';

create index if not exists sub_posts_feed_idx on public.sub_posts (creator_id, created_at desc, id desc) where status = 'published';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
begin
  begin
    alter table public.sub_posts add constraint sub_posts_audience_chk check (audience in ('locked', 'hidden'));
  exception when duplicate_object then null;
  end;
end;
$$;
