-- ═══════════════════════════════════════════════════════════════════════════
--  0295 — message-request notifications by push and email, each with its own switch (2026-10-27)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "Make users to be able to receive messages request through push and email when someone who they don't
-- follow or friends with send them a message but without showing the message, just the request push or email,
-- depends on which the users switch on."
--
-- ── What a message request is ───────────────────────────────────────────────
--   A one-to-one chat (direct or secret) where the RECIPIENT does not follow the sender, they are not friends, and
--   the recipient has never replied. Such a message is announced as a request — the sender's name and nothing of the
--   message — instead of as a message with its preview. Once the recipient follows, befriends or replies, it is an
--   ordinary chat again (lib/social/message-request.ts decides, at send time).
--
-- ── The member's two switches (notification_settings) ───────────────────────
--   message_request_push   push me when someone new sends me a message request   (default true)
--   message_request_email  email me when someone new sends me a message request  (default true)
--   Independent: changing one never touches the other. On by default, the policy every per-event switch here follows
--   (0262 message_email, 0294 gift_push / gift_email). The global controls still apply on top: master / push / quiet
--   hours / delivery rules for push, and the global optional-email switch (0253) for email — a request email is
--   OPTIONAL email (lib/email/consent.ts message_request). The 0046 policy already scopes the row to its owner.
--
-- ── Once per chat (message_request_notices) ─────────────────────────────────
--   One row per (recipient, conversation): the first message of a request claims it (insert, conflict = someone
--   already did) and only that caller notifies. A stranger sending ten messages is ONE request, not ten alerts, and
--   two messages a moment apart cannot both notify. No content — who, which chat, when. Server only.
--
-- Depends on 0046 (notification_settings), 0041 (conversations). Safe to run twice.
-- No semicolon inside any quoted string or comment. No dollar-quoted block.

alter table public.notification_settings add column if not exists message_request_push boolean not null default true;
alter table public.notification_settings add column if not exists message_request_email boolean not null default true;
comment on column public.notification_settings.message_request_push is '0295: push me when someone I do not follow and am not friends with sends me a message request. No message content is ever pushed. Independent of message_request_email.';
comment on column public.notification_settings.message_request_email is '0295: email me when someone I do not follow and am not friends with sends me a message request. No message content is ever emailed. Independent of message_request_push. The global optional-email switch (0253) still applies.';

create table if not exists public.message_request_notices (
  user_id          uuid not null references auth.users (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  sender_id        uuid not null references auth.users (id) on delete cascade,
  notified_at      timestamptz not null default now(),
  primary key (user_id, conversation_id)
);
alter table public.message_request_notices enable row level security;
revoke all on public.message_request_notices from public, anon, authenticated;
grant all on public.message_request_notices to service_role;
comment on table public.message_request_notices is '0295: that a member was told about a message request in a chat - once per chat. Who, which chat and when, no content. Service role only.';
