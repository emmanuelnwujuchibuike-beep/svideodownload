-- ═══════════════════════════════════════════════════════════════════════════
--  0203 — paid reward videos for the HD and batch download gates (2026-10-09)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "check if reward ads for high quality and batch downloads were added to
-- the promote formats, and they should use the same ad pattern already set on
-- the ad network." They were not: only ai_video_save_reward was a paid reward
-- placement. These two use the existing REWARD_VIDEO format (video only, 15 s
-- most, no repeat) and sit in the same gates the network's rewarded unit serves
-- (lib/ads-platform/slot-moments.ts: paid first, network second).
--
-- Seeded like 0195's placements: idempotent, and an admin's own edits are never
-- overwritten. No price is seeded, so neither is for sale until the admin sets one.
-- No semicolon inside any quoted string.

insert into public.ad_placements (code, name, description, format_code, page_scope, sort_order) values
  ('hd_download_reward', 'HD download reward', 'A reward video watched to unlock a top-quality download.', 'REWARD_VIDEO', array['download', 'download_result'], 110),
  ('batch_download_reward', 'Batch download reward', 'A reward video watched to unlock a batch download.', 'REWARD_VIDEO', array['download', 'download_result'], 120)
on conflict (code) do nothing;
