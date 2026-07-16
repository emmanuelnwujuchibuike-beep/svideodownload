-- =====================================================================
-- 0078_chat_appearance_per_conversation.sql
-- Frenzsave · Chat appearance is now PER-CONVERSATION, not per-user, and the
-- table carries NO value CHECK constraint.
--
-- Owner correction (2026-07-16): "the chat bubble in chat should be only
-- changed in the particular chat that the bubble style, color and all was set,
-- not in all chats." This reverses 0077's per-USER design ("reflect in both
-- chats") — each conversation now carries its own font style + bubble
-- style/color for the viewer, scoped to that thread alone.
--
-- Context (verified against the LIVE database 2026-07-16): the production
-- `chat_appearance_preferences` table had ALREADY diverged from 0077 as
-- written — it already has a `conversation_id` column and a composite
-- `(user_id, conversation_id)` primary key, and its old value CHECK
-- constraints are already gone. The shipped APP code, however, was still
-- writing the old per-user shape (`onConflict: "user_id"`, no conversation_id),
-- which fails outright ("no unique or exclusion constraint matching the ON
-- CONFLICT specification") — THAT was the real "font style / bubble style
-- can't save" bug, not a CHECK rejection. The app fix (send conversation_id +
-- onConflict user_id,conversation_id) matches that live shape and works with
-- or without this migration.
--
-- This migration therefore only has to guarantee the shape on any environment
-- that is NOT already there (a fresh DB that just ran 0077, or a local copy).
-- It is deliberately NON-DESTRUCTIVE and fully idempotent — it never drops the
-- table (production may already hold real rows once saves start working) and
-- no-ops cleanly where the target shape already exists.
--
-- Column stays named `font_size` for continuity with the row mapper
-- (lib/social/chat-appearance.ts) even though it stores a font STYLE id.
-- =====================================================================

-- 1. Per-conversation column (no-op if already present, as on production).
alter table public.chat_appearance_preferences
  add column if not exists conversation_id uuid references public.conversations (id) on delete cascade;

-- 2. Drop 0077's stale value CHECK constraints (auto-named). The app's zod enum
--    is the single source of truth for valid font/bubble ids — a DB CHECK just
--    invites exactly the size→style drift that started this. `if exists` makes
--    this a no-op where they're already gone (production).
alter table public.chat_appearance_preferences drop constraint if exists chat_appearance_preferences_font_size_check;
alter table public.chat_appearance_preferences drop constraint if exists chat_appearance_preferences_bubble_style_check;

-- 3. Promote the primary key to (user_id, conversation_id) — but only if it's
--    still the old single-column per-user PK. Where it's already composite
--    (production), this whole block is skipped.
do $$
declare
  pk_cols int;
begin
  select count(*) into pk_cols
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
  where tc.table_schema = 'public'
    and tc.table_name = 'chat_appearance_preferences'
    and tc.constraint_type = 'PRIMARY KEY';

  if pk_cols = 1 then
    -- Old per-user rows have no conversation and no meaning under the new
    -- per-thread semantics — clear them before conversation_id goes NOT NULL.
    delete from public.chat_appearance_preferences where conversation_id is null;
    alter table public.chat_appearance_preferences drop constraint chat_appearance_preferences_pkey;
    alter table public.chat_appearance_preferences alter column conversation_id set not null;
    alter table public.chat_appearance_preferences
      add constraint chat_appearance_preferences_pkey primary key (user_id, conversation_id);
  end if;
end $$;

-- 4. RLS policy is unchanged in spirit (self-owned rows) — reassert idempotently.
alter table public.chat_appearance_preferences enable row level security;
drop policy if exists "chat_appearance_preferences self all" on public.chat_appearance_preferences;
create policy "chat_appearance_preferences self all" on public.chat_appearance_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
