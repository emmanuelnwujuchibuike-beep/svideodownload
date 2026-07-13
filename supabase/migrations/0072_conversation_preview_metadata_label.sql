-- 0072_conversation_preview_metadata_label.sql
-- Frenzsave · Premium Messaging inbox mockup completion: a Location/Contact/
-- Poll message has an empty `body` (its content lives in `metadata`, see
-- migration 0070's header) — `sync_conversation_preview()` (0041) truncated
-- `body` verbatim into `conversations.last_body`, so these sends made the
-- inbox row's preview text go BLANK instead of showing something. Same
-- trigger, same columns touched — just teaches it to synthesize a friendly
-- label from `metadata.kind` when `body` is empty.
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
      when latest.metadata->>'kind' = 'location' then '📍 Location'
      when latest.metadata->>'kind' = 'contact' then '👤 Contact'
      when latest.metadata->>'kind' = 'poll' then '📊 Poll'
      else left(latest.body, 140)
    end,
    last_sender_id   = latest.sender_id
  where id = target_conv;

  update public.conversation_members
    set updated_at = now()
    where conversation_id = target_conv and left_at is null;

  return null;
end $$;
