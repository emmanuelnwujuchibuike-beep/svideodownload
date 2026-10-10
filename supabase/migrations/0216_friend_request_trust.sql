-- 0216: Feature 19 · Part 2 — Friend Requests™ trust workflow.
--
-- Three additions, each something that did not exist (the request lifecycle,
-- notes, caps and reminders are 0020):
--
--   friend_request_ignores   "Ignore" — the request leaves the receiver's list
--                            and stays PENDING for the sender. It is its own
--                            table, readable ONLY by the receiver: the sender
--                            can read their own friend_requests rows (0020
--                            "participant read"), so an "ignored" status there
--                            would tell them they were ignored. Written by the
--                            server only (no insert/update policy).
--   friend_requests.source   where a request was sent from (profile, search,
--                            suggestion, qr, nearby, link, messages, other):
--                            context for the receiver and the spam review.
--   privacy_settings.friend_requests_policy
--                            who may send you a request: everyone (the default,
--                            today's behaviour), friends_of_friends, verified,
--                            nobody. Enforced in lib/social/friends.ts.
--
-- Expiry needs no schema: 'expired' has been an allowed status since 0020.
-- Idempotent. Plain DDL first, DO blocks last (the migration runner).

create table if not exists public.friend_request_ignores (
  request_id  uuid primary key references public.friend_requests (id) on delete cascade,
  receiver_id uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists friend_request_ignores_receiver_idx on public.friend_request_ignores (receiver_id);
alter table public.friend_request_ignores enable row level security;
drop policy if exists "friend request ignores receiver read" on public.friend_request_ignores;
create policy "friend request ignores receiver read" on public.friend_request_ignores
  for select using (receiver_id = (select auth.uid()));

alter table public.friend_requests add column if not exists source text;
-- the adaptive limit counts a sender's recent requests of every status
create index if not exists friend_requests_sender_recent_idx on public.friend_requests (sender_id, created_at desc);

alter table public.privacy_settings add column if not exists friend_requests_policy text not null default 'everyone';

do $$ begin
  alter table public.friend_requests add constraint friend_requests_source_chk
    check (source is null or source in ('profile', 'search', 'suggestion', 'qr', 'nearby', 'link', 'messages', 'other'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.privacy_settings add constraint privacy_friend_requests_policy_chk
    check (friend_requests_policy in ('everyone', 'friends_of_friends', 'verified', 'nobody'));
exception when duplicate_object then null; end $$;
