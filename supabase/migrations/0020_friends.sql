-- 0020_friends.sql
-- Frenz Connect foundation (Feature specs: Friend Request System / Bond / Connect).
-- Friendships are a mutual, request-based relationship — distinct from follows.
-- Requests carry an optional note (≤150 chars) and drive the accepted-but-not-
-- chatting smart reminder ("Start chatting 👋", sent once, auto-cancelled if a
-- conversation starts). Idempotent.

-- ---------------------------------------------------------------------
-- Friend requests (directed). Writes go through the API (service role) so
-- anti-spam, notifications and push stay server-mediated; RLS grants reads.
-- ---------------------------------------------------------------------
create table if not exists public.friend_requests (
  id              uuid primary key default uuid_generate_v4(),
  sender_id       uuid not null references auth.users (id) on delete cascade,
  receiver_id     uuid not null references auth.users (id) on delete cascade,
  note            text check (note is null or char_length(note) <= 150),
  status          text not null default 'pending'
                  check (status in ('pending','accepted','declined','cancelled','expired')),
  created_at      timestamptz not null default now(),
  responded_at    timestamptz,
  -- Smart reminder: set to accepted_at + 5 min on accept; a worker sends ONE
  -- "Start chatting 👋" if no conversation exists by then.
  reminder_due_at timestamptz,
  reminder_sent   boolean not null default false,
  constraint friend_requests_not_self check (sender_id <> receiver_id)
);

-- One live pending request per directed pair (a re-request after decline/cancel
-- creates a new row, preserving history for anti-abuse review).
create unique index if not exists friend_requests_pending_uidx
  on public.friend_requests (sender_id, receiver_id) where status = 'pending';
create index if not exists friend_requests_receiver_idx
  on public.friend_requests (receiver_id, created_at desc) where status = 'pending';
create index if not exists friend_requests_sender_idx
  on public.friend_requests (sender_id, created_at desc) where status = 'pending';
-- Reminder worker scan: only accepted rows still owing a reminder.
create index if not exists friend_requests_reminder_idx
  on public.friend_requests (reminder_due_at)
  where status = 'accepted' and reminder_sent = false;

alter table public.friend_requests enable row level security;

drop policy if exists "friend requests participant read" on public.friend_requests;
create policy "friend requests participant read" on public.friend_requests
  for select using (sender_id = auth.uid() or receiver_id = auth.uid());

-- ---------------------------------------------------------------------
-- Friendships (mutual). Canonical (low,high) pair — same shape as
-- conversations — so a pair can be friends exactly once.
-- ---------------------------------------------------------------------
create table if not exists public.friendships (
  user_low   uuid not null references auth.users (id) on delete cascade,
  user_high  uuid not null references auth.users (id) on delete cascade,
  request_id uuid references public.friend_requests (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_low, user_high),
  constraint friendships_order_chk check (user_low < user_high)
);
create index if not exists friendships_low_idx  on public.friendships (user_low, created_at desc);
create index if not exists friendships_high_idx on public.friendships (user_high, created_at desc);

alter table public.friendships enable row level security;

drop policy if exists "friendships participant read" on public.friendships;
create policy "friendships participant read" on public.friendships
  for select using (user_low = auth.uid() or user_high = auth.uid());

-- ---------------------------------------------------------------------
-- Notification taxonomy: add the friend lifecycle types.
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_chk;
alter table public.notifications add constraint notifications_type_chk check (
  type in (
    -- social
    'follow','like','love','comment','reply','mention','tag','quote','repost',
    'share','save','profile_view','invite','milestone',
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
    -- system
    'system'
  )
);

-- Collapse repeat friend_request/accepted rows per (recipient, actor) like
-- follow/like/save. friend_reminder stays out — the reminder_sent flag already
-- guarantees at-most-once, and it must not collide with friend_accepted.
drop index if exists notifications_dedupe_uidx;
create unique index if not exists notifications_dedupe_uidx
  on public.notifications (user_id, actor_id, type, coalesce(post_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where type in ('follow','like','save','friend_request','friend_accepted');
