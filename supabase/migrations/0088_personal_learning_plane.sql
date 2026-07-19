-- =====================================================================
-- 0088_personal_learning_plane.sql
-- Frenzsave · The personal plane over the learning and support corpora:
-- what a signed-in reader has completed, saved for later, and written down.
--
-- ── One row per (user, item), not three tables ────────────────────────
-- Completion, bookmarking and a private note are three facts about the
-- SAME relationship: this reader and this item. They are always read
-- together (a lesson page needs all three at once), they share a key, and
-- splitting them would mean three tables, three RLS policies and three
-- round trips to render one badge. So one row carries all three, each
-- independently nullable — a note without a bookmark is perfectly normal.
--
-- ── Why not extend `collections` (0027) ───────────────────────────────
-- That system is genuinely a bookmark store, and reusing it was the first
-- thing considered. It cannot hold these items: `collection_items.post_id`
-- references `posts`, so a lesson or a help article has nowhere to go, and
-- widening it to a polymorphic reference would loosen a constraint that is
-- currently doing real work for social content. Separate concern, separate
-- table, stated here so the next person does not re-litigate it.
--
-- ── Why the item is (kind, slug) text, not a foreign key ──────────────
-- Lessons and support articles live in TypeScript, not in tables — they are
-- compiled content (see lib/learning, lib/support). There is nothing for a
-- foreign key to reference. Validation therefore happens in the API against
-- the real corpora, and `lib/personal/items.test.ts` pins that every stored
-- kind resolves to a real page. A CHECK on `item_kind` keeps the column
-- honest at the database level for the part the database can actually know.
--
-- ── Courses and schools are deliberately absent ───────────────────────
-- A course's progress is DERIVED from the completion of its lessons
-- (`courseLessons()`), never stored. Storing it would create a second
-- source of truth that drifts the moment a course's lesson list changes —
-- the same declare-vs-derive rule the rest of this codebase follows.
--
-- Idempotent; safe to re-run.
-- =====================================================================

create table if not exists public.personal_learning_items (
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- 'lesson'  → /learn/<slug>
  -- 'article' → /help/<slug> or /trust/<slug> (one corpus, two centres —
  --             the URL is derived by lib/support's articleHref, so this
  --             column stores the slug and nothing about the route)
  item_kind   text not null check (item_kind in ('lesson', 'article')),
  item_slug   text not null,

  -- Each of the three facts is independently optional, and each is a
  -- TIMESTAMP rather than a boolean. "When did I finish this" is strictly
  -- more information than "did I", it costs the same eight bytes, and it is
  -- what any future "continue where you left off" or streak feature needs.
  -- A boolean here would have to be widened later, on a table with rows in
  -- it, which is the migration nobody wants to write.
  completed_at   timestamptz,
  bookmarked_at  timestamptz,
  last_viewed_at timestamptz,

  -- A private note. Never shown to anyone else, never indexed for search,
  -- never sent to the assistant — see the API route and the search index
  -- test that pins "nothing personal enters it".
  note        text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  primary key (user_id, item_kind, item_slug)
);

-- The reader's own lists: "what have I saved", "what have I finished".
-- Partial indexes because the overwhelming majority of rows are neither —
-- a row exists as soon as an item is viewed, and indexing the nulls would
-- be indexing the common case to serve the rare one.
create index if not exists personal_learning_bookmarked_idx
  on public.personal_learning_items (user_id, bookmarked_at desc)
  where bookmarked_at is not null;

create index if not exists personal_learning_completed_idx
  on public.personal_learning_items (user_id, completed_at desc)
  where completed_at is not null;

-- ── RLS: self-owned, read and write ──────────────────────────────────
-- Same idiom as user_home_preferences (0040) and chat_appearance_preferences
-- (0077). Note this is a plane over PUBLIC content, but the plane itself is
-- private: which lessons someone is reading is a real signal about them
-- (the security school, the privacy articles), and it belongs to nobody but
-- them. There is deliberately no policy granting anyone else read access,
-- including for aggregate stats — an aggregate is a separate decision, and
-- it should be made explicitly rather than fall out of a loose policy.
alter table public.personal_learning_items enable row level security;

drop policy if exists "personal_learning_items self all" on public.personal_learning_items;
create policy "personal_learning_items self all" on public.personal_learning_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Keep updated_at honest without the application having to remember.
create or replace function public.touch_personal_learning_items()
returns trigger language plpgsql as $$
begin
  NEW.updated_at = now();
  return NEW;
end $$;

drop trigger if exists personal_learning_items_touch on public.personal_learning_items;
create trigger personal_learning_items_touch
  before update on public.personal_learning_items
  for each row execute function public.touch_personal_learning_items();
