-- 0029_stream_status.sql
-- Cloudflare Stream processing status, driven by the account-wide Stream webhook
-- (app/api/webhooks/stream). `stream_ready` lets the player skip a wasted HLS
-- attempt while a video is still transcoding (it just plays the MP4 fallback
-- until Stream reports ready); `stream_error` surfaces an encode failure for
-- support/debugging; `caption_languages` records which auto-generated caption
-- tracks actually succeeded. Nullable/defaulted and additive: posts without a
-- stream_uid are unaffected, and existing stream_uid posts default to
-- stream_ready = false until the next webhook event or backfill re-ingest.

alter table posts
  add column if not exists stream_ready boolean not null default false,
  add column if not exists stream_error text,
  add column if not exists caption_languages text[] not null default '{}';

-- The webhook looks up a post by its Stream uid on every event; keep that cheap.
create index if not exists posts_stream_uid_idx
  on posts (stream_uid)
  where stream_uid is not null;
