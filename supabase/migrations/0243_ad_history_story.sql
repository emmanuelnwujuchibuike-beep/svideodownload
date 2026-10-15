-- ═══════════════════════════════════════════════════════════════════════════
--  0243 — a paid full-screen ad in the History viewer (2026-10-14)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "Ad doesn't show in the history. When a user watched 3 medias from
-- history he or she should see the full screen ad, can be image or video.
-- Include it to the self ad application and service."
--
-- One new placement an advertiser can pick in /advertise. It is the SAME moment
-- the network's `history_story_ad` zone already serves (slot `history_story_ad`,
-- lib/ads-platform/slot-moments.ts: paid first, network second). It uses the
-- existing INTERSTITIAL format (image or video), so the same creative rules,
-- upload limits and review apply. The "every 3 media" cadence is its frequency
-- rule, so the format's between-ads gap does not apply to it (as Stories).
-- Like every placement it is NOT for sale until an admin prices it, and an
-- admin can switch it off.
--
-- Insert-only and idempotent: safe to run before or after the site code ships.
-- No semicolon inside any quoted string.

insert into public.ad_placements (code, name, description, format_code, page_scope, sort_order) values
  ('history_story', 'History viewer', 'A full-screen image or video ad after every 3 media watched in History.', 'INTERSTITIAL', array['history'], 26)
on conflict (code) do nothing;
