-- =====================================================================
-- 0101_support_chat.sql
-- Frenzsave · Support Chat — a 1:1 conversation between a member and the
-- admin team, reachable from the Support page (email support + FAQ + this
-- live chat) and answered from the admin dashboard's Support inbox.
--
-- ── Model ──────────────────────────────────────────────────────────────
-- ONE running thread per user (a support conversation, not a ticket queue),
-- with a stream of messages tagged 'user' or 'admin'. Two unread counters so
-- both sides show a badge: `admin_unread` = messages the admin hasn't read,
-- `user_unread` = admin replies the member hasn't read.
--
-- ── Security ───────────────────────────────────────────────────────────
-- RLS scopes every row to its owning member: a member reads and writes only
-- their OWN thread + messages, and can only author messages as themselves
-- (sender_id = auth.uid()). The admin side runs server-side through the
-- service role (getAdminUser-guarded actions), so it needs no broad admin
-- RLS policy — there is deliberately no policy that lets one member read
-- another's support conversation.
--
-- Idempotent; safe to re-run.
-- =====================================================================

create table if not exists public.support_threads (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  status           text not null default 'open',   -- 'open' | 'closed'
  last_message     text,
  last_message_at  timestamptz not null default now(),
  last_sender      text,                            -- 'user' | 'admin'
  user_unread      integer not null default 0,      -- admin replies the member hasn't seen
  admin_unread     integer not null default 0,      -- member messages the admin hasn't seen
  created_at       timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.support_messages (
  id           uuid primary key default gen_random_uuid(),
  thread_id    uuid not null references public.support_threads (id) on delete cascade,
  sender_id    uuid not null references auth.users (id) on delete cascade,
  sender_role  text not null,                       -- 'user' | 'admin'
  body         text not null,
  created_at   timestamptz not null default now()
);

-- Admin inbox: most-recently-active threads first.
create index if not exists support_threads_recent_idx
  on public.support_threads (last_message_at desc);

-- A thread's messages in order.
create index if not exists support_messages_thread_idx
  on public.support_messages (thread_id, created_at);

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;

drop policy if exists "support_threads self all" on public.support_threads;
create policy "support_threads self all" on public.support_threads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- A member can read every message in their own thread, and author messages
-- only as themselves. Admin replies are inserted by the service role, which
-- bypasses RLS, so they need no policy here.
drop policy if exists "support_messages own thread read" on public.support_messages;
create policy "support_messages own thread read" on public.support_messages
  for select using (
    exists (
      select 1 from public.support_threads t
      where t.id = support_messages.thread_id and t.user_id = auth.uid()
    )
  );

drop policy if exists "support_messages own thread write" on public.support_messages;
create policy "support_messages own thread write" on public.support_messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.support_threads t
      where t.id = support_messages.thread_id and t.user_id = auth.uid()
    )
  );
