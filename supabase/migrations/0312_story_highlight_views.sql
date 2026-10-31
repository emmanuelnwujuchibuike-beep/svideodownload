-- ═══════════════════════════════════════════════════════════════════════════
--  0312 — Who viewed a highlight (owner, 2026-10-31)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-31: "I want users to see who views their highlight."
--
--   story_highlight_views   one row per (highlight, viewer): the FIRST time somebody else opened it. Re-opening it
--                           does not add a row or move viewed_at — the owner cares who saw it and when they first did.
--
-- Access is the highlights model (0289): anon and authenticated have no table access at all. The server
-- (lib/social/story-highlights.ts) writes a view only when the viewer may see the owner's stories (the same
-- canSeeStoriesOf rule that lets them open it) and never for the owner themself; the list is read for the
-- highlight's OWNER only. It dies with the highlight (ON DELETE CASCADE) and with the viewer's account.

create table if not exists public.story_highlight_views (
  highlight_id  uuid not null references public.story_highlights (id) on delete cascade,
  viewer_id     uuid not null references auth.users (id) on delete cascade,
  viewed_at     timestamptz not null default now(),
  primary key (highlight_id, viewer_id)
);

-- The owner's question: "who has seen this one?", newest first.
create index if not exists story_highlight_views_recent_idx on public.story_highlight_views (highlight_id, viewed_at desc);
create index if not exists story_highlight_views_viewer_idx on public.story_highlight_views (viewer_id);

alter table public.story_highlight_views enable row level security;

revoke all on table public.story_highlight_views from anon;
revoke all on table public.story_highlight_views from authenticated;
