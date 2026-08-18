-- =====================================================================
-- FrenzSave — Feature 15 Part 5 tranche 2: live comments + typing.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Live comments: postgres_changes on post_comments, filtered by post_id.
-- postgres_changes enforces the table's own RLS on delivery (unlike
-- Presence/Broadcast — see 0043's note on realtime.messages) — the
-- existing "post_comments public read" policy (0008) already governs
-- exactly who may receive these events, nothing new to authorize here.
--
-- REPLICA IDENTITY FULL: the client filters by `post_id=eq.<id>` on every
-- event type including DELETE, and a DELETE's old-row payload only carries
-- REPLICA IDENTITY columns (default = primary key only, which excludes
-- post_id) — without FULL, a delete's filter would never match and the
-- client-side comment would silently never disappear on other viewers'
-- screens. Same reasoning 0017 already applied to `conversations`.
-- ---------------------------------------------------------------------
alter table public.post_comments replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'post_comments'
  ) then
    alter publication supabase_realtime add table public.post_comments;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Typing indicators — private Presence channel, topic `typing:comments:
-- <postId>` (vs. messaging's `typing:<conversationId>` from 0043/0066).
-- Presence/Broadcast are NOT protected by table RLS, so without this the
-- join is rejected outright (fails closed, per Supabase's own docs).
--
-- Gate is deliberately coarser than `canComment()` (which also checks
-- comments_policy=followers/blocks) — a typing indicator reveals only
-- "someone is present," strictly less than what an already-public comment
-- list reveals, so requiring the post to simply exist and be published is
-- a reasonable, honestly-scoped bar for this tranche rather than
-- duplicating the full visibility predicate in raw SQL. Flagged as a known
-- narrowing opportunity in docs/FEATURE_15_PART_5_COMMENTS.md, not silently
-- treated as equivalent to canComment().
-- ---------------------------------------------------------------------
drop policy if exists "typing presence comment post visible" on realtime.messages;
create policy "typing presence comment post visible" on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension in ('presence', 'broadcast')
    and split_part(realtime.topic(), ':', 1) = 'typing'
    and split_part(realtime.topic(), ':', 2) = 'comments'
    and exists (
      select 1 from public.posts p
      where p.id = (split_part(realtime.topic(), ':', 3))::uuid
        and p.status = 'published'
    )
  );

drop policy if exists "typing presence comment post visible write" on realtime.messages;
create policy "typing presence comment post visible write" on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension in ('presence', 'broadcast')
    and split_part(realtime.topic(), ':', 1) = 'typing'
    and split_part(realtime.topic(), ':', 2) = 'comments'
    and exists (
      select 1 from public.posts p
      where p.id = (split_part(realtime.topic(), ':', 3))::uuid
        and p.status = 'published'
    )
  );
