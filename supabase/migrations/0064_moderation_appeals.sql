-- 0064_moderation_appeals.sql
-- Frenzsave · Premium Messaging V2 Part 11c: appeals — a user whose own
-- post/comment/account was actioned by moderation can ask for a second
-- look. One open appeal per target per user (re-appealing after a
-- resolution is allowed — a NEW row, not a reopen, so the history stays).

create table if not exists public.moderation_appeals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  message text not null,
  status text not null default 'pending',
  admin_note text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint moderation_appeals_target_chk check (target_type in ('post','comment','user')),
  constraint moderation_appeals_status_chk check (status in ('pending','upheld','overturned')),
  constraint moderation_appeals_message_len check (char_length(message) between 1 and 1000)
);

create index if not exists moderation_appeals_status_idx on public.moderation_appeals (status, created_at desc);
create index if not exists moderation_appeals_user_idx on public.moderation_appeals (user_id, created_at desc);

-- One PENDING appeal per (user, target) — resubmitting while already pending
-- would just spam the queue; a new appeal is only meaningful once the prior
-- one resolved.
create unique index if not exists moderation_appeals_one_pending_idx
  on public.moderation_appeals (user_id, target_type, target_id)
  where status = 'pending';

alter table public.moderation_appeals enable row level security;

drop policy if exists "moderation_appeals_select_own" on public.moderation_appeals;
create policy "moderation_appeals_select_own" on public.moderation_appeals
  for select using (auth.uid() = user_id);

-- Inserts go through the service-role API route (validates the target is
-- actually the caller's own actioned content before writing), so no insert
-- policy for the anon/authenticated role — mirrors `security_audit_log`'s
-- append-only stance.

-- A resolved appeal notifies the user — extend the existing, already
-- free-form-friendly notifications type constraint (see 0059's own comment).
alter table public.notifications drop constraint if exists notifications_type_chk;
alter table public.notifications add constraint notifications_type_chk check (
  type in (
    -- social
    'follow','like','love','comment','reply','mention','tag','quote','repost',
    'share','save','profile_view','invite','milestone','repost_engagement',
    'comment_reaction',
    -- messaging
    'message','message_reaction','message_mention',
    -- friends
    'friend_request','friend_accepted','friend_reminder',
    -- downloads
    'download_complete','download_failed','download_ready','processing_finished',
    -- community
    'community_invite','community_accepted','community_announcement','community_event',
    -- news
    'news_breaking','news_trending','news_following','news_recommended',
    -- premium
    'subscription_activated','payment_successful','renewal_reminder','premium_expiring',
    -- security
    'security_login','security_new_device','security_password','security_2fa',
    'security_suspicious','security_recovery',
    'security_2fa_disabled','security_recovery_used',
    'security_passkey_enrolled','security_passkey_removed',
    -- system
    'system','admin_broadcast',
    -- trust & safety
    'post_under_review','moderation_appeal_resolved'
  )
);
