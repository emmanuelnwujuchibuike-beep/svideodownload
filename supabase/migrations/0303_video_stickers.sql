-- ═══════════════════════════════════════════════════════════════════════════
--  0303 — Video stickers for comments (2026-10-28)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-28: members make a 3-second sticker from a video (cropping the part they want), keep it in their
-- sticker library, use it in comments, and save other members' stickers from the comments to their own library.
--
-- A video sticker is one row here. Its id travels as the text `vs:<uuid>` in the slots an emoji sticker already uses
-- (post_comments.sticker, user_stickers.sticker), so neither table changes. The clip is made in the browser (square,
-- silent, at most 3 s, 320 px) and uploaded to the public post-media storage by its creator; the row points at it.
--
--   video_stickers   id, creator, the clip and its poster image, size and length, and hidden_at for moderation.
--                    Anyone may READ a sticker that is not hidden (it is shown in public comments). Nobody writes
--                    through the API: the server (service role) inserts it after checking the uploads are the
--                    creator's own (app/api/stickers/video). Deleting the creator's account deletes their stickers.
--
-- Depends on 0022 (user_stickers). Safe to run twice. No dollar-quoted block.

create table if not exists public.video_stickers (
  id          uuid primary key default gen_random_uuid(),
  creator_id  uuid not null references auth.users (id) on delete cascade,
  video_url   text not null,
  poster_url  text not null,
  duration_ms integer not null,
  width       integer not null,
  height      integer not null,
  mime        text not null,
  hidden_at   timestamptz,
  created_at  timestamptz not null default now(),
  constraint video_stickers_duration_chk check (duration_ms between 200 and 3300),
  constraint video_stickers_size_chk check (width between 32 and 640 and height between 32 and 640),
  constraint video_stickers_mime_chk check (mime in ('video/mp4', 'video/webm')),
  constraint video_stickers_url_chk check (char_length(video_url) <= 600 and char_length(poster_url) <= 600)
);
create index if not exists video_stickers_creator_idx on public.video_stickers (creator_id, created_at desc);
alter table public.video_stickers enable row level security;
drop policy if exists "video stickers readable" on public.video_stickers;
create policy "video stickers readable" on public.video_stickers for select using (hidden_at is null);
revoke insert, update, delete on public.video_stickers from anon, authenticated;
grant select on public.video_stickers to anon, authenticated;
grant all on public.video_stickers to service_role;
comment on table public.video_stickers is 'Video stickers (0303): a member''s 3-second square clip for comments. Referenced as vs:<uuid> from post_comments.sticker and user_stickers.sticker. Public read unless hidden, written only by the server.';
