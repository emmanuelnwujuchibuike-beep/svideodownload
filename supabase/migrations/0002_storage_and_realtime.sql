-- =====================================================================
-- Storage buckets + realtime publication
-- =====================================================================

-- Private bucket for transient/processed media (served via signed URLs).
insert into storage.buckets (id, name, public)
values ('downloads', 'downloads', false)
on conflict (id) do nothing;

-- Public bucket for cached thumbnails.
insert into storage.buckets (id, name, public)
values ('thumbnails', 'thumbnails', true)
on conflict (id) do nothing;

-- Owners may read their own objects in the private bucket.
drop policy if exists "downloads bucket owner read" on storage.objects;
create policy "downloads bucket owner read" on storage.objects
  for select using (
    bucket_id = 'downloads'
    and owner = auth.uid()
  );

-- Anyone can read public thumbnails.
drop policy if exists "thumbnails public read" on storage.objects;
create policy "thumbnails public read" on storage.objects
  for select using (bucket_id = 'thumbnails');

-- Realtime: broadcast row changes on downloads so the UI can show live
-- status updates and progress.
do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.downloads;
