-- 0075_conversation_preview_system_message.sql
-- Frenzsave · WhatsApp-style in-chat system notice for disappearing-messages
-- changes (owner ask, 2026-07-14) — a real message with metadata.kind =
-- 'system' and an empty body. Migration 0074's sync_conversation_preview()
-- didn't know about this new kind, so a system message's empty body fell
-- through to the `else left(latest.body, 140)` branch — a BLANK inbox
-- preview instead of showing the notice text. Same trigger, same columns,
-- adds the missing case.
set lock_timeout = '5s';

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
      when latest.metadata->>'kind' = 'system' then left(coalesce(latest.metadata->>'text', ''), 140)
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
