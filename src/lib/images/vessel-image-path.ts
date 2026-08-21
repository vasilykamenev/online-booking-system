/**
 * Storage path convention for vessel photos, shared by the browser (raw upload, `upload-raw.ts`)
 * and the server (optimized re-upload, `src/server/actions/vessels.ts`) so both sides agree on
 * the same naming without duplicating it. No "use client"/"server-only" constraint — pure string
 * building, safe to import from either side.
 *
 * The leading `{vesselId}/` segment is load-bearing, not cosmetic: the storage bucket's RLS
 * policies (supabase/migrations/20260818150001_vessel_images_storage.sql) authorize a write only
 * when that first path segment is a vessel the caller owns. The vessel's display `name` isn't
 * unique (unlike `vessels.slug`), so it only ever appears inside the filename, for a human
 * skimming the storage browser — never as the folder that authorization depends on.
 */

function slugifyForPath(value: string): string {
  const normalized = value
    .toLowerCase()
    .normalize("NFKD")
    // Strips combining diacritical marks (U+0300-U+036F) left behind by NFKD normalization,
    // e.g. "café" -> "cafe", so the slug stays plain ASCII.
    .replace(/[̀-ͯ]/g, "");
  const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.slice(0, 60) || "vessel";
}

/**
 * `{name-slug}-{timestampHash}{random}.{ext}` — the name slug is for readability only, so two
 * vessels sharing a display name never collide: the trailing timestamp-derived hash plus a random
 * suffix guarantees uniqueness on their own, even for two photos uploaded in the same millisecond.
 */
function buildVesselImageFilename(vesselName: string, extension: string): string {
  const namePart = slugifyForPath(vesselName);
  const timestampHash = Date.now().toString(36);
  const random = crypto.randomUUID().split("-")[0];
  return `${namePart}-${timestampHash}${random}.${extension}`;
}

/** Where the browser stages an original photo before the server optimizes it. */
export function vesselImageRawPath(vesselId: string, vesselName: string, extension: string): string {
  return `${vesselId}/raw/${buildVesselImageFilename(vesselName, extension)}`;
}

/**
 * Where the server-optimized photo permanently lives once processed. The "webp" extension is
 * duplicated from `OPTIMIZED_IMAGE_CONTENT_TYPE`/`OPTIMIZED_IMAGE_EXTENSION`
 * (src/lib/images/optimize.ts) rather than imported — that module is `server-only`, and this one
 * is also imported by the browser-side `upload-raw.ts`, so pulling it in would break the client
 * bundle.
 */
export function vesselImageFinalPath(vesselId: string, vesselName: string): string {
  return `${vesselId}/${buildVesselImageFilename(vesselName, "webp")}`;
}
