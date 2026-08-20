"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  vesselSchema,
  vesselImageSchema,
  vesselCreateImagesSchema,
  vesselImageMaxCount,
  vesselStatusValues,
  type VesselInput,
} from "@/lib/validation/vessel";
import {
  optimizeImage,
  OPTIMIZED_IMAGE_CONTENT_TYPE,
  OPTIMIZED_IMAGE_EXTENSION,
} from "@/lib/images/optimize";
import { reverseGeocodeBilingual } from "@/lib/geo/reverse-geocode";
import { searchVessels, type SearchFilters, type SearchResult } from "@/server/queries/vessels";

export async function loadMoreVessels(filters: SearchFilters): Promise<SearchResult> {
  return searchVessels(filters);
}

export interface VesselActionState {
  error?: string;
}

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

/** Optimizes and uploads one photo, then records it. Throws on any failure — caller rolls back. */
async function uploadVesselImage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  vesselId: string,
  file: File,
  sortOrder: number,
  uploadedPaths: string[],
  altText?: { ru: string; en: string },
) {
  const optimized = await optimizeImage(await file.arrayBuffer());
  const path = `${vesselId}/${crypto.randomUUID()}.${OPTIMIZED_IMAGE_EXTENSION}`;

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
): Promise<{ locationId: string } | { error: "generic" }> {
  if (data.locationId) return { locationId: data.locationId };
  if (!data.newLocationName || data.latitude == null || data.longitude == null) {
    return { error: "generic" };
  }

  const geocoded = await reverseGeocodeBilingual(data.latitude, data.longitude);
  if (!geocoded) return { error: "generic" };

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
  if (error) return { error: "generic" };

  return { locationId: location.id };
}

export async function createVessel(
  locale: Locale,
  _prevState: VesselActionState,
  formData: FormData,
): Promise<VesselActionState> {
  const parsed = parseVesselForm(formData);
  if (!parsed.success) return { error: "invalid" };

  // A cover photo is required at registration (used as the vessel's search-result thumbnail);
  // up to 9 more can be attached in the same submission, the rest later from the edit page.
  const additionalPhotos = formData
    .getAll("additionalPhotos")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
  const photosParsed = vesselCreateImagesSchema.safeParse({
    mainPhoto: formData.get("mainPhoto"),
    additionalPhotos,
  });
  if (!photosParsed.success) return { error: photosParsed.error.issues[0]?.message ?? "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthenticated" };

  const locationResult = await resolveLocationId(supabase, parsed.data);
  if ("error" in locationResult) return locationResult;

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

  if (error) return { error: error.code === "23505" ? "slugTaken" : "generic" };

  const photos = [photosParsed.data.mainPhoto, ...photosParsed.data.additionalPhotos];
  const uploadedPaths: string[] = [];
  try {
    for (const [index, file] of photos.entries()) {
      await uploadVesselImage(supabase, vessel.id, file, index, uploadedPaths);
    }
  } catch {
    if (uploadedPaths.length > 0) {
      await supabase.storage.from(VESSEL_IMAGES_BUCKET).remove(uploadedPaths);
    }
    await supabase.from("vessels").delete().eq("id", vessel.id);
    return { error: "generic" };
  }

  revalidatePath(`/${locale}/owner/vessels`);
  return redirect({ href: `/owner/vessels/${vessel.id}/edit`, locale });
}

export async function updateVessel(
  locale: Locale,
  vesselId: string,
  _prevState: VesselActionState,
  formData: FormData,
): Promise<VesselActionState> {
  const parsed = parseVesselForm(formData);
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthenticated" };

  const locationResult = await resolveLocationId(supabase, parsed.data);
  if ("error" in locationResult) return locationResult;

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

  if (error) return { error: error.code === "23505" ? "slugTaken" : "generic" };

  revalidatePath(`/${locale}/owner/vessels`);
  revalidatePath(`/${locale}/owner/vessels/${vesselId}/edit`);
  return {};
}

export interface VesselStatusResult {
  error?: "unauthenticated" | "generic";
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

  const { error } = await supabase
    .from("vessels")
    .update({ status })
    .eq("id", vesselId)
    .eq("owner_id", user.id);
  if (error) return { error: "generic" };

  revalidatePath(`/${locale}/owner/vessels`);
  return {};
}

export async function addVesselImage(
  locale: Locale,
  vesselId: string,
  _prevState: VesselActionState,
  formData: FormData,
): Promise<VesselActionState> {
  const parsed = vesselImageSchema.safeParse({
    vesselId,
    file: formData.get("file"),
    altTextRu: formData.get("altTextRu"),
    altTextEn: formData.get("altTextEn"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "invalid" };

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
    await uploadVesselImage(supabase, parsed.data.vesselId, parsed.data.file, count ?? 0, uploadedPaths, {
      ru: parsed.data.altTextRu,
      en: parsed.data.altTextEn,
    });
  } catch {
    if (uploadedPaths.length > 0) {
      await supabase.storage.from(VESSEL_IMAGES_BUCKET).remove(uploadedPaths);
    }
    return { error: "generic" };
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
