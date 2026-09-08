-- ============================================================================
-- 0143 — Frenz AI Part 5: rewarded-ad authorization for AI Clean
-- ============================================================================
--
-- Owner, 2026-09-08: a free member gets three AI Clean sessions a day, and each
-- one has to be unlocked by a rewarded ad.
--
-- ── 🔴 THIS REUSES `reward_sessions`. IT DOES NOT ADD A SECOND ONE. ──────────
--
-- The brief is explicit ("Only create this table if there is no existing
-- suitable reward/session table"), and 0117 already built one that is
-- server-authoritative, short-lived, user-bound, status-tracked and single-use.
-- Everything AI Clean needs is already here; what it needed was a `type` it is
-- allowed to hold, and a claim that cannot be replayed.
--
-- ── What is added ────────────────────────────────────────────────────────────
--
--   1. `ai_clean` joins the `type` vocabulary. That single column IS the
--      feature binding the brief asks for — a reward earned for a download
--      cannot unlock AI Clean, because it is a different row value.
--   2. `consumed_at` — AI Clean's rewards authorize one job, not a list of
--      items, so `consumed_indexes` is the wrong shape for it. A timestamp that
--      can only be written once is the right one.
--   3. `provider_reward_id`, uniquely indexed, so a provider that CAN give us
--      an id gets duplicate-callback protection for free.
--   4. `claim_ai_reward()` — the compare-and-set that makes a claim atomic.
--
-- 🔴 ORDERING: every plain DDL statement comes first and the dollar-quoted
-- function is last, so the 0130 partial-apply trap cannot arise.
--
-- Idempotent throughout.

-- ---------------------------------------------------------------------
-- 1 · `ai_clean` joins the type vocabulary
--
-- Dropping and re-adding is the only way to widen a CHECK. Both halves are
-- guarded, and every existing row keeps a value that is still in the list.
-- `preview` is carried over from 0118 — leaving it out here would silently
-- invalidate every preview reward ever issued.
-- ---------------------------------------------------------------------
alter table public.reward_sessions drop constraint if exists reward_sessions_type_check;
alter table public.reward_sessions add constraint reward_sessions_type_check
  check (type in ('hd', 'batch', 'preview', 'ai_clean'));

-- ---------------------------------------------------------------------
-- 2 · Single use, and a provider's own id when there is one
-- ---------------------------------------------------------------------
alter table public.reward_sessions add column if not exists consumed_at timestamptz;
alter table public.reward_sessions add column if not exists provider_reward_id text;
alter table public.reward_sessions add column if not exists provider text;

comment on column public.reward_sessions.consumed_at is
  'Set exactly once, by claim_ai_reward. A non-null value means this reward has already authorized a job and can never authorize another.';
comment on column public.reward_sessions.provider_reward_id is
  'The ad network''s own identifier for the reward, when it supplies one. Uniquely indexed so a duplicated provider callback cannot grant twice.';

-- Partial + unique: duplicate callbacks collide, and rows without a provider id
-- (every provider wired today — see lib/ai/reward.ts) do not fight over NULL.
create unique index if not exists reward_sessions_provider_reward_uq
  on public.reward_sessions (provider, provider_reward_id)
  where provider_reward_id is not null;

-- The claim path reads by id + user; the sweep reads unconsumed AI rewards.
create index if not exists reward_sessions_ai_open_idx
  on public.reward_sessions (user_id, status, expires_at)
  where type = 'ai_clean' and consumed_at is null;

-- ---------------------------------------------------------------------
-- 3 · The atomic claim
--
-- 🔴 EVERY CONDITION IS IN THE UPDATE, NOT IN A CHECK BEFORE IT.
--
-- Read-then-write is precisely the race the brief calls out: two tabs both read
-- "granted, unconsumed", both decide it is valid, and both start a job on one
-- ad. Because `consumed_at is null` is part of the WHERE, the second UPDATE
-- matches no row and the second caller is refused — by the database, not by
-- timing.
--
-- The user and the type are in the WHERE for the same reason: a reward
-- belonging to somebody else, or earned for a download, does not match and is
-- therefore not "rejected after a check" — it is simply not found.
-- ---------------------------------------------------------------------
create or replace function public.claim_ai_reward(
  p_session_id uuid,
  p_user_id uuid,
  p_feature text
)
returns table (claimed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  update public.reward_sessions
     set consumed_at = now()
   where id = p_session_id
     and user_id = p_user_id
     and type = p_feature
     and status = 'granted'
     and consumed_at is null
     and expires_at > now();

  get diagnostics v_updated = row_count;

  if v_updated = 1 then
    return query select true, 'claimed'::text;
    return;
  end if;

  -- Nothing was claimed. The reason is worked out only for the LOG — the
  -- caller answers the member with one sentence either way, because telling
  -- somebody which of these they hit is telling an attacker the same thing.
  return query
    select false,
           case
             when not exists (select 1 from public.reward_sessions where id = p_session_id) then 'no-such-session'
             when exists (select 1 from public.reward_sessions
                           where id = p_session_id and user_id is distinct from p_user_id) then 'wrong-user'
             when exists (select 1 from public.reward_sessions
                           where id = p_session_id and type is distinct from p_feature) then 'wrong-feature'
             when exists (select 1 from public.reward_sessions
                           where id = p_session_id and consumed_at is not null) then 'already-consumed'
             when exists (select 1 from public.reward_sessions
                           where id = p_session_id and expires_at <= now()) then 'expired'
             when exists (select 1 from public.reward_sessions
                           where id = p_session_id and status <> 'granted') then 'not-granted'
             else 'unknown'
           end::text;
end;
$$;

-- 🔴 Postgres grants EXECUTE on a new function to PUBLIC by default. This one
-- is `security definer` and takes a user id as an argument, so leaving that in
-- place would let any browser holding the anon key claim any reward for any
-- account. Revoked, then granted only to the service role the server uses.
revoke all on function public.claim_ai_reward(uuid, uuid, text) from public;
revoke all on function public.claim_ai_reward(uuid, uuid, text) from anon;
revoke all on function public.claim_ai_reward(uuid, uuid, text) from authenticated;
grant execute on function public.claim_ai_reward(uuid, uuid, text) to service_role;
