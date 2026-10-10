-- 0221 — People You May Know™ feedback (Feature 19 · Part 6).
--
-- "Learn from feedback: hide, not interested, already know, later, reset."
-- One row per (viewer, person suggested): the viewer's latest answer about
-- that suggestion. It is the member's OWN private discovery history. Only they
-- can read it, the person it is about never learns of it, and "Reset" deletes
-- every row.
--
--   hide            never suggest them again
--   not_interested  the same, and counts as a "less like this" signal
--   already_know    not a stranger, the member was offered a friend request instead
--   later           snoozed until snooze_until (7 days), then eligible again
--
-- Idempotent. No dollar-quoted blocks.

create table if not exists public.people_suggestion_feedback (
  viewer_id    uuid not null references auth.users (id) on delete cascade,
  subject_id   uuid not null references auth.users (id) on delete cascade,
  action       text not null,
  snooze_until timestamptz,
  created_at   timestamptz not null default now(),
  primary key (viewer_id, subject_id),
  constraint people_suggestion_feedback_not_self check (viewer_id <> subject_id),
  constraint people_suggestion_feedback_action_chk check (action in ('hide', 'not_interested', 'already_know', 'later')),
  constraint people_suggestion_feedback_snooze_chk check ((action = 'later') = (snooze_until is not null))
);
create index if not exists people_suggestion_feedback_recent_idx on public.people_suggestion_feedback (viewer_id, created_at desc);

alter table public.people_suggestion_feedback enable row level security;
drop policy if exists "suggestion feedback owner" on public.people_suggestion_feedback;
create policy "suggestion feedback owner" on public.people_suggestion_feedback
  for all using (viewer_id = auth.uid()) with check (viewer_id = auth.uid());

comment on table public.people_suggestion_feedback is '0221: a member''s private answers to People You May Know (hide, not interested, already know, later). Owner-only, never shown to the person it is about.';
