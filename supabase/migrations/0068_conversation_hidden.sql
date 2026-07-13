-- 0068_conversation_hidden.sql
-- Frenzsave · Premium Messaging inbox mockup completion: per-user "Delete
-- conversation" from the inbox swipe actions. Deliberately NOT a real delete
-- of shared data (other members still see everything) — a soft per-member
-- hide, same idea `archived` already uses, except a hidden conversation
-- automatically reappears the moment new activity lands (archived does not
-- — that's an intentional, existing difference the owner's Unarchive flow
-- already relies on). NULL = never hidden (the default for every existing
-- member row).

alter table public.conversation_members
  add column if not exists hidden_at timestamptz;
