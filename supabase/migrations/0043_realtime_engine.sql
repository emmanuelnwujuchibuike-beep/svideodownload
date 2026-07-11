-- =====================================================================
-- FrenzSave — Premium Messaging V2 Part 3: real-time delivery engine,
-- live presence, multi-device sync, offline reliability. Purely additive.
-- Idempotent.
--
-- Explicitly OUT of scope (see docs/PROJECT_NOTES.md for the writeup):
-- literal multi-region/dedicated-connection-pool infra (Supabase Realtime
-- + this project's already-chosen cdg1 region ARE that layer — nothing to
-- build in application code), ML-based abuse detection (no training data),
-- and any state tied to features that don't exist yet — voice notes,
-- attachments, calls, E2E encryption (all owner-deferred in Part 1/2).
--
-- This app is LIVE — `messages`/`message_reactions` take real read/write
-- traffic while this runs. The ADD COLUMN + CREATE TRIGGER below need an
-- AccessExclusiveLock on those tables; a concurrent request touching both
-- tables in the opposite acquisition order (e.g. the reactions route reads
-- `messages` then writes `message_reactions`) can produce a genuine
-- Postgres deadlock (40P01) — Postgres's own detector just aborts one side,
-- nothing is corrupted, and simply re-running this script succeeds once the
-- colliding transaction has moved on. `lock_timeout` turns that "wait a
-- while, maybe deadlock" window into an immediate, safely-retryable failure
-- instead, so a busy moment fails fast rather than hanging.
-- =====================================================================
set lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- Idempotent send: a client-generated key so a replayed offline-queue
-- send (e.g. two "online" events firing in quick succession) can never
-- create a duplicate message — sendMessage() upserts on this instead of
-- blindly inserting. Scoped to (conversation, sender) rather than a bare
-- global-uniqueness assumption on the client's UUID generation.
--
-- forwarded_from_id: message forwarding (a real "Forwarded" state needs a
-- real forward feature, not just a label).
--
-- client_sent_at: client-provided send timestamp, ONLY for a real
-- client→server latency metric (the monitoring view) — never used for
-- ordering/authority, which stays server `created_at` as before.
--
-- updated_at: delta-sync signal — "give me anything that changed since
-- last sync" instead of always re-fetching the last 300 messages. Touched
-- by the trigger below on any real mutation (edit/delete/receipt/pin),
-- AND by a second trigger when a reaction on that message changes (a
-- reaction lives in a different table, so the message's own UPDATE
-- statement never naturally fires without an explicit touch).
-- ---------------------------------------------------------------------
alter table public.messages
  add column if not exists client_id         text,
  add column if not exists client_sent_at     timestamptz,
  add column if not exists forwarded_from_id  uuid references public.messages (id) on delete set null,
  add column if not exists updated_at         timestamptz not null default now();

create unique index if not exists messages_client_id_uidx
  on public.messages (conversation_id, sender_id, client_id) where client_id is not null;
create index if not exists messages_updated_at_idx on public.messages (conversation_id, updated_at);
create index if not exists messages_forwarded_from_idx on public.messages (forwarded_from_id) where forwarded_from_id is not null;

create or replace function public.touch_message_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists messages_touch_updated_at_trg on public.messages;
create trigger messages_touch_updated_at_trg
  before update on public.messages
  for each row execute function public.touch_message_updated_at();

-- A reaction changing doesn't fire an UPDATE on `messages` itself — touch
-- the parent explicitly so delta-sync (keyed on messages.updated_at) picks
-- up reaction changes too, not just edits/deletes/receipts.
create or replace function public.touch_message_on_reaction_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.messages set updated_at = now() where id = coalesce(new.message_id, old.message_id);
  return null;
end $$;

drop trigger if exists message_reactions_touch_msg_trg on public.message_reactions;
create trigger message_reactions_touch_msg_trg
  after insert or update or delete on public.message_reactions
  for each row execute function public.touch_message_on_reaction_change();

-- ---------------------------------------------------------------------
-- Presence status (Away/Busy/Do Not Disturb/Invisible — "Available" is
-- the unset default). Deliberately its OWN table with NO cross-user read
-- policy, not a column on `profiles` (which is broadly selected all over
-- the app) — "Invisible" only means something if the raw value can never
-- leak via a general profile fetch. Cross-user reads go through
-- `getDisplayedPresenceStatus()` in the service layer, which applies the
-- privacy transform (invisible → shown as unset/offline to everyone but
-- the owner), mirroring muted_creators' "must never be discoverable via a
-- readable table" precedent.
-- ---------------------------------------------------------------------
create table if not exists public.user_presence_status (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  status     text not null default 'available' check (status in ('available', 'away', 'busy', 'dnd', 'invisible')),
  updated_at timestamptz not null default now()
);
alter table public.user_presence_status enable row level security;
drop policy if exists "presence status self all" on public.user_presence_status;
create policy "presence status self all" on public.user_presence_status
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- No select policy for other users — intentional; see comment above.

-- ---------------------------------------------------------------------
-- Send-failure log — the real, honest version of a "dead letter queue" at
-- this app's actual scale: not a literal separate queue infrastructure,
-- but a genuine persisted record of a message that exhausted client-side
-- retries, so "queue health"/"retry count"/"error rate" in the monitoring
-- view are real numbers, not placeholders. Written best-effort by the
-- client when it gives up retrying (see lib/offline/message-queue.ts).
-- ---------------------------------------------------------------------
create table if not exists public.message_send_failures (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  client_id       text,
  reason          text,
  attempts        integer not null default 1,
  created_at      timestamptz not null default now()
);
create index if not exists message_send_failures_user_idx on public.message_send_failures (user_id, created_at desc);

alter table public.message_send_failures enable row level security;
drop policy if exists "send failures self insert" on public.message_send_failures;
create policy "send failures self insert" on public.message_send_failures
  for insert with check (auth.uid() = user_id);
drop policy if exists "send failures self read" on public.message_send_failures;
create policy "send failures self read" on public.message_send_failures
  for select using (auth.uid() = user_id);
-- Admin-only aggregate reads (the monitoring view) go through the service
-- role, same as every other admin surface in this codebase.

-- ---------------------------------------------------------------------
-- Realtime Authorization for typing indicators — ephemeral Presence, no
-- table backing it, scoped to active conversation members only. Without
-- this policy a private channel simply rejects every join (fails closed,
-- per Supabase's own docs), so this is required infrastructure, not
-- hardening on top of something that already worked. Topic shape:
-- `typing:<conversationId>`.
-- ---------------------------------------------------------------------
drop policy if exists "typing presence conversation members" on realtime.messages;
create policy "typing presence conversation members" on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension in ('presence')
    and split_part(realtime.topic(), ':', 1) = 'typing'
    and exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = (split_part(realtime.topic(), ':', 2))::uuid
        and cm.user_id = (select auth.uid())
        and cm.left_at is null
    )
  );

drop policy if exists "typing presence conversation members write" on realtime.messages;
create policy "typing presence conversation members write" on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension in ('presence')
    and split_part(realtime.topic(), ':', 1) = 'typing'
    and exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = (split_part(realtime.topic(), ':', 2))::uuid
        and cm.user_id = (select auth.uid())
        and cm.left_at is null
    )
  );
