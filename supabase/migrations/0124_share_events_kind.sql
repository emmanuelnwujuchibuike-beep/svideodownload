-- =====================================================================
-- FrenzSave — Feature 15 Part 6 tranche 3: destination breakdown +
-- recipient-based open tracking for share_events (0121's minimal log).
-- Additive + idempotent.
-- =====================================================================

alter table public.share_events
  add column if not exists kind text not null default 'dm';
alter table public.share_events drop constraint if exists share_events_kind_chk;
alter table public.share_events
  add constraint share_events_kind_chk check (kind in ('dm', 'group', 'copy_link', 'os_share', 'email', 'sms', 'qr'));

-- Only populated for kind IN ('dm','group') — the only cases where the
-- recipient is actually known. A copy-link/email/SMS/QR share has no
-- addressable recipient to record; "opened" for those stays unmeasured
-- rather than guessed (same "unknown ≠ zero" discipline Part 4 established
-- for repost provenance).
alter table public.share_events
  add column if not exists recipient_ids uuid[];

create index if not exists share_events_kind_idx on public.share_events (kind);
