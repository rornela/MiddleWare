-- =============================================================
-- 0003_storage_photos.sql
-- Create Storage bucket 'photos' and basic RLS policies
-- =============================================================

do $$
begin
  if not exists (select 1 from storage.buckets where name = 'photos') then
    perform storage.create_bucket('photos', true);
  end if;
end $$;

-- Policies are on storage.objects; enable public read for this bucket,
-- and allow authenticated users to insert/update/delete their own objects.

-- Public read for 'photos'
drop policy if exists photos_public_read on storage.objects;
create policy photos_public_read on storage.objects
  for select using (bucket_id = 'photos');

-- Authenticated users can upload into 'photos'
drop policy if exists photos_insert_auth on storage.objects;
create policy photos_insert_auth on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos');

-- Owners can update their own objects in 'photos'
drop policy if exists photos_update_own on storage.objects;
create policy photos_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and owner = auth.uid())
  with check (bucket_id = 'photos' and owner = auth.uid());

-- Owners can delete their own objects in 'photos'
drop policy if exists photos_delete_own on storage.objects;
create policy photos_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and owner = auth.uid());


