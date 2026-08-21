-- Vessel photo uploads used to travel through the createVessel/addVesselImage Server Actions as
-- raw multipart bytes. Next.js caps a Server Action request body at 1 MB by default, so any real
-- camera/phone photo (routinely 2-10 MB, up to the 20 MB the app already allows) tripped a 413
-- "Body exceeded 1 MB limit" that reached the user only as a generic error page.
--
-- Fix: the browser uploads the original photo straight to this same `vessel-images` bucket, under
-- a `{vesselId}/raw/...` prefix, bypassing the Next.js server entirely for the large upload. It
-- then calls `addVesselImage` with just the resulting path. That action downloads the original
-- server-to-server (an outbound fetch, not subject to the inbound body-size limit), optimizes it
-- with sharp exactly as before, uploads the result to `{vesselId}/...` (no `raw/` prefix), and
-- deletes the staging object.
--
-- This bucket was created public-read and capped at 5 MiB / WebP-only
-- (20260818150001_vessel_images_storage.sql), on the assumption every object in it was already
-- server-optimized. Raw staged originals break that assumption — they're briefly public-readable
-- before cleanup and can be up to 20 MiB in the app's original camera/phone formats — so the
-- bucket's own limits are relaxed to fit both raw and optimized objects. The existing owner
-- insert/delete policies already key off `{vesselId}/...` regardless of what follows, so no
-- policy changes are needed — only the bucket's own size/type ceiling.
update storage.buckets
set file_size_limit = 20971520, -- 20 MiB, matches vesselImageMaxBytes (src/lib/validation/vessel.ts)
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
where id = 'vessel-images';
