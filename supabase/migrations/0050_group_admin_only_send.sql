-- =====================================================================
-- FrenzSave — group "only admins can send" toggle. Owner ask (2026-07-12):
-- "make owner or admin set a group for members to chat or turn members
-- chat off so only owner or admin can send message in group." Purely
-- additive, idempotent, defaults to false (today's unrestricted behavior
-- for every existing group).
-- =====================================================================
set lock_timeout = '5s';

alter table public.conversations
  add column if not exists only_admins_can_send boolean not null default false;
