-- 0311 — wallpapers keep their full resolution (owner, 2026-10-31: "make sure upload wallpapers through users or admin
-- doesn't reduce the wallpaper quality, so if is 4k it stays 4K").
--
-- Uploads are stored byte-for-byte (lib/wallpapers-upload.ts keeps the original as image_url; only the grid thumbnail
-- is a resized copy) and downloads stream that original. The one thing that could still stop a 4K file was the
-- bucket's 20 MB ceiling: a lossless 4K PNG can be larger. Raised to 50 MB, matching WALLPAPER_MAX_BYTES.
update storage.buckets
   set file_size_limit = 52428800 -- 50 MB
 where id = 'wallpapers';
