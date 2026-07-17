-- Story video covers: store the poster that's already being captured.
--
-- Owner (2026-07-16), for the third time: "i need the story section in both home
-- page and message to cache and show instantly every enterance ... i want an
-- instant display not wait or load of any kind after the page have been opened
-- once."
--
-- The previous two attempts fixed the wrong layer. Round 1 cached the story
-- LIST; round 2 shrank the ring IMAGES to 1-3KB AVIF via next/image. Both were
-- real improvements and neither touched the actual cause, because the cause is
-- only on VIDEO stories:
--
--   a video story ring paints its 68px circle with
--     <video src="…mp4#t=0.3" preload="metadata">
--   which downloads MP4 container + enough frames to decode 0.3s — on EVERY
--   mount, over the network, never from the image cache. Measured live: the
--   story feed genuinely contains .mp4 stories right now.
--
-- The poster already exists! `story-studio.tsx` captures a first-frame JPEG with
-- captureVideoPoster(), uploads it, and POSTs it as `thumbnailUrl` — and
-- `/api/stories` validates it in its zod schema and then silently DROPS it,
-- because `stories` (migration 0015) has nowhere to put it. So the fix is a
-- column, not new machinery.
--
-- Nullable with no backfill on purpose: stories live 24h, so every legacy row
-- here ages out by itself within a day, and the row keeps the <video> fallback
-- for exactly those. No backfill job can be worth writing for data that deletes
-- itself tomorrow.
alter table public.stories
  add column if not exists thumbnail_url text;

comment on column public.stories.thumbnail_url is
  'First-frame poster for video stories, captured client-side at upload. Lets the ring paint an <img> instead of streaming the MP4 on every mount. Null for images (they are their own cover) and for stories created before 0083.';
