-- =====================================================================
-- 0052 — fix "infinite recursion detected in policy" across the whole
-- messaging RLS surface. CRITICAL correctness fix.
--
-- Root cause (confirmed empirically 2026-07-12 with a real authenticated
-- session): 0041's `conversation_members roster read` policy subqueries
-- conversation_members INSIDE its own USING clause. Policy subqueries run
-- as the calling role with RLS applied, so any authenticated read of the
-- table re-enters its own policy — Postgres aborts with `infinite
-- recursion detected in policy for relation "conversation_members"`.
--
-- Blast radius (everything that subqueries conversation_members as
-- `authenticated` — all confirmed failing before this migration):
--   • conversation_members SELECT (any client read)
--   • messages SELECT  → which ALSO silently killed every postgres_changes
--     event for messages/message_reactions/message_attachments (Realtime
--     delivers an event only if the subscriber's SELECT policy passes —
--     an erroring policy = no live messages in open threads, ever)
--   • messages INSERT policy's membership check
--   • conversations SELECT
--   • message_reactions SELECT + INSERT — the reactions API route writes
--     through the RLS client, so REACTIONS NEVER PERSISTED (the UI's
--     optimistic pill just vanished on the next resync)
--   • message_attachments SELECT (live attachment events)
--   • 0043's realtime.messages typing-presence policies — private channel
--     joins fail closed → typing indicator never worked
--
-- The app's own server reads all use the service role (bypasses RLS),
-- which is why every page LOOKED fine while every live/client path failed.
--
-- Fix: the canonical pattern for self-referential membership checks — a
-- SECURITY DEFINER helper that reads conversation_members WITHOUT RLS,
-- then every affected policy calls the helper instead of subquerying the
-- table. The helper only ever answers about the CALLER's own membership
-- (p_user_id must equal auth.uid()), so it leaks nothing a member
-- couldn't already see.
-- =====================================================================

create or replace function public.is_conversation_member(p_conversation_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_user_id = auth.uid()
    and exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = p_conversation_id
        and cm.user_id = p_user_id
        and cm.left_at is null
    );
$$;

-- A message's conversation, RLS-free — used by the reaction INSERT check
-- below (its old inline `select from messages` subquery hit messages' own
-- then-recursive policy).
create or replace function public.message_conversation_id(p_message_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.conversation_id from public.messages m where m.id = p_message_id;
$$;

-- ---------------------------------------------------------------------
-- conversation_members — the self-referential policy itself.
-- ---------------------------------------------------------------------
drop policy if exists "conversation_members roster read" on public.conversation_members;
create policy "conversation_members roster read" on public.conversation_members
  for select using (public.is_conversation_member(conversation_id, auth.uid()));

-- ---------------------------------------------------------------------
-- conversations / messages.
-- ---------------------------------------------------------------------
drop policy if exists "conversations participants" on public.conversations;
create policy "conversations participants" on public.conversations
  for select using (public.is_conversation_member(conversations.id, auth.uid()));

drop policy if exists "messages participants read" on public.messages;
create policy "messages participants read" on public.messages
  for select using (public.is_conversation_member(messages.conversation_id, auth.uid()));

drop policy if exists "messages sender insert" on public.messages;
create policy "messages sender insert" on public.messages
  for insert with check (
    auth.uid() = sender_id
    and public.is_conversation_member(messages.conversation_id, auth.uid())
  );

-- ---------------------------------------------------------------------
-- message_reactions.
-- ---------------------------------------------------------------------
drop policy if exists "message_reactions member read" on public.message_reactions;
create policy "message_reactions member read" on public.message_reactions
  for select using (public.is_conversation_member(message_reactions.conversation_id, auth.uid()));

drop policy if exists "message_reactions self insert" on public.message_reactions;
create policy "message_reactions self insert" on public.message_reactions
  for insert with check (
    auth.uid() = user_id
    and conversation_id = public.message_conversation_id(message_reactions.message_id)
    and public.is_conversation_member(message_reactions.conversation_id, auth.uid())
  );

drop policy if exists "message_reactions self update" on public.message_reactions;
create policy "message_reactions self update" on public.message_reactions
  for update using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and conversation_id = public.message_conversation_id(message_reactions.message_id)
  );

-- (self delete policy from 0041 has no membership subquery — unchanged.)

-- ---------------------------------------------------------------------
-- message_attachments.
-- ---------------------------------------------------------------------
drop policy if exists "message attachments members read" on public.message_attachments;
create policy "message attachments members read" on public.message_attachments
  for select using (public.is_conversation_member(message_attachments.conversation_id, auth.uid()));

-- ---------------------------------------------------------------------
-- Realtime Authorization for typing presence (0043) — same helper, same
-- reasoning; these were the policies failing private `typing:<id>` joins.
-- ---------------------------------------------------------------------
drop policy if exists "typing presence conversation members" on realtime.messages;
create policy "typing presence conversation members" on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension in ('presence')
    and split_part(realtime.topic(), ':', 1) = 'typing'
    and public.is_conversation_member((split_part(realtime.topic(), ':', 2))::uuid, auth.uid())
  );

drop policy if exists "typing presence conversation members write" on realtime.messages;
create policy "typing presence conversation members write" on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension in ('presence')
    and split_part(realtime.topic(), ':', 1) = 'typing'
    and public.is_conversation_member((split_part(realtime.topic(), ':', 2))::uuid, auth.uid())
  );
