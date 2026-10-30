-- 0308 — every video reel's own audio is a reusable sound, and a reel made with "Use this sound" carries that sound as
-- its audio (owner, 2026-10-30: "Sound page should be sound from videos, and users can reuse sounds from videos … uploaded
-- sounds too works"; a reused sound REPLACES the reel's audio; every reel gets its original sound at publish).
--
--   · sounds.origin_post_id — the reel an 'original' sound was taken from. One sound per reel (unique). Its audio_url is
--     the reel's own video file (an <audio> element and ffmpeg both read the audio track of an MP4), so nothing is
--     extracted or stored twice. Deleting the reel deletes its sound; reels that reused it keep the audio already mixed
--     into their own file, and their sound_id is set null by 0125's foreign key.
--   · posts.sound_mix_state — a reel published with someone else's sound waits for the worker to swap its audio:
--     'pending' → 'done' | 'failed' (lib/social/sound-mix.ts, server/services/sound-mix-service.ts). Null: nothing to do.
--
-- Additive and idempotent. Until it runs the app keeps today's behaviour: no original sounds are made (the reel's sound
-- ring opens the creator's profile, as before) and a reused sound stays a label on the reel.

alter table public.sounds
  add column if not exists origin_post_id uuid references public.posts (id) on delete cascade;

create unique index if not exists sounds_origin_post_uidx on public.sounds (origin_post_id) where origin_post_id is not null;

comment on column public.sounds.origin_post_id is
  'For an original sound: the reel whose own audio it is (lib/social/original-sound.ts). One per reel.';

alter table public.posts
  add column if not exists sound_mix_state text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'posts_sound_mix_state_check') then
    alter table public.posts
      add constraint posts_sound_mix_state_check check (sound_mix_state is null or sound_mix_state in ('pending', 'done', 'failed'));
  end if;
end $$;

create index if not exists posts_sound_mix_pending_idx on public.posts (created_at) where sound_mix_state = 'pending';

comment on column public.posts.sound_mix_state is
  'A reel made with another reel''s sound: pending until the worker replaces its audio with the sound, then done or failed.';

-- ---------------------------------------------------------------------
-- sound_saves — a member's saved sounds (the Sounds page's Save button and Saved tab, design/frenz-sounds.html).
-- Written through the server (admin client, after a session check); the policies let a member read and manage only
-- their own rows should a client ever query it directly.
-- ---------------------------------------------------------------------
create table if not exists public.sound_saves (
  user_id    uuid not null references auth.users (id) on delete cascade,
  sound_id   uuid not null references public.sounds (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, sound_id)
);

create index if not exists sound_saves_user_recent_idx on public.sound_saves (user_id, created_at desc);

alter table public.sound_saves enable row level security;

drop policy if exists "sound saves own read" on public.sound_saves;
create policy "sound saves own read" on public.sound_saves
  for select using (auth.uid() = user_id);

drop policy if exists "sound saves own write" on public.sound_saves;
create policy "sound saves own write" on public.sound_saves
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
