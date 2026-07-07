-- =====================================================================
-- FrenzSave — Wow reactions slice 2: the long-press reaction picker.
-- The row stays type='like' (likes_count trigger, notifications, viewer
-- state and every existing query keep working unchanged); the CHOSEN
-- flavor (Love / Fire / Funny / …) lives in a new nullable `emotion`
-- column. Null = the plain Wow. Idempotent.
-- =====================================================================

alter table public.post_reactions
  add column if not exists emotion text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'post_reactions_emotion_chk'
  ) then
    alter table public.post_reactions
      add constraint post_reactions_emotion_chk check (
        emotion is null or emotion in
          ('love','fire','funny','applause','surprised','celebrate','insightful','support')
      );
  end if;
end $$;

-- Changing your reaction updates the same row — allow owners to update it.
drop policy if exists "reactions owner update" on public.post_reactions;
create policy "reactions owner update" on public.post_reactions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
