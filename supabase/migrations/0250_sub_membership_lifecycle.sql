-- 0250 — Frenz Exclusive Part 5: the subscription lifecycle (docs/SUB_MONETIZATION.md
-- "Frenz Exclusive Part 5").
--
--   creator_memberships.cancelled_at / cancel_period
--       A subscriber who leaves a PAID subscription keeps the access they paid for: the row stays
--       'active' with its period_end untouched, and these two columns record "I won't renew".
--       cancel_period is the period_index the intent belongs to. Settlement already moves
--       period_index forward on every paid renewal (settle_sub_purchase, 0247), so a renewal
--       makes an older intent stale by itself: no money function changes here. The columns never
--       grant or extend access - every access check still reads status and period_end only.
--   sub_membership_reminders
--       One row per (membership, period, reminder) actually sent: the primary key is the
--       dedupe, so a cron that runs twice, or two at once, sends a reminder once. A renewal
--       starts a new period_index, so its reminders are new rows. No client policy.
--   creator_memberships_expiry_idx
--       The reminder sweep's read: paid memberships ending in the next days, by period_end.
--   creator_memberships_creator_sub_idx
--       The creator's paged subscriber list (keyset on joined_at, id).
--
-- Additive and idempotent. No row is rewritten, no policy or grant is widened, no function is
-- replaced. Works before and after it runs: the app treats the missing columns as "not
-- cancelled" and sends no reminder without the dedupe table.
-- No semicolon inside any quoted string. Every dollar-quoted block is at the end.

alter table public.creator_memberships add column if not exists cancelled_at timestamptz;
alter table public.creator_memberships add column if not exists cancel_period integer;
comment on column public.creator_memberships.cancelled_at is '0250: when the subscriber said they will not renew. Access is unchanged and still ends at period_end.';
comment on column public.creator_memberships.cancel_period is '0250: the period_index that intent belongs to. Stale (ignored) once a renewal moves period_index on.';

create index if not exists creator_memberships_expiry_idx on public.creator_memberships (period_end) where status = 'active' and billing = 'sub';
create index if not exists creator_memberships_creator_sub_idx on public.creator_memberships (creator_id, joined_at desc, id desc) where billing = 'sub';

create table if not exists public.sub_membership_reminders (
  membership_id uuid not null references public.creator_memberships (id) on delete cascade,
  period_index  integer not null,
  kind          text not null,
  member_id     uuid not null references auth.users (id) on delete cascade,
  sent_at       timestamptz not null default now(),
  primary key (membership_id, period_index, kind)
);
create index if not exists sub_membership_reminders_sent_idx on public.sub_membership_reminders (sent_at desc);
alter table public.sub_membership_reminders enable row level security;
revoke all on table public.sub_membership_reminders from anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
begin
  begin
    alter table public.creator_memberships add constraint creator_memberships_cancel_chk check (
      (cancelled_at is null) = (cancel_period is null) and (cancel_period is null or cancel_period >= 0));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.sub_membership_reminders add constraint sub_membership_reminders_kind_chk check (
      kind in ('renew_3d', 'renew_1d', 'expired') and period_index >= 0);
  exception when duplicate_object then null;
  end;
end;
$$;
