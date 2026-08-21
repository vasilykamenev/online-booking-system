import { createClient } from "@/lib/supabase/client";
import { vesselImageAllowedTypes, vesselImageMaxBytes } from "@/lib/validation/vessel";
import { vesselImageRawPath } from "@/lib/images/vessel-image-path";

/**
 * Vessel photos live in the `vessel-images` bucket (supabase/migrations/20260818150001) —
 * originals are staged here too, under a `{vesselId}/raw/...` prefix, rather than a separate
 * bucket (see 20260821090001_vessel_images_raw_staging.sql for why that bucket's own size/type
 * limits had to widen to fit both). The browser uploads directly here, bypassing the Next.js
 * server entirely, so the original file's size never counts against a Server Action's
 * request-body limit. `addVesselImage` downloads the staged original server-to-server
 * afterwards, optimizes it, uploads the result outside the `raw/` prefix, and deletes the staged
 * copy.
 */
const VESSEL_IMAGES_BUCKET = "vessel-images";

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export interface RawUploadResult {
  path?: string;
  error?: "generic" | "tooLarge" | "invalidType";
}

/** Client-side mirror of the storage bucket's own constraints — instant feedback before spending a round trip. */
export function validateVesselImageFile(file: File): "tooLarge" | "invalidType" | null {
  if (!vesselImageAllowedTypes.includes(file.type as (typeof vesselImageAllowedTypes)[number])) {
    return "invalidType";
  }
  if (file.size > vesselImageMaxBytes) return "tooLarge";
  return null;
}

/**
 * Uploads one original photo straight to the `vessel-images` bucket from the browser, staged
 * under `{vesselId}/raw/...`. Requires the vessel row to already exist — the bucket's RLS insert
 * policy authorizes the write by checking that `vesselId` is one the caller owns.
 */
export async function uploadRawVesselImage(
  vesselId: string,
  vesselName: string,
  file: File,
): Promise<RawUploadResult> {
  const validationError = validateVesselImageFile(file);
  if (validationError) return { error: validationError };

  const extension = EXTENSION_BY_MIME[file.type] ?? "bin";
  const path = vesselImageRawPath(vesselId, vesselName, extension);

  const supabase = createClient();
  const { error } = await supabase.storage.from(VESSEL_IMAGES_BUCKET).upload(path, file, {
    contentType: file.type,
  });
  if (error) return { error: "generic" };

  return { path };
}

/**
 * Uploads and attaches each file in order, stopping at the first failure. Sequential (not
 * `Promise.all`) on purpose: `addVesselImage` derives each photo's `sort_order` from the current
 * count of the vessel's images, so attaching out of order — or in parallel, racing that count
 * query — would scramble the intended cover-photo-first ordering.
 */
export async function uploadAndAttachVesselPhotos(
  vesselId: string,
  vesselName: string,
  files: File[],
  attach: (vesselId: string, rawPath: string) => Promise<{ error?: string }>,
  upload: (
    vesselId: string,
    vesselName: string,
    file: File,
  ) => Promise<RawUploadResult> = uploadRawVesselImage,
): Promise<{ error?: string }> {
  for (const file of files) {
    const raw = await upload(vesselId, vesselName, file);
    if (raw.error || !raw.path) return { error: raw.error ?? "generic" };

    const attached = await attach(vesselId, raw.path);
    if (attached.error) return { error: attached.error };
  }
  return {};
}
