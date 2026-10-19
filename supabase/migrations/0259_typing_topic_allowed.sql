-- 0259 — Typing indicator authorization (owner, 2026-10-18): one helper that decides whether the
-- CALLER may use a typing Presence channel. 0260 points the realtime.messages policies at it.

-- Why a new helper. The typing channels are private Presence channels, authorized by policies on
-- realtime.messages (0043 / 0052 / 0066 for "typing:<conversationId>", 0120 for
-- "typing:comments:<postId>"). Two problems, both found in Part 2 of the typing work:
--   1. Each old policy casts a topic segment to uuid without checking it first. Reproduced in an
--      in-memory Postgres (PGlite 18) with the real policy text: 0120's cast of segment 3 fails
--      while PLANNING any query on a chat topic (segment 3 is empty), and 0066's cast of segment
--      2 fails at run time on every comment topic. With both present, every typing join errors.
--      Production was NOT inspected - the live effect is unverified.
--   2. Chat typing only checked membership. A block never changes conversation_members
--      (app/api/block/[id]/route.ts), so two people who blocked each other kept exchanging typing
--      in their direct chat while sending was refused (lib/social/messages.ts bothBlocked).
--
-- What it allows (mirrors messaging, changes none of it):
--   typing:<conversationId>    caller is an ACTIVE member (left_at is null) AND
--                                group        -> yes (blocks between members never applied to
--                                                group messaging, so not to group typing either)
--                                direct/secret -> no block row either way and no 'messaging'
--                                                 restriction either way between the pair
--                                                 (user_low / user_high, the pair sendMessage uses)
--   typing:comments:<postId>   the post exists and is published (0120's rule, unchanged)
--   anything else              false - malformed topics never reach a cast
-- A block row counts while it exists, expired or not, exactly like bothBlocked - the reconcile
-- sweep (sweepPrivacyExpiry) deletes expired rows, and typing resumes when sending does.
--
-- Security. It answers only for auth.uid() (no user parameter, so a caller cannot ask about
-- anyone else) and returns one boolean - never rows or ids. SECURITY DEFINER because blocks and
-- user_restrictions RLS let only the blocker / restrictor see their row, and "they blocked me"
-- must still count. That relies on the function owner (the migration role) owning those tables
-- or bypassing RLS - no table here uses FORCE ROW LEVEL SECURITY. search_path is pinned and every
-- table is schema-qualified. EXECUTE: not anon - only authenticated (the policy runs as the
-- caller) and service_role.
--
-- Runner safety. Only dollar-quoted statements in this file (the runner splits on semicolons
-- outside them). The uuid check is anchored with the regex escapes A and Z so the body holds no
-- dollar sign besides its own delimiters. Idempotent - safe to re-run.

create or replace function public.typing_topic_allowed(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_parts text[];
  v_type text;
  v_low uuid;
  v_high uuid;
  uuid_re constant text := '\A[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\Z';
begin
  if v_uid is null or p_topic is null then
    return false;
  end if;
  v_parts := string_to_array(p_topic, ':');
  if v_parts[1] is distinct from 'typing' then
    return false;
  end if;

  -- typing:comments:<postId>
  if array_length(v_parts, 1) = 3 and v_parts[2] = 'comments' then
    if v_parts[3] is null or v_parts[3] !~ uuid_re then
      return false;
    end if;
    return exists (
      select 1 from public.posts p
      where p.id = v_parts[3]::uuid and p.status = 'published'
    );
  end if;

  -- typing:<conversationId>
  if array_length(v_parts, 1) is distinct from 2 or v_parts[2] is null or v_parts[2] !~ uuid_re then
    return false;
  end if;

  select c.type, c.user_low, c.user_high
    into v_type, v_low, v_high
  from public.conversations c
  join public.conversation_members cm on cm.conversation_id = c.id
  where c.id = v_parts[2]::uuid
    and cm.user_id = v_uid
    and cm.left_at is null
  limit 1;
  if not found then
    return false;
  end if;

  if v_type = 'group' then
    return true;
  end if;
  if v_type is distinct from 'direct' and v_type is distinct from 'secret' then
    return false;
  end if;

  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = v_low and b.blocked_id = v_high)
       or (b.blocker_id = v_high and b.blocked_id = v_low)
  ) then
    return false;
  end if;

  if exists (
    select 1 from public.user_restrictions r
    where r.scope = 'messaging'
      and ((r.restrictor_id = v_low and r.restricted_id = v_high)
        or (r.restrictor_id = v_high and r.restricted_id = v_low))
  ) then
    return false;
  end if;

  return true;
end
$$;

do $$
begin
  execute 'revoke all on function public.typing_topic_allowed(text) from public, anon';
  execute 'grant execute on function public.typing_topic_allowed(text) to authenticated, service_role';
end $$;
