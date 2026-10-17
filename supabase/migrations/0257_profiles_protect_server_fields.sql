-- 0257 — Frenz Exclusive Part 13 (security audit): an end user can no longer change the
-- server-controlled fields of their OWN profile row.

-- The hole. "profiles self update" (0001) is `for update using (auth.uid() = id)` with no column
-- limit, and Supabase grants UPDATE on every column to `authenticated`. 0136/0144 closed it for
-- `role` and `is_admin` only (profiles_protect_role). So a signed-in user, with the anon key and
-- their own session token, could PATCH their row through the REST API and:
--   · clear is_suspended   -> undo a suspension: Exclusive access (hasActiveSub), checkout as a
--                             creator, follower milestones, affiliate payouts all trust it
--   · clear is_hidden      -> undo an admin hide (hidden_at / hidden_by too)
--   · set is_verified      -> award themselves the verified badge
--   · set trust_score / reputation_bonus -> rank and moderation signals
--   · set followers_count / following_count -> fake social proof
--
-- The fix. A BEFORE UPDATE trigger puts those columns back to their old values when the change
-- comes from an end-user session (auth.uid() is set). Server-side callers (service role, SQL
-- editor, migrations, cron) have no auth.uid() and are unchanged — every legitimate writer of these
-- columns is one of them (lib/social/moderation.ts, lib/social/verification.ts,
-- recompute_trust_scores via the admin client).
--
-- The two counts are the exception: the follow-count triggers (0006) update them INSIDE the
-- follower's own session. Those updates run nested in another trigger (pg_trigger_depth() > 1),
-- while a direct PATCH is a top-level statement (depth 1 here). Only the top-level change is
-- reverted, so following and unfollowing keep counting.
--
-- Columns a user legitimately edits (display_name, bio, avatar, handle, …) are untouched. The
-- existing profiles_protect_role trigger is left exactly as it is.
--
-- Additive: one new function, one new trigger. Re-runnable. Depends on 0006 (counts, is_verified,
-- is_suspended), 0010 (trust_score), 0082 (is_hidden, hidden_at, hidden_by), 0097
-- (reputation_bonus). Independent of 0253-0256; run after them: 0253 -> 0254 -> 0255 -> 0256 -> 0257.
-- No semicolon inside any quoted string. Every dollar-quoted block is at the end.

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.profiles_protect_server_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- server-side callers are trusted (no end-user session)
  if auth.uid() is null then
    return new;
  end if;

  -- moderation and trust: never from an end-user session
  new.is_suspended := old.is_suspended;
  new.is_hidden := old.is_hidden;
  new.hidden_at := old.hidden_at;
  new.hidden_by := old.hidden_by;
  new.is_verified := old.is_verified;
  new.trust_score := old.trust_score;
  new.reputation_bonus := old.reputation_bonus;

  -- the counts: only the follow-count triggers move them (nested), never a direct statement
  if pg_trigger_depth() <= 1 then
    new.followers_count := old.followers_count;
    new.following_count := old.following_count;
  end if;

  return new;
end;
$fn$;

do $$
begin
  execute 'revoke all on function public.profiles_protect_server_fields() from public, anon, authenticated';
  execute 'drop trigger if exists profiles_protect_server_fields on public.profiles';
  execute 'create trigger profiles_protect_server_fields before update on public.profiles for each row execute function public.profiles_protect_server_fields()';
end;
$$;
