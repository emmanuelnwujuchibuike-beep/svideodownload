-- 0307 — how blurry a locked exclusive post looks to a non-subscriber, the creator's choice (owner, 2026-10-30: "Make
-- users be able to set how blurry they want the post to be"). lib/sub/blur-level.ts maps each level to the stored
-- preview's size and the CSS blur on top. Existing posts are 'medium' (their 24 px clips and 20 px stills already fit).
--
-- Additive and idempotent. Until it runs, the app reads every post as 'medium' and a creator's change answers
-- "arrives with the next update" — nothing else depends on it.

alter table public.sub_posts
  add column if not exists blur_level text not null default 'medium';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sub_posts_blur_level_check') then
    alter table public.sub_posts
      add constraint sub_posts_blur_level_check check (blur_level in ('light', 'medium', 'strong'));
  end if;
end $$;

comment on column public.sub_posts.blur_level is
  'How blurry the locked preview is for non-subscribers: light | medium | strong (lib/sub/blur-level.ts). Set by the creator.';
