-- SUB posts: a small private preview per media item (owner 2026-10-12: "sub post still takes
-- ages to show the cover to the owner and to subscribers, cover should load instantly").
-- The gallery tiles used the full original from the private bucket; the composer now uploads a
-- ~480 px JPEG next to it, in the creator's own private folder, and the tiles sign that instead.
-- Null = no preview (older posts until backfilled) - the tile falls back to the original.
alter table public.sub_post_media add column if not exists thumb_key text;
