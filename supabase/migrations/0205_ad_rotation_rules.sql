-- ═══════════════════════════════════════════════════════════════════════════
--  0205 — rotation rules (owner, 2026-10-09)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- "Make all ad format to rotate 10, top banner rotates every 15 seconds or
-- every time the user comes back to the app. And reward, Download result,
-- completed, and others should rotate on every download."
--
--   every format    a rotation pool of 10 slots
--   TOP_BANNER      swaps every 15 s (was 5). The banner also moves on when the
--                   app comes back into view (browser side, self-ad-banner).
--   DOWNLOAD_RESULT_BANNER   no timer: a different ad on every download result,
--                   never the one shown last (like the interstitials and the
--                   reward video, which already work per show)
--
-- An admin may still change any of these later. Plain DDL only. No semicolon
-- inside any quoted string.

update public.ad_formats set slot_count = 10, updated_at = now() where slot_count is distinct from 10;
update public.ad_formats set rotation_seconds = 15, updated_at = now() where code = 'TOP_BANNER';
update public.ad_formats set rotation_seconds = null, no_consecutive_repeat = true, updated_at = now() where code = 'DOWNLOAD_RESULT_BANNER';
update public.ad_platform_settings set default_slot_count = 10, updated_at = now() where id;
