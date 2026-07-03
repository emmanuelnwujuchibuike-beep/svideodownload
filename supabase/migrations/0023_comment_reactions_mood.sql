-- =====================================================================
-- FrenzSave — Comments premium: multi-emoji reactions + mood pills +
-- pinned + best-answer. All additive + idempotent; reads degrade
-- gracefully if this hasn't run yet, so it's safe to apply any time.
-- =====================================================================

-- ---------------------------------------------------------------------
-- comment_reactions gains an emoji (one reaction per user per comment;
-- changing emoji updates the row — the likes_count trigger already only
-- moves on insert/delete, so the total-reactions count stays correct).
-- Legacy rows become ❤️.
-- ---------------------------------------------------------------------
alter table public.comment_reactions
  add column if not exists emoji text not null default '❤️';
create index if not exists comment_reactions_emoji_idx
  on public.comment_reactions (comment_id, emoji);

-- ---------------------------------------------------------------------
-- post_comments: optional mood tag, plus pin + best-answer flags. The
-- post owner / an admin sets pin + best (existing "owner update" RLS).
-- ---------------------------------------------------------------------
alter table public.post_comments
  add column if not exists mood    text,
  add column if not exists pinned  boolean not null default false,
  add column if not exists is_best boolean not null default false;

create index if not exists post_comments_pinned_idx
  on public.post_comments (post_id) where pinned;
create index if not exists post_comments_best_idx
  on public.post_comments (post_id) where is_best;
