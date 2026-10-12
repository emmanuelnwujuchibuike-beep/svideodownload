-- 0235 — the read_at trigger for 0234 (Feature 20 · Parts 3-4, 2026-10-12).
--
-- On its own because plain DDL placed after a dollar-quoted block in the same file is silently
-- skipped by the migration runner (0130). 0234 defines public.notifications_stamp_read_at().
-- Idempotent. No semicolon inside any quoted string.

drop trigger if exists notifications_stamp_read_at on public.notifications;
create trigger notifications_stamp_read_at before update of read on public.notifications for each row execute function public.notifications_stamp_read_at();
