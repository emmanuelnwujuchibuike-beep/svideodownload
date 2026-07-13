-- 0061_disappearing_messages.sql
-- Frenzsave · Premium Messaging V2 Part 11b: per-conversation disappearing
-- messages. NULL = off (the existing default for every conversation).
-- Cleanup is a cron job (app/api/cron/disappearing-messages) soft-deleting
-- expired rows via the same `messages.deleted_at` column normal message
-- deletion already uses — no new message-level state needed.

alter table public.conversations
  add column if not exists disappear_after_seconds int;

alter table public.conversations
  drop constraint if exists conversations_disappear_after_chk;
alter table public.conversations
  add constraint conversations_disappear_after_chk
  check (disappear_after_seconds is null or disappear_after_seconds > 0);

-- Cheap lookup for the cron job: only conversations with the feature on.
create index if not exists conversations_disappear_after_idx
  on public.conversations (disappear_after_seconds)
  where disappear_after_seconds is not null;
