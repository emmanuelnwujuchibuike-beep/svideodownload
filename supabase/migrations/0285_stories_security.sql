-- ═══════════════════════════════════════════════════════════════════════════
--  0285 — Stories Part 1: who may read, write and keep a story (2026-10-26)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The 2026-10-26 Stories audit, findings S1–S6:
--
--   S2  "stories public read" let ANY role — anon included — select every
--       unexpired story, with its media URL, whatever the author's profile
--       visibility, blocks or suspension. The app's own visibility rules ran
--       only on the server (lib/social/stories.ts), so the anon key shipped in
--       every page could skip them.
--   S3  "stories owner insert" checked only user_id. A member could insert
--       through PostgREST with any expires_at (a story that never ends), any
--       media_url (another member's file, or any web page) and any
--       reshared_from_* provenance.
--   S1  Nothing ever removed an expired story. Proven on production: 69 rows,
--       every one expired, and files that expired 117 days earlier still
--       answering 200. A member's DELETE removed the row, which was the only
--       record of which file the story used.
--
-- ── What stays exactly as it was ───────────────────────────────────────────
--
-- Every story surface reads through the SERVICE ROLE (lib/social/stories.ts,
-- reshare.ts, reel-extras.ts, friend-activity.ts, the views route, the data
-- export) and applies the visibility rules there. None of them depended on the
-- public read policy, so removing it changes no screen.
--
-- ── What a member's own session may still do ───────────────────────────────
--
--   SELECT  their own story rows (the owner's own view of what they posted).
--   expire_own_story(id)   the DELETE route. It ENDS the story at once rather
--           than removing the row, so the sweep (lib/social/story-cleanup.ts)
--           can still find the file it used and remove it safely.
--
-- Nothing else. Inserts come only from the server (POST /api/stories after it
-- has checked the media belongs to the member, and /api/reshare after it has
-- checked the source), and every insert is stamped with a server-side 24 hour
-- life by the trigger below, whoever the caller is.
--
-- ── 🔴 Runner rules (see lib/platform/migration-strings.test.ts) ────────────
-- Plain statements first, every dollar-quoted body last, the grants inside a
-- do-block, and no semicolon inside any quoted string.

-- ── 1 · reads ──────────────────────────────────────────────────────────────
drop policy if exists "stories public read" on public.stories;
drop policy if exists "stories owner read" on public.stories;
create policy "stories owner read" on public.stories
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ── 2 · writes: none from a member session ─────────────────────────────────
drop policy if exists "stories owner insert" on public.stories;
drop policy if exists "stories owner delete" on public.stories;

revoke all on table public.stories from anon;
revoke insert, update, delete, truncate, references, trigger on table public.stories from authenticated;
grant select on table public.stories to authenticated;

-- ── 3 · story_views: the author reads, nobody writes directly ──────────────
drop policy if exists "story_views author read" on public.story_views;
create policy "story_views author read" on public.story_views
  for select to authenticated
  using (
    exists (
      select 1 from public.stories s
      where s.id = story_views.story_id
        and s.user_id = (select auth.uid())
    )
  );

revoke all on table public.story_views from anon;
revoke insert, update, delete, truncate, references, trigger on table public.story_views from authenticated;
grant select on table public.story_views to authenticated;

-- ── 4 · the sweep reads oldest-expired first ───────────────────────────────
create index if not exists stories_expires_asc_idx on public.stories (expires_at asc);

-- ═══════════════════ dollar-quoted bodies only from here ═══════════════════

-- A story lives 24 hours from the moment the DATABASE accepts it. Whatever an
-- insert carries is replaced, and an update can only shorten a story's life.
create or replace function public.stories_enforce_expiry()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.expires_at := now() + interval '24 hours';
  else
    new.created_at := old.created_at;
    if new.expires_at > old.created_at + interval '24 hours' then
      new.expires_at := old.created_at + interval '24 hours';
    end if;
    -- an ended story stays ended
    if old.expires_at <= now() and new.expires_at > old.expires_at then
      new.expires_at := old.expires_at;
    end if;
  end if;
  return new;
end
$$;

-- May this viewer see this story? The SAME rules the story surfaces apply
-- today (lib/social/stories.ts): blocks and status restrictions both ways, a
-- suspended author invisible, a hidden author visible to friends only, and
-- then a public profile, or a direct chat between the two (the in-chat strip).
-- 🔴 Stories Part 2 widens who sees what. It must widen THIS function with it,
-- or views and reshares will refuse people the rings now show.
--   missing · expired · self · forbidden · ok
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

-- The member's DELETE: end their own story now. Ownership is auth.uid(), never
-- a parameter. True when the story is theirs (already ended counts), false otherwise.
create or replace function public.expire_own_story(p_story uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_story is null then
    return false;
  end if;
  update public.stories
     set expires_at = least(expires_at, now())
   where id = p_story and user_id = v_uid;
  return found;
end
$$;

-- Which of these URLs does ANY row still use? Every text column named *_url
-- (and every text[] column named *_urls) in the public schema is asked, so a
-- table added later is covered without editing this. Story rows being swept
-- right now are excluded by id. The sweep deletes a file only when this
-- returns nothing for it. jsonb columns are NOT read.
create or replace function public.story_media_references(p_urls text[], p_exclude uuid[])
returns setof text
language plpgsql
stable
security definer
set search_path = public, pg_temp
set statement_timeout = '60s'
as $$
declare
  r record;
begin
  if p_urls is null or coalesce(array_length(p_urls, 1), 0) = 0 then
    return;
  end if;
  for r in
    select c.table_name, c.column_name, c.data_type
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public'
       and (
         (c.data_type in ('text', 'character varying') and c.column_name like '%\_url' escape '\')
         or (c.data_type = 'ARRAY' and c.udt_name = '_text' and c.column_name like '%\_urls' escape '\')
       )
  loop
    if r.data_type = 'ARRAY' then
      return query execute format(
        'select distinct u from public.%I, unnest(%I) as u where %I && $1 and u = any($1)',
        r.table_name, r.column_name, r.column_name
      ) using p_urls;
    elsif r.table_name = 'stories' then
      return query execute format(
        'select distinct %I::text from public.%I where %I = any($1) and not (id = any($2))',
        r.column_name, r.table_name, r.column_name
      ) using p_urls, coalesce(p_exclude, '{}'::uuid[]);
    else
      return query execute format(
        'select distinct %I::text from public.%I where %I = any($1)',
        r.column_name, r.table_name, r.column_name
      ) using p_urls;
    end if;
  end loop;
end
$$;

-- The trigger and every grant, in one block (runner rule: nothing plain after a body).
do $$
begin
  drop trigger if exists stories_enforce_expiry on public.stories;
  create trigger stories_enforce_expiry
    before insert or update on public.stories
    for each row execute function public.stories_enforce_expiry();

  revoke all on function public.stories_enforce_expiry() from public, anon, authenticated;

  revoke all on function public.story_view_access(uuid, uuid) from public, anon, authenticated;
  grant execute on function public.story_view_access(uuid, uuid) to service_role;

  revoke all on function public.story_media_references(text[], uuid[]) from public, anon, authenticated;
  grant execute on function public.story_media_references(text[], uuid[]) to service_role;

  revoke all on function public.expire_own_story(uuid) from public, anon;
  grant execute on function public.expire_own_story(uuid) to authenticated, service_role;
end
$$;
