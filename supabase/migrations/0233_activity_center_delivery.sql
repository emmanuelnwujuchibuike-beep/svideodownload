-- 0233 — Activity Center and Intelligent Delivery (Feature 20 · Parts 1-2, 2026-10-11).
--
--   notifications gains
--     pinned_at      the member kept it at the top of the Activity Center
--     archived_at    the member put it away (it leaves the inbox, stays searchable under Archived)
--     delivery       what the Attention Engine decided for its push: pushed | held | in_app
--                    (null = no decision recorded: a row from before 0233, or one whose push was never decided)
--     summarized_at  a held row that the after-hold summary push has already counted
--     delivery_reason the Attention Engine reason code (critical, focus:sleep, quiet_hours, burst_cap...)
--   notification_settings gains
--     quiet_hours_tz          the IANA zone quiet hours are read in (null = the old UTC reading)
--     held_summary_enabled    one summary push when a focus mode, DND or quiet hours end (default on)
--     favorites_bypass_quiet  favourite friends reach you during quiet hours, never DND or focus (default off)
--
-- Additive. Idempotent. No semicolon inside any quoted string. No dollar-quoted block.
-- Writes go through the API with the service role, scoped to the signed-in member.

alter table public.notifications add column if not exists pinned_at timestamptz;
alter table public.notifications add column if not exists archived_at timestamptz;
alter table public.notifications add column if not exists delivery text;
alter table public.notifications add column if not exists summarized_at timestamptz;
alter table public.notifications add column if not exists delivery_reason text;

alter table public.notifications drop constraint if exists notifications_delivery_chk;
alter table public.notifications add constraint notifications_delivery_chk check (delivery is null or delivery in ('pushed', 'held', 'in_app'));
alter table public.notifications drop constraint if exists notifications_delivery_reason_len_chk;
alter table public.notifications add constraint notifications_delivery_reason_len_chk check (delivery_reason is null or char_length(delivery_reason) <= 40);

-- the held summary asks only one question: which members have unread, uncounted held rows
create index if not exists notifications_held_open_idx on public.notifications (user_id, created_at) where delivery = 'held' and summarized_at is null and read = false;
-- Pinned and Archived are short per-member lists
create index if not exists notifications_pinned_idx on public.notifications (user_id, pinned_at desc) where pinned_at is not null;
create index if not exists notifications_archived_idx on public.notifications (user_id, archived_at desc) where archived_at is not null;

comment on column public.notifications.pinned_at is '0233: kept at the top of the Activity Center by the member. Null = not pinned.';
comment on column public.notifications.archived_at is '0233: put away by the member. Archived rows leave the inbox and the unread count.';
comment on column public.notifications.delivery is '0233: the Attention Engine decision for the push. pushed, held (DND, focus mode or quiet hours) or in_app. Null = no decision recorded.';
comment on column public.notifications.summarized_at is '0233: a held row already counted in an after-hold summary push.';

alter table public.notification_settings add column if not exists quiet_hours_tz text;
alter table public.notification_settings add column if not exists held_summary_enabled boolean not null default true;
alter table public.notification_settings add column if not exists favorites_bypass_quiet boolean not null default false;

alter table public.notification_settings drop constraint if exists notification_settings_tz_len_chk;
alter table public.notification_settings add constraint notification_settings_tz_len_chk check (quiet_hours_tz is null or char_length(quiet_hours_tz) between 1 and 64);

comment on column public.notification_settings.quiet_hours_tz is '0233: the IANA time zone the quiet-hours window is read in. Null = UTC, the reading before 0233.';
comment on column public.notification_settings.held_summary_enabled is '0233: send one summary push when a hold (DND, focus mode, quiet hours) ends.';
comment on column public.notification_settings.favorites_bypass_quiet is '0233: favourite friends reach the lock screen during quiet hours. Never during DND or a focus mode.';
