-- Fixes a column-shadowing bug in 20260818150001_vessel_images_storage.sql: inside
-- the EXISTS subquery `select 1 from public.vessels v`, the unqualified `name` in
-- `storage.foldername(name)` resolved to `v.name` (the vessel's display name, since
-- `vessels` also has a `name` column) instead of the intended outer `storage.objects.name`
-- (the upload path). That made the folder-id comparison always false, so every owner
-- upload/delete was silently rejected by RLS regardless of ownership.
drop policy "vessel_images_storage_owner_insert" on storage.objects;
drop policy "vessel_images_storage_owner_delete" on storage.objects;

create policy "vessel_images_storage_owner_insert" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'vessel-images'
    and exists (
      select 1 from public.vessels v
      where v.id::text = (storage.foldername(objects.name))[1]
        and (v.owner_id = auth.uid() or public.is_admin())
    )
  );

create policy "vessel_images_storage_owner_delete" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'vessel-images'
    and exists (
      select 1 from public.vessels v
      where v.id::text = (storage.foldername(objects.name))[1]
        and (v.owner_id = auth.uid() or public.is_admin())
    )
  );
