-- 0253 — Global opt-out for OPTIONAL product email, and one-click unsubscribe (Frenzsave Part 11).
--
--   notification_settings.optional_email
--                       false = no optional email at all (creator announcements and private-post
--                       alerts, "new subscriber" / "joined your community" notices, renewal
--                       reminders, the ad-slot waitlist). Checked at SEND time, so a message queued
--                       before the member opted out is not sent after. Default true: before 0253 there
--                       was no global switch to have turned off, so nobody's choice changes - each
--                       member's per-creator email choices (creator_notification_prefs) still decide
--                       whether a creator emails them at all.
--                       Transactional and security email (sign-in codes, receipts, withdrawal and
--                       payout decisions, credits received, support replies, paid-campaign notices)
--                       is not affected.
--   email_unsubscribe_tokens
--                       token_hash -> user_id, one row per member. The link carries an opaque
--                       token (an HMAC the server derives); only its SHA-256 is stored, so the table
--                       can't be turned back into working links. RLS on, no client policy.
--
-- Additive and idempotent. No row is rewritten. Works before and after it runs (the code reads a
-- missing column as "allowed" and an unsubscribe before it runs says so in words).
-- No semicolon inside any quoted string. Every dollar-quoted block is at the end.

alter table public.notification_settings add column if not exists optional_email boolean not null default true;

create table if not exists public.email_unsubscribe_tokens (
  token_hash text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index if not exists email_unsubscribe_tokens_user_uidx on public.email_unsubscribe_tokens (user_id);
alter table public.email_unsubscribe_tokens enable row level security;
revoke all on table public.email_unsubscribe_tokens from anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
begin
  begin
    alter table public.email_unsubscribe_tokens add constraint email_unsubscribe_tokens_hash_chk check (token_hash ~ '^[0-9a-f]{64}$');
  exception when duplicate_object then null;
  end;
end;
$$;
