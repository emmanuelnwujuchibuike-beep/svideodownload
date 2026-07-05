-- 0028_post_media_dimensions.sql
-- Store an image post's natural pixel dimensions so the feed can render it with
-- next/image (AVIF/WebP + right-sized srcset) at the correct aspect ratio, with no
-- crop and no layout shift. Nullable — older posts (and videos) simply have none
-- and fall back to the plain <img>. Captured client-side at upload. Idempotent.

alter table public.posts
  add column if not exists media_width  integer,
  add column if not exists media_height integer;
