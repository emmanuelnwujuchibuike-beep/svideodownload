-- 0031_content_format.sql
-- Feed vs Reels separation: every post has an explicit content format. The
-- feed shows text/photo/audio (and future long-form 'feed' videos); Reels is
-- a separate full-screen product showing ONLY 'reel' posts. Nothing appears
-- in both unless a creator deliberately publishes to both (two rows).
-- Backfill: every existing video becomes a reel — that matches what users see
-- today (the reels surface has always shown all videos). Idempotent.

alter table public.posts add column if not exists format text not null default 'feed';

do $$ begin
  alter table public.posts
    add constraint posts_format_chk check (format in ('feed', 'reel'));
exception when duplicate_object then null; end $$;

-- One-time backfill (safe to re-run: only touches videos still marked 'feed').
update public.posts set format = 'reel' where media_kind = 'video' and format = 'feed';

-- Each surface queries its own format newest-first.
create index if not exists posts_format_created_idx
  on public.posts (format, status, visibility, created_at desc);
