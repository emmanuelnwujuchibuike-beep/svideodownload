-- ═══════════════════════════════════════════════════════════════════════════
--  0305 — Exclusive posts: a locked video plays BLURRED for non-subscribers (2026-10-28)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-28: "let exclusive feed videos play but blurred to users who haven't a subscription. It should auto
-- play and be blurred when an unsubscribed user watches."
--
-- The 0263 rule stands: a non-subscriber never receives the post's media. What they get is a 24 px wide clip of the
-- first seconds, made and blurred in the CREATOR's browser at publish time (lib/media/make-blur-clip.ts) — the detail
-- is gone before it is uploaded, so, like the still blur_preview, it is safe in public storage. The app scales it up
-- behind a CSS blur. The server accepts only a URL on our own public media hosts (lib/sub/posts.ts validCover), only
-- for a locked post, and sends it only where the still preview is sent (a viewer without access, never an age-locked
-- post). A post without it keeps the still preview.
--
-- Run by hand after 0304. Safe to run twice.

alter table public.sub_posts add column if not exists blur_video_url text;
alter table public.sub_posts drop constraint if exists sub_posts_blur_video_chk;
alter table public.sub_posts add constraint sub_posts_blur_video_chk check (blur_video_url is null or (char_length(blur_video_url) <= 600 and blur_video_url like 'https://%'));
comment on column public.sub_posts.blur_video_url is '0305: a 24 px blurred clip of a locked video (made in the creator browser, detail destroyed before upload). Sent only where blur_preview is.';
