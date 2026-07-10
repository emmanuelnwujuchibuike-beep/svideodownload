-- =====================================================================
-- FrenzSave — retroactively enforce "Reels never carries more than one
-- video" (owner rule, 2026-07-10) against EXISTING posts, not just new
-- uploads. The client (features/create/upload-modal.tsx) and server
-- (app/api/stories/route.ts) already stop new multi-video albums from
-- becoming a Reel — but any post published as a multi-video reel BEFORE
-- that change is still `format = 'reel'` and keeps showing up in Reels.
-- This moves those (and only those) to the Feed, matching the rule.
--
-- A single-video reel has no post_media rows at all (its one clip lives
-- directly on posts.media_url) — untouched. A mixed photo+video album
-- should already be 'feed' (a pre-existing, separate rule), so this only
-- ever matches a genuine multi-VIDEO reel. Idempotent — once format flips
-- to 'feed' the WHERE clause no longer matches, safe to re-run.
-- =====================================================================

update public.posts p
set format = 'feed'
where p.format = 'reel'
  and (
    select count(*) from public.post_media pm
    where pm.post_id = p.id and pm.media_kind = 'video'
  ) > 1;
