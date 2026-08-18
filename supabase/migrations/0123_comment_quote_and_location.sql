-- =====================================================================
-- FrenzSave — Feature 15 Part 5 tranche 4: Quote Reply + Location comment
-- types. Additive + idempotent; both degrade gracefully (comments never
-- vanish) if this hasn't run yet, same EXT/BASE fallback engagement.ts
-- already uses for every prior comment migration.
-- =====================================================================

-- Quote Reply — deliberately a SEPARATE reference from parent_id: a quote
-- can attach to any comment on the post, not only the one being structurally
-- replied to (you can quote a comment from earlier in the thread while
-- posting a fresh top-level comment). `on delete set null` — if the quoted
-- comment is later deleted, the quoting comment survives; it just loses the
-- reference rather than cascading away someone else's comment.
alter table public.post_comments
  add column if not exists quoted_comment_id uuid references public.post_comments (id) on delete set null;
create index if not exists post_comments_quoted_idx on public.post_comments (quoted_comment_id) where quoted_comment_id is not null;

-- Location — same "no paid map API key" approach conversation-room.tsx
-- already uses for message location shares (browser Geolocation +
-- Nominatim reverse-geocode, done client-side; only the result is stored).
alter table public.post_comments
  add column if not exists location_lat   double precision,
  add column if not exists location_lng   double precision,
  add column if not exists location_label text;
