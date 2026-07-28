-- 0098 — Digital Identity media (Feature 18 · Avatar Studio / Profile Video).
--
-- Three inputs behind the profile's identity presentation:
--   profile_video_url  — a short (≈3s) silent looping profile video.
--   profile_avatar_url — a chosen avatar image (distinct from the photo in avatar_url).
--   identity_mode      — which identity the profile displays: 'photo' | 'video' | 'avatar'.
--
-- All nullable / defaulted, read + written DEFENSIVELY (a dedicated try/caught
-- reader defaulting to photo/null; a separate best-effort UPDATE), so the profile
-- and the editor work whether or not this has been applied. identity_mode falls
-- back to 'photo' for any unknown value, and the renderer falls back to the photo
-- if the chosen mode has no media — so nothing can ever render blank.
alter table public.profiles add column if not exists profile_video_url text;
alter table public.profiles add column if not exists profile_avatar_url text;
alter table public.profiles add column if not exists identity_mode text not null default 'photo';
