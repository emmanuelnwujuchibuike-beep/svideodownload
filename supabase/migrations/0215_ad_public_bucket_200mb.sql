-- 0215: the public ad bucket takes files up to 200 MB (was 50 MB, 0195).
--
-- Owner, 2026-10-10: "run the cap raise". Cloudflare Stream storage is full, so
-- ad videos are now compressed to 480p by the worker and served from this
-- bucket (server/services/ad-video-transcode.ts); a 480p result is a few MB.
-- The raise matches the staging bucket (0208) so a creative that passed upload
-- can always be published here. Viewers never fetch more than they play: ad
-- videos load lazily (preload="metadata") and only while half on screen.
--
-- Idempotent: only raises, never lowers an admin's larger value.

update storage.buckets set file_size_limit = 209715200 where id = 'ad-creatives' and (file_size_limit is null or file_size_limit < 209715200);
