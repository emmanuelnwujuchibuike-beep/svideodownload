-- 0260 — Typing indicator policies (owner, 2026-10-18): every typing Presence channel is
-- authorized by public.typing_topic_allowed (0259), and the four old policies are removed.

-- Old (all on realtime.messages):
--   "typing presence conversation members"        and "... write"    (0043, 0052, 0066)
--   "typing presence comment post visible"        and "... write"    (0120)
-- Permissive policies are OR-combined, so ALL FOUR must go: any one left behind would keep its
-- unchecked uuid cast (the error 0259 describes) and, for the conversation pair, the block bypass.
-- No other policy on realtime.messages is touched.
--
-- Order: the new policies are created FIRST. If 0259 did not apply, these creates fail and the old
-- policies stay exactly as they were - no regression. Plain statements only in this file - no
-- dollar quotes, no semicolon inside a quoted string. Idempotent - safe to re-run.

drop policy if exists "typing presence topic allowed" on realtime.messages;
create policy "typing presence topic allowed" on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension in ('presence', 'broadcast')
    and public.typing_topic_allowed(realtime.topic())
  );

drop policy if exists "typing presence topic allowed write" on realtime.messages;
create policy "typing presence topic allowed write" on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension in ('presence', 'broadcast')
    and public.typing_topic_allowed(realtime.topic())
  );

drop policy if exists "typing presence conversation members" on realtime.messages;
drop policy if exists "typing presence conversation members write" on realtime.messages;
drop policy if exists "typing presence comment post visible" on realtime.messages;
drop policy if exists "typing presence comment post visible write" on realtime.messages;
