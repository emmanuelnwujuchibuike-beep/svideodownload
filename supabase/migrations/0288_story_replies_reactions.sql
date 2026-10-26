-- ═══════════════════════════════════════════════════════════════════════════
--  0288 — the new Story viewer: "Allow replies" and reactions (2026-10-26)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The Story Viewer design (design/Frenz-Story-Viewer-design.zip) shows two
-- things the database could not answer:
--
--   Story options → "Allow replies"   the author's own switch, per story, next
--       to the existing "Allow resharing" (allow_reshare, 0081). Off: the reply
--       box and the quick reactions are hidden, and POST /api/stories/reply
--       refuses a reply that names this story.
--   Seen by → "Reactions", and the heart on a viewer's face   who reacted to
--       THIS story. A reaction (Love it, Fire, Wow, the heart, a double-tap, a
--       one-emoji reply) is still delivered as a direct message, as it always
--       was. This only records that it happened, so the author can count it.
--
-- One row per person per story: reacting again replaces the emoji, so the count
-- is people, not taps. It dies with the story (ON DELETE CASCADE), the same as
-- story_views (0181) — and like story_views, only the story's AUTHOR may read it,
-- and nobody writes it except the server.
--
-- 0285 and 0287 are not touched. A member session still cannot update a story:
-- the switch is written by PATCH /api/stories/:id on the service role after it
-- has checked the story is the member's own. The 0285 expiry trigger runs on
-- that update too, so the switch can never stretch a story's life.
--
-- ── 🔴 Runner rules (see lib/platform/migration-strings.test.ts) ────────────
-- Plain statements only, no dollar-quoted body, no semicolon inside a string.

-- ── 1 · the author's switch ────────────────────────────────────────────────
alter table public.stories
  add column if not exists allow_replies boolean not null default true;

-- ── 2 · who reacted ────────────────────────────────────────────────────────
create table if not exists public.story_reactions (
  story_id    uuid not null references public.stories (id) on delete cascade,
  reactor_id  uuid not null references auth.users (id) on delete cascade,
  emoji       text not null check (char_length(emoji) between 1 and 16),
  reacted_at  timestamptz not null default now(),
  primary key (story_id, reactor_id)
);

-- The author's question: "who reacted to this one?", newest first.
create index if not exists story_reactions_story_idx
  on public.story_reactions (story_id, reacted_at desc);

alter table public.story_reactions enable row level security;

drop policy if exists "story_reactions author read" on public.story_reactions;
create policy "story_reactions author read" on public.story_reactions
  for select to authenticated
  using (
    exists (
      select 1 from public.stories s
      where s.id = story_reactions.story_id
        and s.user_id = (select auth.uid())
    )
  );

revoke all on table public.story_reactions from anon;
revoke insert, update, delete, truncate, references, trigger on table public.story_reactions from authenticated;
grant select on table public.story_reactions to authenticated;
