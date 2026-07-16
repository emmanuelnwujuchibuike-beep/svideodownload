-- =====================================================================
-- 0081_reshare_permissions.sql
-- Frenzsave · Resharing, and the author's control over it.
--
-- Owner ask (2026-07-16):
--   "make a way users can reshare media sent to them in chat to story, feed and
--    reels, and users should be able to reshare a friends stories to their own
--    stories or private chat no where else, and users who made the posts on
--    stories or who sent the media in chat can set the media to be reshare or
--    not."
--
-- Two permissions, each owned by the person who published the thing:
--   * messages.allow_reshare — the SENDER decides whether media they sent in a
--     chat may be lifted out of that chat into a post/reel/story.
--   * stories.allow_reshare  — the AUTHOR decides whether their story may be
--     reshared to someone else's story or forwarded into a private chat.
--
-- Default TRUE on both: resharing is the feature being added, and defaulting to
-- false would ship it switched off for every existing message and story. The
-- control exists so an author can opt OUT of something that is otherwise
-- already visible to the viewer — a chat recipient can already screenshot a
-- photo, so this is an honest social signal, not a security boundary. It is
-- still enforced SERVER-side (see lib/social/reshare.ts) so it can't be
-- bypassed by a crafted request.
--
-- Destination rules are deliberately NOT encoded here — they're product logic
-- (a story may only go to a story or a private chat; chat media may go to
-- feed/reel/story) and live in one place in lib/social/reshare.ts rather than
-- being split between a CHECK constraint and the app.
--
-- Idempotent.
-- =====================================================================

alter table public.messages
  add column if not exists allow_reshare boolean not null default true;

alter table public.stories
  add column if not exists allow_reshare boolean not null default true;

-- Provenance: what a reshared post/story came from. Nullable — the vast
-- majority of posts are original. Kept as plain columns (not a join table)
-- because a reshare has exactly one source by definition.
alter table public.posts
  add column if not exists reshared_from_story_id uuid references public.stories (id) on delete set null;

alter table public.stories
  add column if not exists reshared_from_story_id uuid references public.stories (id) on delete set null;

alter table public.stories
  add column if not exists reshared_from_user_id uuid references auth.users (id) on delete set null;

create index if not exists stories_reshared_from_idx
  on public.stories (reshared_from_story_id)
  where reshared_from_story_id is not null;
