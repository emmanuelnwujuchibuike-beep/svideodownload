-- =====================================================================
-- FrenzSave — Feature 17 Part 9: voice + video comments
--   • post_comments gains optional voice-note and short-video-reply
--     attachments, alongside the existing text/sticker/image.
--   • voice_waveform stores precomputed amplitude peaks (0-100 ints) so
--     every viewer's client renders the waveform instantly instead of
--     re-downloading + decoding the whole audio file just to draw bars.
--   • video_thumbnail_url is a client-captured poster frame, same pattern
--     as every other video surface in the app (never a bare black box
--     before playback starts).
-- Additive + idempotent; existing reads keep working if this hasn't run yet.
-- =====================================================================

alter table public.post_comments
  add column if not exists voice_url          text,
  add column if not exists voice_duration_ms   int,
  add column if not exists voice_waveform      jsonb,
  add column if not exists video_url           text,
  add column if not exists video_duration_ms   int,
  add column if not exists video_thumbnail_url text;
