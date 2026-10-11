-- 0224 — Universal Presence™, Focus Modes™ & Presence Automation™ (Feature 19 · Part 9).
--
-- Presence already has ONE home: user_presence_status (0043), one row per
-- member, readable only by its owner (other people read it through the
-- privacy transform in lib/social/presence-status.ts). This migration adds to
-- that row instead of building a second store:
--
--   custom_text / custom_until   a custom status that clears itself (ignored on
--                                read once custom_until has passed - no job)
--   focus_mode / focus_until     Work, Study, Meeting, Driving, Sleep, Gaming,
--                                Personal time, Vacation
--   auto_reply                   shown to someone who opens a chat while a
--                                focus or custom status is on. Never a message.
--   open_to                      chat, collaboration, business, friend
--                                requests, mentorship
--   audience / audience_circle   who sees all of the above. Online and last
--                                seen keep privacy_settings.last_seen_visibility.
--
-- Two new owner-only tables:
--   presence_schedules   Presence Automation - a focus mode on given days
--                        between two local times. Evaluated when presence is
--                        READ, never by a cron, so nothing runs while nobody
--                        is looking.
--   presence_history     private history of status, focus and custom status
--                        changes, written by a trigger (automatic Away is
--                        left out - it would bury everything else). Rows
--                        older than 90 days are trimmed on the next write.
--
-- Idempotent. No semicolon inside any quoted string. Every dollar-quoted
-- block is at the end.

alter table public.user_presence_status add column if not exists custom_text     text;
alter table public.user_presence_status add column if not exists custom_until    timestamptz;
alter table public.user_presence_status add column if not exists focus_mode      text;
alter table public.user_presence_status add column if not exists focus_until     timestamptz;
alter table public.user_presence_status add column if not exists auto_reply      text;
alter table public.user_presence_status add column if not exists open_to         text[] not null default '{}';
alter table public.user_presence_status add column if not exists audience        text not null default 'everyone';
alter table public.user_presence_status add column if not exists audience_circle uuid references public.social_circles (id) on delete set null;

create table if not exists public.presence_schedules (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  mode       text not null,
  days       smallint not null default 127,
  start_min  smallint not null,
  end_min    smallint not null,
  tz         text not null default 'UTC',
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists presence_schedules_owner_idx on public.presence_schedules (owner_id);
alter table public.presence_schedules enable row level security;
drop policy if exists "presence schedules owner" on public.presence_schedules;
create policy "presence schedules owner" on public.presence_schedules
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create table if not exists public.presence_history (
  id       bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind     text not null,
  value    text,
  at       timestamptz not null default now()
);
create index if not exists presence_history_owner_idx on public.presence_history (owner_id, at desc);
alter table public.presence_history enable row level security;
drop policy if exists "presence history owner read" on public.presence_history;
create policy "presence history owner read" on public.presence_history
  for select using (owner_id = auth.uid());

comment on table public.presence_schedules is '0224: Presence Automation - a focus mode on chosen days between two local times. Owner-only. Read-time evaluation, no cron.';
comment on table public.presence_history is '0224: a member''s private history of status, focus and custom status changes. Written by a trigger, kept 90 days.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
begin
  begin
    alter table public.user_presence_status add constraint user_presence_custom_len_chk check (custom_text is null or char_length(custom_text) between 1 and 60);
  exception when duplicate_object then null;
  end;
  begin
    alter table public.user_presence_status add constraint user_presence_reply_len_chk check (auto_reply is null or char_length(auto_reply) between 1 and 140);
  exception when duplicate_object then null;
  end;
  begin
    alter table public.user_presence_status add constraint user_presence_focus_chk check (focus_mode is null or focus_mode in ('work', 'study', 'meeting', 'driving', 'sleep', 'gaming', 'personal', 'vacation'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.user_presence_status add constraint user_presence_audience_chk check (audience in ('everyone', 'friends', 'circle', 'nobody'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.user_presence_status add constraint user_presence_open_to_chk check (open_to <@ array['chat', 'collaboration', 'business', 'friend_requests', 'mentorship']::text[]);
  exception when duplicate_object then null;
  end;
  begin
    alter table public.presence_schedules add constraint presence_schedules_mode_chk check (mode in ('work', 'study', 'meeting', 'driving', 'sleep', 'gaming', 'personal', 'vacation'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.presence_schedules add constraint presence_schedules_window_chk check (days between 1 and 127 and start_min between 0 and 1439 and end_min between 0 and 1439 and char_length(tz) between 1 and 64);
  exception when duplicate_object then null;
  end;
  begin
    alter table public.presence_history add constraint presence_history_kind_chk check (kind in ('status', 'focus', 'custom'));
  exception when duplicate_object then null;
  end;
end;
$$;

create or replace function public.log_presence_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  changed boolean := false;
begin
  -- automatic Away comes and goes every few minutes - it would bury the history
  if tg_op = 'INSERT' or (new.status is distinct from old.status and new.status <> 'away' and old.status <> 'away') then
    if tg_op = 'UPDATE' or new.status <> 'available' then
      insert into public.presence_history (owner_id, kind, value) values (new.user_id, 'status', new.status);
      changed := true;
    end if;
  end if;
  if (tg_op = 'INSERT' and new.focus_mode is not null) or (tg_op = 'UPDATE' and new.focus_mode is distinct from old.focus_mode) then
    insert into public.presence_history (owner_id, kind, value) values (new.user_id, 'focus', coalesce(new.focus_mode, 'off'));
    changed := true;
  end if;
  if (tg_op = 'INSERT' and new.custom_text is not null) or (tg_op = 'UPDATE' and new.custom_text is distinct from old.custom_text) then
    insert into public.presence_history (owner_id, kind, value) values (new.user_id, 'custom', new.custom_text);
    changed := true;
  end if;
  if changed then
    delete from public.presence_history where owner_id = new.user_id and at < now() - interval '90 days';
  end if;
  return new;
end;
$$;

do $$
begin
  revoke all on function public.log_presence_change() from public, anon, authenticated;
  drop trigger if exists user_presence_history_trg on public.user_presence_status;
  create trigger user_presence_history_trg after insert or update on public.user_presence_status
    for each row execute function public.log_presence_change();
end;
$$;
