-- 0131_push_log_anon.sql
-- Re-applies the two `push_delivery_log` statements from 0130.
-- Idempotent.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 WHY THIS FILE EXISTS: 0130 APPLIED ONLY PARTIALLY
-- ═══════════════════════════════════════════════════════════════════════════
-- Probed live after 0130 landed. Everything up to and including the trailing
-- `create or replace function` / `create trigger` block was applied — the
-- streaks tables, both partial unique indexes, the `do $$ … end $$` CHECK on
-- push_subscriptions and the updated_at trigger all verified present and
-- enforcing. The final two statements in the file, which came AFTER that
-- dollar-quoted function body, were not:
--
--     alter table public.push_delivery_log alter column user_id drop not null;
--     alter table public.push_delivery_log add column if not exists anon_id text;
--
-- The consequence was quiet rather than loud, which is what makes it worth
-- writing down: `lib/push/web-push.ts` logs every delivery attempt
-- fire-and-forget with a swallowed rejection, so pushes kept being DELIVERED
-- while every log insert failed on the missing column — the admin "Push
-- delivery" monitor would simply have stopped gaining rows, with nothing
-- anywhere reporting an error.
--
-- 🔴 THE LESSON FOR FUTURE MIGRATIONS: do not put plain DDL after a
-- dollar-quoted function or DO block in the same file. Put trigger/function
-- definitions LAST, or give the trailing statements their own migration.
-- And always probe the database for what actually landed rather than reading
-- the file and assuming — the same rule that already applies to whether a
-- migration ran at all.

alter table public.push_delivery_log alter column user_id drop not null;
alter table public.push_delivery_log add column if not exists anon_id text;

create index if not exists push_delivery_log_anon_idx
  on public.push_delivery_log (anon_id) where anon_id is not null;
