import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type LocalizedText = Partial<Record<"ru" | "en", string>>;

export interface FeaturedVessel {
  id: string;
  slug: string;
  type: Database["public"]["Enums"]["vessel_type"];
  name: string;
  ratingAvg: number;
  guestsCapacity: number;
  cabins: number;
  basePriceMinor: number;
  currency: string;
  country: LocalizedText;
  city: LocalizedText;
  image: { url: string; alt: LocalizedText } | null;
}

export async function getFeaturedVessels(limit = 4): Promise<FeaturedVessel[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("vessels")
    .select(
      `id, slug, type, name, rating_avg, guests_capacity, cabins, base_price_minor, currency,
       locations ( country, city ),
       vessel_images ( url, alt_text, sort_order )`,
    )
    .eq("status", "published")
    .order("rating_avg", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map((vessel) => {
    const image = [...vessel.vessel_images].sort((a, b) => a.sort_order - b.sort_order)[0];

    return {
      id: vessel.id,
      slug: vessel.slug,
      type: vessel.type,
      name: vessel.name,
      ratingAvg: vessel.rating_avg,
      guestsCapacity: vessel.guests_capacity,
      cabins: vessel.cabins,
      basePriceMinor: vessel.base_price_minor,
      currency: vessel.currency,
      country: (vessel.locations?.country ?? {}) as LocalizedText,
      city: (vessel.locations?.city ?? {}) as LocalizedText,
      image: image ? { url: image.url, alt: (image.alt_text ?? {}) as LocalizedText } : null,
    };
  });
}

export interface VesselImage {
  url: string;
  alt: LocalizedText;
}

export interface VesselReview {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

export interface VesselDetail {
  id: string;
  slug: string;
  type: Database["public"]["Enums"]["vessel_type"];
  name: string;
  description: string;
  lengthMeters: number;
  cabins: number;
  guestsCapacity: number;
  yearBuilt: number | null;
  ratingAvg: number;
  ratingCount: number;
  basePriceMinor: number;
  currency: string;
  country: LocalizedText;
  city: LocalizedText;
  marina: LocalizedText | null;
  images: VesselImage[];
  amenityKeys: string[];
  reviews: VesselReview[];
}

export const getVesselBySlug = cache(async (slug: string): Promise<VesselDetail | null> => {
  const supabase = await createClient();

  const { data: vessel, error } = await supabase
    .from("vessels")
    .select(
      `id, slug, type, name, description, length_meters, cabins, guests_capacity, year_built,
       rating_avg, rating_count, base_price_minor, currency,
       locations ( country, city, marina ),
       vessel_images ( url, alt_text, sort_order ),
       vessel_amenities ( amenities ( key ) )`,
    )
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();

  if (error) throw error;
  if (!vessel) return null;

  const { data: reviews, error: reviewsError } = await supabase
    .from("reviews")
    .select("id, rating, comment, created_at")
    .eq("vessel_id", vessel.id)
    .order("created_at", { ascending: false });

  if (reviewsError) throw reviewsError;

  return {
    id: vessel.id,
    slug: vessel.slug,
    type: vessel.type,
    name: vessel.name,
    description: vessel.description,
    lengthMeters: vessel.length_meters,
    cabins: vessel.cabins,
    guestsCapacity: vessel.guests_capacity,
    yearBuilt: vessel.year_built,
    ratingAvg: vessel.rating_avg,
    ratingCount: vessel.rating_count,
    basePriceMinor: vessel.base_price_minor,
    currency: vessel.currency,
    country: (vessel.locations?.country ?? {}) as LocalizedText,
    city: (vessel.locations?.city ?? {}) as LocalizedText,
    marina: (vessel.locations?.marina ?? null) as LocalizedText | null,
    images: [...vessel.vessel_images]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((image) => ({ url: image.url, alt: (image.alt_text ?? {}) as LocalizedText })),
    amenityKeys: vessel.vessel_amenities.map((va) => va.amenities.key),
    reviews: (reviews ?? []).map((review) => ({
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.created_at,
    })),
  };
});
