"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { vesselSchema, vesselImageSchema, vesselStatusValues } from "@/lib/validation/vessel";
import {
  optimizeImage,
  OPTIMIZED_IMAGE_CONTENT_TYPE,
  OPTIMIZED_IMAGE_EXTENSION,
} from "@/lib/images/optimize";
import { searchVessels, type SearchFilters, type SearchResult } from "@/server/queries/vessels";

export async function loadMoreVessels(filters: SearchFilters): Promise<SearchResult> {
  return searchVessels(filters);
}

export interface VesselActionState {
  error?: string;
}

function parseVesselForm(formData: FormData) {
  return vesselSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    type: formData.get("type"),
    locationId: formData.get("locationId"),
    description: formData.get("description"),
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

export async function createVessel(
  locale: Locale,
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

  const { data: vessel, error } = await supabase
    .from("vessels")
    .insert({
      owner_id: user.id,
      location_id: parsed.data.locationId,
      type: parsed.data.type,
      status: parsed.data.status,
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description,
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

  const { error } = await supabase
    .from("vessels")
    .update({
      location_id: parsed.data.locationId,
      type: parsed.data.type,
      status: parsed.data.status,
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description,
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

const VESSEL_IMAGES_BUCKET = "vessel-images";

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

  let optimized: Buffer;
  try {
    optimized = await optimizeImage(await parsed.data.file.arrayBuffer());
  } catch {
    return { error: "invalidType" };
  }

  const path = `${parsed.data.vesselId}/${crypto.randomUUID()}.${OPTIMIZED_IMAGE_EXTENSION}`;

  const { error: uploadError } = await supabase.storage
    .from(VESSEL_IMAGES_BUCKET)
    .upload(path, optimized, { contentType: OPTIMIZED_IMAGE_CONTENT_TYPE });
  if (uploadError) return { error: "generic" };

  const {
    data: { publicUrl },
  } = supabase.storage.from(VESSEL_IMAGES_BUCKET).getPublicUrl(path);

  const { error } = await supabase.from("vessel_images").insert({
    vessel_id: parsed.data.vesselId,
    url: publicUrl,
    alt_text: { ru: parsed.data.altTextRu, en: parsed.data.altTextEn },
  });
  if (error) {
    await supabase.storage.from(VESSEL_IMAGES_BUCKET).remove([path]);
    return { error: "generic" };
  }

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
