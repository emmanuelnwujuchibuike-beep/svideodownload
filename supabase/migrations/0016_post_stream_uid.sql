-- 0016_post_stream_uid.sql
-- Cloudflare Stream: store the Stream video UID for a post so playback can use the
-- adaptive-bitrate HLS ladder (instant start) instead of downloading the raw R2 file.
-- Nullable + additive: posts without a uid keep playing their `media_url` as before.
-- Populated on store (server/services/store-media-service.ts via copyToStream) and
-- by the backfill script (scripts/backfill-stream.mjs). See docs/INFRASTRUCTURE.md.

alter table posts add column if not exists stream_uid text;

-- Only videos that have been stored but not yet copied to Stream are backfill
-- candidates; a partial index keeps that lookup cheap.
create index if not exists posts_stream_backfill_idx
  on posts (created_at)
  where media_kind = 'video' and media_url is not null and stream_uid is null;
