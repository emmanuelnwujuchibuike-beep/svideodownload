-- 0060_message_privacy_settings.sql
-- Frenzsave · Premium Messaging V2 Part 11b: granular message-privacy
-- controls, extending the existing `privacy_settings` self-owned-row table
-- (same idiom as 0026_profile_tab_privacy.sql).

alter table public.privacy_settings
  add column if not exists read_receipts_enabled boolean not null default true,
  add column if not exists typing_indicators_enabled boolean not null default true,
  add column if not exists last_seen_visibility text not null default 'everyone'
    check (last_seen_visibility in ('everyone', 'friends', 'nobody')),
  add column if not exists group_invite_policy text not null default 'everyone'
    check (group_invite_policy in ('everyone', 'friends', 'nobody'));
