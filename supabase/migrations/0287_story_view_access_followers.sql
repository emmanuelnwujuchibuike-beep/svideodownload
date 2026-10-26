-- ═══════════════════════════════════════════════════════════════════════════
--  0287 — story_view_access learns the followers rule (Stories Part 2, 2026-10-26)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 0285 created story_view_access for the rings as they were: a public profile,
-- or a direct chat between the two. It said itself that Stories Part 2 would
-- widen who sees what, and that this function must widen with it, or views and
-- reshares would refuse people the rings show.
--
-- Part 2 (lib/social/story-audience.ts) shows a FOLLOWERS-ONLY member's stories
-- to their accepted followers — the app's own rule for followers-only content
-- (canSeePost, lib/social/posts.ts: a `follows` row exists only once a follow is
-- accepted). This replaces the function with exactly the same body plus that one
-- rule. Nothing else changes: blocks and status restrictions both ways, a
-- suspended author, a hidden author for friends only, an author with no handle,
-- an ended story, and a private profile reaching only a direct chat.
--
-- 0285 is not edited. Its policies, grants, trigger and the other two functions
-- stay as they are. The grants below re-state 0285's for this one function.
--
-- Runner rules (lib/platform/migration-strings.test.ts): plain $$ only, the
-- function body last, the grants in a do-block, no semicolon in a quoted string.

create or replace function public.story_view_access(p_story uuid, p_viewer uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_author uuid;
  v_expires timestamptz;
  v_handle text;
  v_visibility text;
  v_suspended boolean;
  v_hidden boolean;
  v_friends boolean;
begin
  if p_story is null or p_viewer is null then
    return 'forbidden';
  end if;
  select s.user_id, s.expires_at into v_author, v_expires from public.stories s where s.id = p_story;
  if not found then
    return 'missing';
  end if;
  if v_expires <= now() then
    return 'expired';
  end if;
  if v_author = p_viewer then
    return 'self';
  end if;
  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = v_author and b.blocked_id = p_viewer)
       or (b.blocker_id = p_viewer and b.blocked_id = v_author)
  ) then
    return 'forbidden';
  end if;
  if exists (
    select 1 from public.user_restrictions r
    where r.scope = 'status'
      and ((r.restrictor_id = v_author and r.restricted_id = p_viewer)
        or (r.restrictor_id = p_viewer and r.restricted_id = v_author))
  ) then
    return 'forbidden';
  end if;
  select p.handle, p.visibility, coalesce(p.is_suspended, false), coalesce(p.is_hidden, false)
    into v_handle, v_visibility, v_suspended, v_hidden
    from public.profiles p where p.id = v_author;
  if not found or v_handle is null or v_suspended then
    return 'forbidden';
  end if;
  v_friends := exists (
    select 1 from public.friendships f
    where (f.user_low = v_author and f.user_high = p_viewer)
       or (f.user_low = p_viewer and f.user_high = v_author)
  );
  if v_hidden and not v_friends then
    return 'forbidden';
  end if;
  if v_visibility = 'public' then
    return 'ok';
  end if;
  -- 0287: a followers-only profile reaches its accepted followers
  if v_visibility = 'followers' and exists (
    select 1 from public.follows fo where fo.follower_id = p_viewer and fo.following_id = v_author
  ) then
    return 'ok';
  end if;
  if exists (
    select 1 from public.conversations c
    where c.type = 'direct'
      and ((c.user_low = v_author and c.user_high = p_viewer)
        or (c.user_low = p_viewer and c.user_high = v_author))
  ) then
    return 'ok';
  end if;
  return 'forbidden';
end
$$;

do $$
begin
  revoke all on function public.story_view_access(uuid, uuid) from public, anon, authenticated;
  grant execute on function public.story_view_access(uuid, uuid) to service_role;
end
$$;
