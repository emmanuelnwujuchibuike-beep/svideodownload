-- =====================================================================
-- FrenzSave — Phase 12: media storage (avatars / banners uploaded from device)
-- A public "media" bucket; authenticated users can upload only into their own
-- folder (media/<uid>/...). Server-side size + mime limits. Idempotent.
-- Run in the Supabase SQL editor (it has rights to manage storage policies).
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

-- Public read (images are meant to be displayed).
drop policy if exists "media public read" on storage.objects;
create policy "media public read" on storage.objects
  for select using (bucket_id = 'media');

-- A user may only write within their own folder: media/<auth.uid()>/...
drop policy if exists "media insert own" on storage.objects;
create policy "media insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media update own" on storage.objects;
create policy "media update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media delete own" on storage.objects;
create policy "media delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
