-- =====================================================================
-- FrenzSave — Phase 14: stored post media (native playback + Pro download)
-- Published posts may carry a stored media file (uploaded server-side after
-- publish) so videos/audio play natively in-app and Pro users can download
-- them to their device. Adds posts.media_url + a public `post-media` bucket
-- with user-scoped write RLS. Idempotent.
-- =====================================================================

alter table public.posts add column if not exists media_url text;

-- Public bucket for published post media (video/audio/image), up to 100 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-media', 'post-media', true, 104857600,
  array['video/mp4','video/webm','video/quicktime','audio/mpeg','audio/mp4','audio/aac','audio/wav','image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone can read post media.
drop policy if exists "post-media public read" on storage.objects;
create policy "post-media public read" on storage.objects
  for select using (bucket_id = 'post-media');

-- Owners may write only into their own folder (post-media/<uid>/…).
drop policy if exists "post-media owner write" on storage.objects;
create policy "post-media owner write" on storage.objects
  for insert with check (
    bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "post-media owner update" on storage.objects;
create policy "post-media owner update" on storage.objects
  for update using (
    bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "post-media owner delete" on storage.objects;
create policy "post-media owner delete" on storage.objects
  for delete using (
    bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text
  );
