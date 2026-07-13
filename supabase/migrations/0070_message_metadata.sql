-- 0070_message_metadata.sql
-- Frenzsave · Premium Messaging inbox mockup completion: Location + Contact
-- share messages. Neither fits `message_attachments` (that table is
-- media-file-shaped — url/thumbnail/duration/waveform — checked directly,
-- confirmed no generic column exists there or on `messages` itself), so a
-- small structured JSON column on `messages` carries these lightweight,
-- non-file payloads instead:
--   location: { lat, lng, label }
--   contact:  { friendId, displayName, handle, avatarUrl }
-- NULL for every ordinary text/media message (the overwhelming majority).

alter table public.messages
  add column if not exists metadata jsonb;
