-- 0071_message_polls.sql
-- Frenzsave · Premium Messaging inbox mockup completion: in-chat polls (new
-- attachment-sheet tile). Single-choice, no anonymous mode — the real,
-- buildable slice of what a fuller poll product could become. Mirrors
-- `message_reactions`'s shape/RLS split exactly (0041): conversation_id is
-- denormalized onto both tables for a cheap direct membership check (no join
-- through `messages`/`message_polls` on every read), reads are member-wide,
-- writes are self-scoped — same reasoning: `postgres_changes` enforces RLS
-- on realtime delivery, so a self-only read policy would silently stop every
-- OTHER participant from ever seeing a live vote tally update.
--
-- No client INSERT for `message_polls` itself (created server-side alongside
-- the parent message, same D1 rule `messages`/`message_attachments` already
-- follow) — only votes are client-direct, for low-latency tapping.
set lock_timeout = '5s';

create table if not exists public.message_polls (
  id              uuid primary key default uuid_generate_v4(),
  message_id      uuid not null references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  question        text not null check (char_length(question) <= 300),
  options         jsonb not null,
  created_by      uuid references auth.users (id) on delete set null,
  closes_at       timestamptz,
  created_at      timestamptz not null default now(),
  unique (message_id)
);
create index if not exists message_polls_conversation_idx on public.message_polls (conversation_id);

create table if not exists public.message_poll_votes (
  poll_id         uuid not null references public.message_polls (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  option_index    integer not null,
  created_at      timestamptz not null default now(),
  primary key (poll_id, user_id)
);
create index if not exists message_poll_votes_poll_idx on public.message_poll_votes (poll_id);

alter table public.message_polls enable row level security;
drop policy if exists "message_polls member read" on public.message_polls;
create policy "message_polls member read" on public.message_polls
  for select using (
    exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = message_polls.conversation_id
        and cm.user_id = auth.uid() and cm.left_at is null
    )
  );

alter table public.message_poll_votes enable row level security;

drop policy if exists "message_poll_votes member read" on public.message_poll_votes;
create policy "message_poll_votes member read" on public.message_poll_votes
  for select using (
    exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = message_poll_votes.conversation_id
        and cm.user_id = auth.uid() and cm.left_at is null
    )
  );

drop policy if exists "message_poll_votes self insert" on public.message_poll_votes;
create policy "message_poll_votes self insert" on public.message_poll_votes
  for insert with check (
    auth.uid() = user_id
    and conversation_id = (select p.conversation_id from public.message_polls p where p.id = message_poll_votes.poll_id)
    and exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = message_poll_votes.conversation_id
        and cm.user_id = auth.uid() and cm.left_at is null
    )
  );

drop policy if exists "message_poll_votes self update" on public.message_poll_votes;
create policy "message_poll_votes self update" on public.message_poll_votes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "message_poll_votes self delete" on public.message_poll_votes;
create policy "message_poll_votes self delete" on public.message_poll_votes
  for delete using (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_polls'
  ) then
    alter publication supabase_realtime add table public.message_polls;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_poll_votes'
  ) then
    alter publication supabase_realtime add table public.message_poll_votes;
  end if;
end $$;
