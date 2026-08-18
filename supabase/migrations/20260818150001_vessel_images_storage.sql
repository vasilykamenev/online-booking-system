-- Vessel photos move from owner-pasted external URLs to Supabase Storage
-- (CLAUDE.md §5: "Фото судов — WebP/AVIF через Supabase Storage + трансформации").
-- Bucket is public for read: published-vessel photos are public marketing
-- content and are served straight through next/image, same as before.
-- Writes are restricted to the vessel's owner (or admin) via the {vesselId}/...
-- path convention enforced below.
--
-- Uploads are resized/re-encoded to WebP server-side before they reach this
-- bucket (src/lib/images/optimize.ts caps the long edge at 2560px — no 20"
-- monitor can show more — and re-encodes at quality 80), so the stored file
-- size limit only needs to guard against a pathological output, not raw
-- camera/phone originals.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vessel-images',
  'vessel-images',
  true,
  5242880, -- 5 MiB — well above the ~200-500 KB a 2560px WebP q80 photo typically produces
  array['image/webp']
)
on conflict (id) do nothing;

create policy "vessel_images_storage_public_read" on storage.objects
  for select
  using (bucket_id = 'vessel-images');

create policy "vessel_images_storage_owner_insert" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'vessel-images'
    and exists (
      select 1 from public.vessels v
      where v.id::text = (storage.foldername(name))[1]
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
      where v.id::text = (storage.foldername(name))[1]
        and (v.owner_id = auth.uid() or public.is_admin())
    )
  );
