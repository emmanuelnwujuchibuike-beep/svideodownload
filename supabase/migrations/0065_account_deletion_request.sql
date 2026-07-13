-- 0065_account_deletion_request.sql
-- Frenzsave · Premium Messaging V2 Part 11c: Privacy Dashboard's "Delete my
-- account" — a REQUEST with a grace period (industry-standard pattern,
-- mirrors how Instagram/Discord/etc. handle this), not an immediate
-- irreversible delete from a single API call. Only the explicit "Cancel
-- deletion" button (DELETE /api/account/delete) clears the request — merely
-- signing back in during the grace period does NOT cancel it. A cron purges
-- accounts whose grace period has elapsed.

alter table public.profiles add column if not exists deletion_requested_at timestamptz;

create index if not exists profiles_deletion_requested_idx
  on public.profiles (deletion_requested_at)
  where deletion_requested_at is not null;
