-- =====================================================================
-- FrenzSave — Premium Messaging V2 Part 10: message search + starred
-- messages. Purely additive, idempotent.
--
-- SCOPE (see docs/PROJECT_NOTES.md's Part 10 entry for the full writeup):
-- the owner's spec described a "world's smartest" search platform — AI
-- semantic search, voice search, visual/OCR search, a knowledge graph,
-- cross-product search into Communities/Marketplace/Business Chats/AI
-- Chats/Life Memories/Cloud Files (none of which exist in this app), and
-- 100M-user distributed indexing infrastructure. This migration builds the
-- real, honest core instead: full-text search over messages you can
-- actually see, and a genuine per-user "starred messages" save feature.
-- Everything else is an explicit, documented deferral, not a silent gap —
-- same scoping discipline as Part 8/9.
-- =====================================================================
set lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- Full-text search index. A generated column (not a manually-maintained
-- one) so it can never drift from `body` — Postgres recomputes it on every
-- INSERT/UPDATE automatically. GIN index is what makes `@@`/`textSearch()`
-- queries fast instead of a sequential scan.
-- ---------------------------------------------------------------------
alter table public.messages
  add column if not exists body_tsv tsvector
  generated always as (to_tsvector('english', coalesce(body, ''))) stored;

create index if not exists messages_body_tsv_idx on public.messages using gin (body_tsv);

-- ---------------------------------------------------------------------
-- Starred messages — distinct from the existing in-thread `messages.pinned`
-- (visible to everyone in the conversation, one pin surfaces at the top of
-- the thread for the whole group) — starring is a PRIVATE, personal save,
-- same distinction WhatsApp/Telegram/Slack all draw between "pinned" and
-- "starred/saved". Direct table (not a column on `messages`) since it's
-- inherently per-(user, message), not a property of the message itself.
-- ---------------------------------------------------------------------
create table if not exists public.starred_messages (
  user_id    uuid not null references auth.users (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
create index if not exists starred_messages_user_idx on public.starred_messages (user_id, created_at desc);

alter table public.starred_messages enable row level security;
drop policy if exists "starred messages self all" on public.starred_messages;
create policy "starred messages self all" on public.starred_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- No membership check in the RLS policy itself (mirrors `message_reactions`'
-- own precedent) — the API route verifies active conversation membership
-- before allowing a star, same trust boundary as reacting to a message.
