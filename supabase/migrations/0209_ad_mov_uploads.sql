-- ═══════════════════════════════════════════════════════════════════════════
--  0209 — ad videos may be uploaded as MOV (2026-10-09)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "it shouldn't be selective on any video" (an iPhone records MOV).
-- The PRIVATE staging bucket accepts video/quicktime. A MOV is never served as
-- is: the site hands it to Cloudflare Stream and serves only the resulting MP4
-- (lib/ads-platform/media-processing.ts), so the PUBLIC bucket is unchanged.
--
-- Idempotent: the type is added once, the existing types are kept.

update storage.buckets
   set allowed_mime_types = array_append(allowed_mime_types, 'video/quicktime')
 where id = 'ad-creatives-staging'
   and allowed_mime_types is not null
   and not ('video/quicktime' = any (allowed_mime_types));
