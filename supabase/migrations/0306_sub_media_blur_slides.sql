-- 0306 — A blurred preview for EVERY item of a locked exclusive post (owner, 2026-10-29: "unsubscribers should be able
-- to slide through a multi post sideways, but it will be blurred" — and every video plays, blurred, with no cover needed).
--
-- 0263 and 0305 gave a post ONE blurred still and ONE blurred clip, made from its first item, so a locked album had
-- nothing to slide to. These are the same two things per item, on sub_post_media:
--   blur_preview    a 20 px heavily blurred WebP data URL of the item (its thumb for a video) — made on the server
--   blur_video_url  a 24 px blurred clip of a video item — made in the creator's browser, detail destroyed before upload
-- Neither is ever the file. Read only by the server (service role), sent only to a viewer without access, exactly
-- where sub_posts.blur_preview / blur_video_url already go. The post-level columns stay as they are (the first item).
-- Idempotent. Until it runs, the app shows the post-level preview as one slide, as before.

alter table public.sub_post_media add column if not exists blur_preview text;
alter table public.sub_post_media add column if not exists blur_video_url text;
alter table public.sub_post_media drop constraint if exists sub_post_media_blur_video_chk;
alter table public.sub_post_media add constraint sub_post_media_blur_video_chk check (blur_video_url is null or (char_length(blur_video_url) <= 600 and blur_video_url like 'https://%'));
comment on column public.sub_post_media.blur_preview is '0306: a 20 px heavily blurred WebP data URL of this item — the only picture of it a non-subscriber receives.';
comment on column public.sub_post_media.blur_video_url is '0306: a 24 px blurred clip of this video item (made in the creator browser). Sent only where blur_preview is.';

do $$
begin
  begin
    -- a data URL of a tiny WebP, nothing else. chr(59) is the semicolon before base64 — the runner splits on a literal one.
    alter table public.sub_post_media add constraint sub_post_media_blur_preview_chk check (blur_preview is null or (blur_preview like 'data:image/webp' || chr(59) || 'base64,%' and length(blur_preview) <= 4000));
  exception when duplicate_object then null;
  end;
end;
$$;
