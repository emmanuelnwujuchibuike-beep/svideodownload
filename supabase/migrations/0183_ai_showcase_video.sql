-- 0183 — showcase cards may carry a short video (2026-10-06)
--
-- Owner, 2026-10-06: "backend to upload images and video where required in
-- the showcase cards". The `ai-showcase` bucket (0182) took webp only; a
-- slide may now also hold one MP4 or WebM clip, uploaded by an admin through
-- app/api/admin/ai/showcase/route.ts (service role), stored as uploaded.
--
-- The limit rises from 5 MB to 12 MB — the route enforces 12 MB for a clip
-- and the image copies stay ~50–250 kB. Still public, still no
-- storage.objects policy (see 0182 for why).

update storage.buckets
set file_size_limit = 12582912,                                   -- 12 MB
    allowed_mime_types = array['image/webp', 'video/mp4', 'video/webm']
where id = 'ai-showcase';
