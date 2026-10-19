-- 0262 — New-message email (owner, 2026-10-18: "Users should receive messages through email and push
-- but they can turn off email notification in chat if they have installed the app to use push").
--
--   notification_settings.message_email   true (the default, every existing member) or false. Turned
--                                         off only from a member who has push on a device — the server
--                                         refuses otherwise (lib/social/message-email.ts), so nobody
--                                         can switch off the one channel that reaches them with the
--                                         app closed. The global optional-email switch (0253) still
--                                         silences it too: a message email is OPTIONAL email.
--   message_email_sends                   one row per (member, conversation): when that chat last
--                                         emailed them. A new message emails only when nothing has
--                                         been sent since the member last read the chat, at most once
--                                         an hour — one email per batch of unread messages, never one
--                                         per message. Written by the server only (no policy).
--
-- Additive and idempotent. No semicolon inside any quoted string. Every dollar-quoted block is at the end.

alter table public.notification_settings add column if not exists message_email boolean not null default true;
comment on column public.notification_settings.message_email is '0262: email me new messages. Off only when the member has push on a device.';

create table if not exists public.message_email_sends (
  user_id         uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sent_at         timestamptz not null default now(),
  primary key (user_id, conversation_id)
);
alter table public.message_email_sends add column if not exists sent_at timestamptz not null default now();
comment on table public.message_email_sends is '0262: when a conversation last emailed a member about new messages (the once-per-unread-batch throttle).';
alter table public.message_email_sends enable row level security;
-- no policy: only the server reads or writes it
