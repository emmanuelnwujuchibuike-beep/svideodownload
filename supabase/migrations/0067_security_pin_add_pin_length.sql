-- 0067_security_pin_add_pin_length.sql
-- Fixes "setting a PIN fails with a 500 (Something went wrong)" — confirmed
-- empirically (real bearer-token POST to /api/v1/app/security/pin against a
-- running dev server, then reproduced the exact upsert directly): the live
-- `security_pin` table is missing its `pin_length` column entirely
-- ("column security_pin.pin_length does not exist"), even though migration
-- 0056's `create table if not exists public.security_pin (...)` has always
-- included that column since the file's very first commit.
--
-- Root cause: `create table if not exists` is a no-op once the table already
-- exists, regardless of whether its columns match the file's current
-- definition — so however `security_pin` first came to exist live (an
-- earlier partial/duplicate apply attempt, most likely), the real table's
-- shape silently froze at whatever that first run created, and 0056 running
-- again later never actually added the missing column. `security_pin` had
-- zero rows at the time of this fix, so a plain `ADD COLUMN` (not a
-- backfill) is sufficient and safe.
alter table public.security_pin
  add column if not exists pin_length int not null default 4;
