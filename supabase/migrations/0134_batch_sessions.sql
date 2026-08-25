-- Multi-Link daily batch allowance, in Postgres rather than Redis.
--
-- 🔴 THE BUG THIS FIXES (owner, 2026-08-25: "the daily limit in the multi link
-- doesnt work, it just shows a constant you have 2 remaining").
--
-- The allowance was counted with `consumeDaily` (lib/rate-limit.ts), which is a
-- Redis INCR and — by deliberate design shared with every other counter there —
-- FAILS OPEN when Upstash is not configured: it returns `{ allowed: true,
-- used: 0 }`. `UPSTASH_REDIS_REST_URL` and `_TOKEN` are present but set to the
-- EMPTY STRING, so `hasUpstash` is false, `dailyRedis` is null, and every read
-- reported zero batches used. The panel was faithfully rendering a counter that
-- was never counting.
--
-- Fail-open is right for a DOWNLOAD — a broken counter must never stop someone
-- getting their file. It is wrong for a PRODUCT ALLOWANCE that the UI displays
-- back to the visitor: there, failing open doesn't degrade gracefully, it prints
-- a number that is always the same and quietly gives the feature away.
--
-- So this counter moves to the database, which is already a hard dependency of
-- the feature (plan resolution, settings and reward sessions all require it —
-- if Postgres is down there is no batch to authorize anyway). A batch is a
-- low-frequency action, twice a day on the free tier, so a COUNT over a
-- single-day index costs nothing next to the extraction work a batch triggers.
--
-- Exactly-once comes from the UNIQUE constraint on batch_id, not from
-- application logic: a replayed commit (refresh mid-batch, a retried request, a
-- re-mounted component) hits the conflict and is ignored, which is the same
-- property the Redis receipt gave and is now enforced by the database itself.
create table if not exists public.batch_sessions (
  id uuid primary key default gen_random_uuid(),
  -- Server-minted in app/api/downloads/batch/authorize. UNIQUE is the whole
  -- idempotency mechanism — see the note above.
  batch_id uuid not null unique,
  user_id uuid references auth.users(id) on delete cascade,
  /*
    The anonymous identity is the BROWSER, not the IP (owner, 2026-08-25:
    "anonymous users too should have the limit with the browser").

    This is the SAME server-minted httpOnly cookie the streak system already
    uses (`frenz_sid`, lib/streaks/identity.ts) rather than a second identity
    invented for this table: it is created by the server, unreadable and
    unwritable from JavaScript, sent on every request (so several tabs and a
    PWA relaunch are one identity) and survives a restart.

    Why the browser and not the IP: a mobile carrier NATs thousands of people
    onto one address and a café shares one between everybody in it, so an
    IP-keyed allowance blocks strangers for each other's usage. Per browser is
    the fairer unit and the one actually asked for.

    Honest limit: clearing cookies earns a fresh allowance. `ip_hash` is still
    recorded beside it so a future abuse control can use it without another
    migration, but it is deliberately NOT the counting key.
  */
  anon_id uuid,
  -- sha256(client ip), never the raw address. Recorded, not counted — see above.
  ip_hash text,
  created_at timestamptz not null default now()
);

alter table public.batch_sessions enable row level security;
-- No public policies, deliberately: every read/write goes through an API route
-- using createAdminClient() (service role), exactly like reward_sessions. A
-- visitor must never be able to read or delete their own allowance rows.

-- The one query this table exists to serve: "how many batches has this identity
-- committed today". Covers both identity shapes in one index.
create index if not exists batch_sessions_identity_day_idx
  on public.batch_sessions (coalesce(user_id::text, ip_hash), created_at desc);

comment on table public.batch_sessions is
  'One row per committed Multi-Link batch. Source of truth for the daily batch allowance — see lib/downloads/multi-link.ts. Rows older than a couple of days carry no meaning; safe to prune.';
