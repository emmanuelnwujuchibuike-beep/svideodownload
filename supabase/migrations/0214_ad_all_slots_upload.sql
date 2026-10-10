-- 0214: "All slots" takes large and MOV videos like every other video format.
--
-- 0208 gave each video format max_upload_bytes = 200 MB - the size an
-- advertiser may upload before Cloudflare Stream transcodes it down to the
-- slot's delivery size. 0211 created ALL_SLOTS afterwards, so it never got the
-- value. With it null the upload step treats the format as "no transcoding":
-- every MOV was refused ("export it as MP4") and any video over 10 MB was
-- "larger than we serve" (owner, 2026-10-10).
--
-- Idempotent: only a null is filled, an admin's own value is kept.

update public.ad_formats set max_upload_bytes = 209715200
 where code = 'ALL_SLOTS' and 'video' = any (media_types) and max_upload_bytes is null;
