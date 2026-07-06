-- 0030_repost_captions.sql
-- The recommendation layer on top of reposts: an optional caption ("why I'm
-- recommending this") owned by the reposter, an edit timestamp for the short
-- edit-grace window, and pinning for the profile Reposts tab. The original
-- post is never touched — captions live entirely on the repost row. Idempotent.

alter table public.reposts add column if not exists caption text;
alter table public.reposts add column if not exists edited_at timestamptz;
alter table public.reposts add column if not exists pinned_at timestamptz;

-- Enforce the 300-character composer limit at the database boundary too.
do $$ begin
  alter table public.reposts
    add constraint reposts_caption_len_chk check (caption is null or char_length(caption) <= 300);
exception when duplicate_object then null; end $$;

-- Owner may edit their own repost row (caption / pin). Insert/delete policies
-- exist from 0025; update was never needed before captions.
drop policy if exists "reposts owner update" on public.reposts;
create policy "reposts owner update" on public.reposts
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Pinned-first ordering for the profile Reposts tab.
create index if not exists reposts_user_pinned_idx
  on public.reposts (user_id, pinned_at desc nulls last, created_at desc);
