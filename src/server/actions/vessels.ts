"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/i18n/routing";
import {
  vesselSchema,
  vesselImageSchema,
  vesselImageMaxCount,
  vesselStatusValues,
  type VesselInput,
} from "@/lib/validation/vessel";
import { optimizeImage, OPTIMIZED_IMAGE_CONTENT_TYPE } from "@/lib/images/optimize";
import { vesselImageFinalPath } from "@/lib/images/vessel-image-path";
import { reverseGeocodeBilingual } from "@/lib/geo/reverse-geocode";
import {
  buildFieldErrors,
  vesselDbError,
  handleUnexpectedActionError,
  type VesselActionState,
} from "@/lib/validation/vessel-errors";
import { searchVessels, type SearchFilters, type SearchResult } from "@/server/queries/vessels";

export type { VesselActionState } from "@/lib/validation/vessel-errors";

export async function loadMoreVessels(filters: SearchFilters): Promise<SearchResult> {
  return searchVessels(filters);
}

// Originals and optimized photos share this one bucket, distinguished only by path: the browser
// stages an original under `{vesselId}/raw/...` (bypassing the Next.js server entirely — see
// src/lib/images/upload-raw.ts — which is what keeps a Server Action's request body tiny even for
// a full-size camera photo), and `attachOptimizedVesselImage` below re-uploads the optimized
// result to `{vesselId}/...` before deleting the staged original.
const VESSEL_IMAGES_BUCKET = "vessel-images";

function parseVesselForm(formData: FormData) {
  return vesselSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    type: formData.get("type"),
    locationId: formData.get("locationId"),
    newLocationName: formData.get("newLocationName"),
    descriptionRu: formData.get("descriptionRu"),
    descriptionEn: formData.get("descriptionEn"),
    lengthMeters: formData.get("lengthMeters"),
    cabins: formData.get("cabins"),
    guestsCapacity: formData.get("guestsCapacity"),
    yearBuilt: formData.get("yearBuilt"),
    basePrice: formData.get("basePrice"),
    currency: formData.get("currency"),
    status: formData.get("status"),
    latitude: formData.get("latitude"),
    longitude: formData.get("longitude"),
  });
}

/**
 * Downloads a photo the browser already staged at `{vesselId}/raw/...`, optimizes it, and
 * records it as a vessel image. Throws on any failure — caller rolls back. The download is a
 * server-to-server call to Supabase Storage, not an inbound request to this server, so it isn't
 * subject to the Server Action body-size limit no matter how large the original photo was.
 */
async function attachOptimizedVesselImage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  vesselId: string,
  vesselName: string,
  rawPath: string,
  sortOrder: number,
  uploadedPaths: string[],
  altText?: { ru: string; en: string },
) {
  const { data: rawFile, error: downloadError } = await supabase.storage
    .from(VESSEL_IMAGES_BUCKET)
    .download(rawPath);
  if (downloadError || !rawFile) throw downloadError ?? new Error("raw vessel image not found");

  const optimized = await optimizeImage(await rawFile.arrayBuffer());
  const path = vesselImageFinalPath(vesselId, vesselName);

  const { error: uploadError } = await supabase.storage
    .from(VESSEL_IMAGES_BUCKET)
    .upload(path, optimized, { contentType: OPTIMIZED_IMAGE_CONTENT_TYPE });
  if (uploadError) throw uploadError;
  uploadedPaths.push(path);

  const {
    data: { publicUrl },
  } = supabase.storage.from(VESSEL_IMAGES_BUCKET).getPublicUrl(path);

  const { error: insertError } = await supabase.from("vessel_images").insert({
    vessel_id: vesselId,
    url: publicUrl,
    sort_order: sortOrder,
    ...(altText && { alt_text: altText }),
  });
  if (insertError) throw insertError;

  // Best-effort cleanup of the staging copy — a leftover raw file costs storage, not correctness.
  await supabase.storage.from(VESSEL_IMAGES_BUCKET).remove([rawPath]);
}

/** Vessel status can only become "published" once it has at least one photo (the cover shot). */
async function hasVesselPhoto(
  supabase: Awaited<ReturnType<typeof createClient>>,
  vesselId: string,
): Promise<boolean> {
  const { count } = await supabase
    .from("vessel_images")
    .select("id", { count: "exact", head: true })
    .eq("vessel_id", vesselId);
  return (count ?? 0) > 0;
}

/**
 * Returns the location id to attach to the vessel: the picked catalog entry as-is,
 * or — when the owner typed a new one — geocodes the dropped pin and inserts a
 * fresh `locations` row for it. `vesselSchema`'s refine() already guarantees
 * `newLocationName`/`latitude`/`longitude` are present whenever `locationId` isn't.
 */
async function resolveLocationId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  data: Pick<VesselInput, "locationId" | "newLocationName" | "latitude" | "longitude">,
): Promise<{ locationId: string } | { error: VesselActionState }> {
  if (data.locationId) return { locationId: data.locationId };
  if (!data.newLocationName || data.latitude == null || data.longitude == null) {
    return {
      error: { error: "invalid", fieldErrors: { newLocationName: "required" } },
    };
  }

  const geocoded = await reverseGeocodeBilingual(data.latitude, data.longitude);
  if (!geocoded) {
    return {
      error: { error: "generic", fieldErrors: { newLocationName: "geocodeFailed" } },
    };
  }

  const { data: location, error } = await supabase
    .from("locations")
    .insert({
      country: geocoded.country,
      city: geocoded.city,
      marina: { ru: data.newLocationName, en: data.newLocationName },
      latitude: data.latitude,
      longitude: data.longitude,
    })
    .select("id")
    .single();
  if (error) return { error: { error: "generic" } };

  return { locationId: location.id };
}

/**
 * Creates the vessel row from its text/number fields only — no photo bytes travel through this
 * request, so its body stays well under Next's default 1 MB Server Action limit regardless of
 * how many/large the owner's photos are. On success, the caller (`VesselForm`) uploads the cover
 * photo (and any extras) directly to Supabase Storage and attaches them via `addVesselImage`
 * before navigating to the edit page — the vessel therefore briefly exists without photos, which
 * `VesselForm` accounts for by not treating "created" as "done" until at least the cover photo
 * lands, and by pointing the owner at the edit page's photo manager to retry if it doesn't.
 */
export async function createVessel(
  locale: Locale,
  _prevState: VesselActionState,
  formData: FormData,
): Promise<VesselActionState> {
  const parsed = parseVesselForm(formData);
  if (!parsed.success) return { error: "invalid", fieldErrors: buildFieldErrors(formData, parsed.error) };

  // No vessel_images row can exist yet at creation time — photos are attached in a follow-up
  // step (see the doc comment above) — so "published" is never satisfiable here. Draft/archived
  // are unaffected; the owner can publish later via updateVessel/updateVesselStatus once a cover
  // photo is attached.
  if (parsed.data.status === "published") {
    return { error: "noPhotos", fieldErrors: { status: "noPhotos" } };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "unauthenticated" };

    const locationResult = await resolveLocationId(supabase, parsed.data);
    if ("error" in locationResult) return locationResult.error;

    const { data: vessel, error } = await supabase
      .from("vessels")
      .insert({
        owner_id: user.id,
        location_id: locationResult.locationId,
        type: parsed.data.type,
        status: parsed.data.status,
        name: parsed.data.name,
        slug: parsed.data.slug,
        description: { ru: parsed.data.descriptionRu, en: parsed.data.descriptionEn },
        length_meters: parsed.data.lengthMeters,
        cabins: parsed.data.cabins,
        guests_capacity: parsed.data.guestsCapacity,
        year_built: parsed.data.yearBuilt ?? null,
        base_price_minor: Math.round(parsed.data.basePrice * 100),
        currency: parsed.data.currency,
        latitude: parsed.data.latitude ?? null,
        longitude: parsed.data.longitude ?? null,
      })
      .select("id")
      .single();

    if (error) return vesselDbError(error);

    revalidatePath(`/${locale}/owner/vessels`);
    return { vesselId: vessel.id };
  } catch (err) {
    return handleUnexpectedActionError("createVessel", err);
  }
}

export async function updateVessel(
  locale: Locale,
  vesselId: string,
  _prevState: VesselActionState,
  formData: FormData,
): Promise<VesselActionState> {
  const parsed = parseVesselForm(formData);
  if (!parsed.success) return { error: "invalid", fieldErrors: buildFieldErrors(formData, parsed.error) };

  // See the matching comment in `createVessel` — this keeps an unexpected infra failure from
  // tripping the route's error boundary and wiping the edit form.
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "unauthenticated" };

    if (parsed.data.status === "published" && !(await hasVesselPhoto(supabase, vesselId))) {
      return { error: "noPhotos", fieldErrors: { status: "noPhotos" } };
    }

    const locationResult = await resolveLocationId(supabase, parsed.data);
    if ("error" in locationResult) return locationResult.error;

    const { error } = await supabase
      .from("vessels")
      .update({
        location_id: locationResult.locationId,
        type: parsed.data.type,
        status: parsed.data.status,
        name: parsed.data.name,
        slug: parsed.data.slug,
        description: { ru: parsed.data.descriptionRu, en: parsed.data.descriptionEn },
        length_meters: parsed.data.lengthMeters,
        cabins: parsed.data.cabins,
        guests_capacity: parsed.data.guestsCapacity,
        year_built: parsed.data.yearBuilt ?? null,
        base_price_minor: Math.round(parsed.data.basePrice * 100),
        currency: parsed.data.currency,
        latitude: parsed.data.latitude ?? null,
        longitude: parsed.data.longitude ?? null,
      })
      .eq("id", vesselId)
      .eq("owner_id", user.id);

    if (error) return vesselDbError(error);
  } catch (err) {
    return handleUnexpectedActionError("updateVessel", err);
  }

  revalidatePath(`/${locale}/owner/vessels`);
  revalidatePath(`/${locale}/owner/vessels/${vesselId}/edit`);
  return {};
}

export interface VesselStatusResult {
  error?: "unauthenticated" | "generic" | "noPhotos";
}

export async function updateVesselStatus(
  locale: Locale,
  vesselId: string,
  status: (typeof vesselStatusValues)[number],
): Promise<VesselStatusResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthenticated" };

  if (status === "published" && !(await hasVesselPhoto(supabase, vesselId))) {
    return { error: "noPhotos" };
  }

  const { error } = await supabase
    .from("vessels")
    .update({ status })
    .eq("id", vesselId)
    .eq("owner_id", user.id);
  if (error) return { error: "generic" };

  revalidatePath(`/${locale}/owner/vessels`);
  return {};
}

/**
 * Attaches a photo the browser already uploaded directly to `{vesselId}/raw/...` (see
 * `uploadRawVesselImage`, src/lib/images/upload-raw.ts). Used both right after `createVessel`
 * (for the cover photo and any extras) and from the edit page's photo manager — in both cases
 * the request carries only a storage path and some short text fields, never photo bytes.
 */
export async function addVesselImage(
  locale: Locale,
  vesselId: string,
  vesselName: string,
  rawPath: string,
  altTextRu?: string,
  altTextEn?: string,
): Promise<VesselActionState> {
  const parsed = vesselImageSchema.safeParse({ vesselId, vesselName, rawPath, altTextRu, altTextEn });
  if (!parsed.success) return { error: "invalid" };

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "unauthenticated" };

    const { count } = await supabase
      .from("vessel_images")
      .select("id", { count: "exact", head: true })
      .eq("vessel_id", parsed.data.vesselId);
    if ((count ?? 0) >= vesselImageMaxCount) return { error: "maxImages" };

    const uploadedPaths: string[] = [];
    try {
      await attachOptimizedVesselImage(
        supabase,
        parsed.data.vesselId,
        parsed.data.vesselName,
        parsed.data.rawPath,
        count ?? 0,
        uploadedPaths,
        { ru: parsed.data.altTextRu, en: parsed.data.altTextEn },
      );
    } catch {
      if (uploadedPaths.length > 0) {
        await supabase.storage.from(VESSEL_IMAGES_BUCKET).remove(uploadedPaths);
      }
      return { error: "generic" };
    }
  } catch (err) {
    return handleUnexpectedActionError("addVesselImage", err);
  }

  revalidatePath(`/${locale}/owner/vessels/${vesselId}/edit`);
  return {};
}

export interface SetPrimaryImageResult {
  error?: "generic";
}

/** Moves `imageId` to sort_order 0 (the search-result cover photo), keeping the rest in their relative order. */
export async function setPrimaryVesselImage(
  locale: Locale,
  vesselId: string,
  imageId: string,
): Promise<SetPrimaryImageResult> {
  const supabase = await createClient();

  const { data: images, error: fetchError } = await supabase
    .from("vessel_images")
    .select("id")
    .eq("vessel_id", vesselId)
    .order("sort_order", { ascending: true });
  if (fetchError || !images) return { error: "generic" };

  const reordered = [
    ...images.filter((image) => image.id === imageId),
    ...images.filter((image) => image.id !== imageId),
  ];

  const results = await Promise.all(
    reordered.map((image, index) =>
      supabase.from("vessel_images").update({ sort_order: index }).eq("id", image.id),
    ),
  );
  if (results.some((result) => result.error)) return { error: "generic" };

  revalidatePath(`/${locale}/owner/vessels/${vesselId}/edit`);
  return {};
}

export interface RemoveImageResult {
  error?: "generic";
}

export async function removeVesselImage(
  locale: Locale,
  vesselId: string,
  imageId: string,
): Promise<RemoveImageResult> {
  const supabase = await createClient();

  const { data: image } = await supabase
    .from("vessel_images")
    .select("url")
    .eq("id", imageId)
    .single();

  const { error } = await supabase.from("vessel_images").delete().eq("id", imageId);
  if (error) return { error: "generic" };

  const path = image?.url.split(`/${VESSEL_IMAGES_BUCKET}/`)[1];
  if (path) {
    await supabase.storage.from(VESSEL_IMAGES_BUCKET).remove([decodeURIComponent(path)]);
  }

  revalidatePath(`/${locale}/owner/vessels/${vesselId}/edit`);
  return {};
}

export interface SetAmenitiesResult {
  error?: "generic";
}

/** Replaces the vessel's full amenity set to match the checked boxes — simplest correct model for a checkbox form. */
export async function setVesselAmenities(
  locale: Locale,
  vesselId: string,
  amenityIds: string[],
): Promise<SetAmenitiesResult> {
  const supabase = await createClient();

  const { error: deleteError } = await supabase
    .from("vessel_amenities")
    .delete()
    .eq("vessel_id", vesselId);
  if (deleteError) return { error: "generic" };

  if (amenityIds.length > 0) {
    const { error: insertError } = await supabase
      .from("vessel_amenities")
      .insert(amenityIds.map((amenityId) => ({ vessel_id: vesselId, amenity_id: amenityId })));
    if (insertError) return { error: "generic" };
  }

  revalidatePath(`/${locale}/owner/vessels/${vesselId}/edit`);
  return {};
}
