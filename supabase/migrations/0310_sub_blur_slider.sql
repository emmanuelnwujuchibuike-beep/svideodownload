-- 0310 — The creator's blur SLIDER (owner, 2026-10-30: "let the blur set up by a premium drag — drag it to the right to
-- increase and drag to left to reduce like reducing volume").
--
-- sub_posts.blur_level (0307) also stores a slider position, "b0" … "b100" (lib/sub/blur-level.ts). The position falls
-- in one of the three bands, and the BAND — never the position — sets what the public preview holds (the clip and
-- still sizes), so the far left is exactly Light. 0307's check allowed only the three names; this widens it.
--
-- Until this runs the app stores the position's band instead (lib/sub/posts.ts writeBlurLevel): the same preview, a
-- coarser look — never a failed save. Idempotent.

alter table public.sub_posts drop constraint if exists sub_posts_blur_level_check;
alter table public.sub_posts
  add constraint sub_posts_blur_level_check
  check (blur_level in ('light', 'medium', 'strong') or blur_level ~ '^b([0-9]|[1-9][0-9]|100)$');

comment on column public.sub_posts.blur_level is
  'How blurry the locked preview is for non-subscribers: light | medium | strong, or a slider position b0..b100 (0310). The band sets the stored preview size (lib/sub/blur-level.ts). Set by the creator.';
