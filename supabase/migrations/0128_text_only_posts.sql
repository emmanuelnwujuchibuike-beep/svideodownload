-- =====================================================================
-- FrenzSave — text-only posts
--
-- Owner, 2026-08-23, with a screenshot of Story Studio: "when ever i try to
-- make a write up post, it shows this error." The error was the app's own:
--
--   "Add a photo or video to publish (text-only posts are coming soon)."
--
-- Creation Studio has always offered Text, Heading and Quote blocks and then
-- refused to publish anything built only from them, because `posts` could not
-- represent a post without media. This makes it representable.
--
-- ── media_kind gains 'text' ──────────────────────────────────────────────
-- Rather than a nullable media_kind or a separate table: every read path in
-- the app already branches on media_kind, so a fourth value is the change
-- those branches can absorb, whereas a null would silently satisfy `!== 'video'`
-- style checks all over the codebase and a new table would need every feed
-- query rewritten to union two sources.
--
-- ── source_url for a post with no source ──────────────────────────────────
-- `source_url` is NOT NULL and `(publisher_id, source_url_hash)` is unique —
-- that pair is the anti-spam dedupe that stops the same link being published
-- twice. A text post has no source to dedupe against, so lib/social/posts.ts
-- synthesises a per-post `frenz:text:<uuid>` URI. That is deliberately unique
-- per post rather than a hash of the words: two identical short posts ("gm")
-- are a legitimate thing to write on different days, and rejecting the second
-- with "You've already published this link" would be a baffling error about a
-- link the person never used. Publish rate-limiting (metadataLimiter, see
-- app/api/posts/route.ts) is what actually bounds spam here.
--
-- No column is added and no data is rewritten — this only widens a CHECK
-- constraint, so it is safe to re-run and cannot fail on existing rows.
-- Idempotent.
-- =====================================================================

alter table public.posts
  drop constraint if exists posts_kind_chk;

alter table public.posts
  add constraint posts_kind_chk
  check (media_kind in ('video', 'image', 'audio', 'text'));

comment on constraint posts_kind_chk on public.posts is
  'Allowed post media kinds. ''text'' (2026-08-23) is a write-up with no media; its source_url is a synthesised frenz:text:<uuid> URI because the NOT NULL + unique dedupe pair still has to hold.';
