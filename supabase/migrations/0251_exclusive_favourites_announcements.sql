-- 0251 — Frenz Exclusive Part 6: favourite creators, notification preferences, subscriber
-- announcements and a bounded, idempotent notification fan-out (docs/SUB_MONETIZATION.md
-- "Frenz Exclusive Part 6").
--
--   social_circles.kind          gains 'favourite_creators': a member's favourite creators are an
--                                ordinary circle (one per member, 0217's unique index on
--                                (owner_id, kind)). Every circle permission names ONE exact circle
--                                the owner chose (circle:<uuid>), so being in it grants a creator
--                                nothing unless the member picks it as an audience themselves.
--   creator_notification_prefs.announcements
--                                how a member hears about a creator's subscriber announcements:
--                                off / push / email / both. Default 'push' (the in-app row comes
--                                with it). Existing rows keep every other value they had.
--   creator_membership_settings.notify_subscribed
--                                how the CREATOR hears about a new subscriber. Default 'both' -
--                                exactly what is sent today.
--   creator_notes.title / audience / idempotency_key / deleted_at
--                                a note can be for 'members' (as today, every existing row) or for
--                                'subscribers' only. A retried publish with the same key returns
--                                the same note. Deleting keeps the row (deleted_at) for audit.
--   sub_fanout_jobs / sub_fanout_deliveries
--                                one job per announcement or private post; recipients are claimed
--                                one row each (primary key = the dedupe) before anything is sent,
--                                in bounded pages, by the request that publishes and then by the
--                                10-minute reconcile run. A claim records 'handed_off' (passed to
--                                the push / email pipeline), 'skipped' (not eligible or opted out)
--                                or 'failed' - never "delivered", which the app cannot observe.
--
-- Additive and idempotent. No row is rewritten. Every existing policy and grant stays; the new
-- tables have RLS on and no client policy. Works before and after it runs.
-- No semicolon inside any quoted string. Every dollar-quoted block is at the end.

alter table public.creator_notification_prefs add column if not exists announcements text not null default 'push';
alter table public.creator_membership_settings add column if not exists notify_subscribed text not null default 'both';

alter table public.creator_notes add column if not exists title text;
alter table public.creator_notes add column if not exists audience text not null default 'members';
alter table public.creator_notes add column if not exists idempotency_key text;
alter table public.creator_notes add column if not exists deleted_at timestamptz;
create unique index if not exists creator_notes_idem_uidx on public.creator_notes (creator_id, idempotency_key) where idempotency_key is not null;
create index if not exists creator_notes_audience_idx on public.creator_notes (creator_id, audience, created_at desc, id desc) where deleted_at is null;

create table if not exists public.sub_fanout_jobs (
  id          uuid primary key default gen_random_uuid(),
  creator_id  uuid not null references auth.users (id) on delete cascade,
  kind        text not null,
  ref_id      uuid not null,
  state       text not null default 'pending',
  cursor      uuid,
  handed_off  integer not null default 0,
  skipped     integer not null default 0,
  failed      integer not null default 0,
  runs        integer not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists sub_fanout_jobs_ref_uidx on public.sub_fanout_jobs (kind, ref_id);
create index if not exists sub_fanout_jobs_pending_idx on public.sub_fanout_jobs (created_at) where state = 'pending';
alter table public.sub_fanout_jobs enable row level security;
revoke all on table public.sub_fanout_jobs from anon, authenticated;

create table if not exists public.sub_fanout_deliveries (
  job_id       uuid not null references public.sub_fanout_jobs (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  status       text not null default 'claimed',
  channels     text,
  detail       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (job_id, recipient_id)
);
alter table public.sub_fanout_deliveries enable row level security;
revoke all on table public.sub_fanout_deliveries from anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
begin
  -- 0217's kind check, restated whole with 'favourite_creators' added
  alter table public.social_circles drop constraint if exists social_circles_kind_chk;
  alter table public.social_circles add constraint social_circles_kind_chk
    check (kind in ('custom', 'close_friends', 'inner_circle', 'vip', 'favourite_creators'));
  begin
    alter table public.creator_notification_prefs add constraint creator_notification_prefs_announcements_chk check (announcements in ('off', 'push', 'email', 'both'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.creator_membership_settings add constraint creator_membership_settings_notify_subscribed_chk check (notify_subscribed in ('off', 'push', 'email', 'both'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.creator_notes add constraint creator_notes_part6_chk check (
      audience in ('members', 'subscribers')
      and (title is null or char_length(title) between 1 and 80)
      and (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9_-]{8,80}$'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.sub_fanout_jobs add constraint sub_fanout_jobs_chk check (
      kind in ('announcement', 'private_post') and state in ('pending', 'done', 'cancelled')
      and handed_off >= 0 and skipped >= 0 and failed >= 0 and runs >= 0);
  exception when duplicate_object then null;
  end;
  begin
    alter table public.sub_fanout_deliveries add constraint sub_fanout_deliveries_status_chk check (status in ('claimed', 'handed_off', 'skipped', 'failed'));
  exception when duplicate_object then null;
  end;
end;
$$;
