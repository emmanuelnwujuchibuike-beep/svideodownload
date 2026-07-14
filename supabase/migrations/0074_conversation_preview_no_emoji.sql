-- 0074_conversation_preview_no_emoji.sql
-- Frenzsave · Owner correction (2026-07-14): "i told earlier should never
-- use emoji for any editing and identification, use icons like the ones at
-- the bottom nav." Migration 0072 synthesized the inbox row's preview text
-- for a Location/Contact/Poll message using literal emoji (📍/👤/📊) baked
-- directly into `last_body` — a standing app-wide rule this violated. Two
-- fixes: (1) the synthesized text itself is now plain, no emoji; (2) a new
-- `last_message_kind` column lets the CLIENT render a real Lucide icon next
-- to that text (ConversationRow) instead of leaning on an emoji character
-- baked into the string to convey what kind of message it was.
set lock_timeout = '5s';

alter table public.conversations
  add column if not exists last_message_kind text;

alter table public.conversations
  drop constraint if exists conversations_last_message_kind_chk;
alter table public.conversations
  add constraint conversations_last_message_kind_chk
  check (last_message_kind is null or last_message_kind in ('location', 'contact', 'poll'));

create or replace function public.sync_conversation_preview()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target_conv uuid := coalesce(NEW.conversation_id, OLD.conversation_id);
  latest record;
begin
  select id, body, sender_id, created_at, metadata into latest
  from public.messages
  where conversation_id = target_conv and deleted_at is null
  order by created_at desc
  limit 1;

  update public.conversations set
    last_message_at = coalesce(latest.created_at, last_message_at),
    last_body        = case
      when latest.id is null then null
      when latest.body is not null and latest.body <> '' then left(latest.body, 140)
      when latest.metadata->>'kind' = 'location' then 'Location'
      when latest.metadata->>'kind' = 'contact' then coalesce('Contact: ' || (latest.metadata->>'displayName'), 'Contact')
      when latest.metadata->>'kind' = 'poll' then 'Poll'
      else left(latest.body, 140)
    end,
    last_message_kind = case
      when latest.metadata->>'kind' in ('location', 'contact', 'poll') then latest.metadata->>'kind'
      else null
    end,
    last_sender_id   = latest.sender_id
  where id = target_conv;

  update public.conversation_members
    set updated_at = now()
    where conversation_id = target_conv and left_at is null;

  return null;
end $$;
