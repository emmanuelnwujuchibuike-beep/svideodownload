-- 0066_fix_typing_presence_broadcast_extension.sql
-- Fixes the typing indicator, which has NEVER actually worked in production —
-- confirmed empirically (real authenticated test users, a genuine conversation
-- membership row, direct realtime-js `channel.subscribe()`): every join to
-- `typing:<conversationId>` returns
--   "Unauthorized: You do not have permissions to read from this Channel topic"
-- even though `public.is_conversation_member()` correctly returns true for the
-- exact same user when called directly (so the membership check itself, and
-- migration 0052's fix, were never the problem).
--
-- Root cause: `supabase-js`'s `RealtimeChannel` unconditionally includes a
-- `broadcast: { ack: false, self: false }` block in every channel's join
-- payload — even a channel that only ever calls `.on('presence', ...)`, like
-- `use-typing.ts` (verified by reading `RealtimeChannel.js`'s `subscribe()`:
-- `config = { broadcast, presence: {...}, postgres_changes, private }` has no
-- "only send broadcast if used" gating the way presence has via
-- `presence_enabled`). Realtime Authorization requires a matching
-- `realtime.messages` policy for EVERY extension present in that payload, not
-- just the ones the app code actually listens to — 0043/0052 only ever
-- authorized `extension = 'presence'`, so the always-present `broadcast`
-- component of the same join request had no matching policy and the entire
-- join was denied.
--
-- Fix: widen both policies to also authorize `extension = 'broadcast'` for
-- the same conversation-membership predicate — still scoped to actual
-- members of the conversation, and this app never sends real broadcast
-- payloads on this topic, so this only closes the gap the client always
-- opens implicitly.
drop policy if exists "typing presence conversation members" on realtime.messages;
create policy "typing presence conversation members" on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension in ('presence', 'broadcast')
    and split_part(realtime.topic(), ':', 1) = 'typing'
    and public.is_conversation_member((split_part(realtime.topic(), ':', 2))::uuid, auth.uid())
  );

drop policy if exists "typing presence conversation members write" on realtime.messages;
create policy "typing presence conversation members write" on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension in ('presence', 'broadcast')
    and split_part(realtime.topic(), ':', 1) = 'typing'
    and public.is_conversation_member((split_part(realtime.topic(), ':', 2))::uuid, auth.uid())
  );
