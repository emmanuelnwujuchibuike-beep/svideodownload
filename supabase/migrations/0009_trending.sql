-- =====================================================================
-- FrenzSave — Phase 9 (content P3): trending
-- Materialized hot_score on posts (recomputed by a cron via the function
-- below) so the feed is a cheap indexed `order by hot_score desc`. Weights +
-- gravity are admin-tunable (passed in from settings.trending). Unique views
-- are already deduped (post_views), and privacy/recommendation exclusions are
-- applied at read time — so manipulation is limited before scoring. Idempotent.
-- =====================================================================

-- Fast partial indexes for the PUBLIC discovery feed.
create index if not exists posts_public_hot_idx
  on public.posts (hot_score desc) where status = 'published' and visibility = 'public';
create index if not exists posts_public_recent_idx
  on public.posts (created_at desc) where status = 'published' and visibility = 'public';
create index if not exists posts_public_cat_hot_idx
  on public.posts (category, hot_score desc) where status = 'published' and visibility = 'public';

-- ---------------------------------------------------------------------
-- recompute_hot_scores — single UPDATE (scales) using the denormalized
-- counters. Score = log(engagement) * quality / (age+2)^gravity, where
-- quality rewards saves/shares/comments per unique view. Returns rows updated.
-- ---------------------------------------------------------------------
create or replace function public.recompute_hot_scores(
  w_view     double precision,
  w_download double precision,
  w_like     double precision,
  w_save     double precision,
  w_share    double precision,
  w_comment  double precision,
  gravity    double precision,
  max_age_hours int
) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.posts set hot_score =
    (
      ln(greatest(1.0,
        w_view * views_count + w_download * downloads_count + w_like * likes_count
        + w_save * saves_count + w_share * shares_count + w_comment * comments_count
      ))
      * (0.5 + (saves_count + shares_count + 2 * comments_count)::double precision / greatest(1, views_count))
    )
    / power(extract(epoch from (now() - created_at)) / 3600.0 + 2.0, gravity)
  where status = 'published'
    and created_at > now() - make_interval(hours => max_age_hours);
  get diagnostics n = row_count;
  return n;
end $$;
