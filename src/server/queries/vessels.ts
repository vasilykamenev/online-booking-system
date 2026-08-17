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
  latitude: number | null;
  longitude: number | null;
  image: { url: string; alt: LocalizedText } | null;
}

export const CARD_COLUMNS = `id, slug, type, name, rating_avg, guests_capacity, cabins, base_price_minor, currency, latitude, longitude,
       locations ( country, city, latitude, longitude ),
       vessel_images ( url, alt_text, sort_order )`;

export interface CardRow {
  id: string;
  slug: string;
  type: Database["public"]["Enums"]["vessel_type"];
  name: string;
  rating_avg: number;
  guests_capacity: number;
  cabins: number;
  base_price_minor: number;
  currency: string;
  latitude: number | null;
  longitude: number | null;
  locations: { country: unknown; city: unknown; latitude: number | null; longitude: number | null } | null;
  vessel_images: { url: string; alt_text: unknown; sort_order: number }[];
}

export function mapCardRow(vessel: CardRow): FeaturedVessel {
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
    // Vessel's own pin refines the marina's default point when the owner set one.
    latitude: vessel.latitude ?? vessel.locations?.latitude ?? null,
    longitude: vessel.longitude ?? vessel.locations?.longitude ?? null,
    image: image ? { url: image.url, alt: (image.alt_text ?? {}) as LocalizedText } : null,
  };
}

export async function getFeaturedVessels(limit = 4): Promise<FeaturedVessel[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("vessels")
    .select(CARD_COLUMNS)
    .eq("status", "published")
    .order("rating_avg", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map(mapCardRow);
}

export interface SearchFilters {
  type?: Database["public"]["Enums"]["vessel_type"];
  locationId?: string;
  guests?: number;
  priceMaxMinor?: number;
  cursor?: string;
}

export interface SearchResult {
  vessels: FeaturedVessel[];
  nextCursor: string | null;
}

const SEARCH_PAGE_SIZE = 8;

export async function searchVessels(filters: SearchFilters): Promise<SearchResult> {
  const supabase = await createClient();

  let query = supabase.from("vessels").select(CARD_COLUMNS).eq("status", "published");

  if (filters.type) query = query.eq("type", filters.type);
  if (filters.locationId) query = query.eq("location_id", filters.locationId);
  if (filters.guests) query = query.gte("guests_capacity", filters.guests);
  if (filters.priceMaxMinor) query = query.lte("base_price_minor", filters.priceMaxMinor);

  if (filters.cursor) {
    const [ratingRaw, id] = filters.cursor.split(":");
    const rating = Number(ratingRaw);
    if (Number.isFinite(rating) && id) {
      query = query.or(`rating_avg.lt.${rating},and(rating_avg.eq.${rating},id.lt.${id})`);
    }
  }

  const { data, error } = await query
    .order("rating_avg", { ascending: false })
    .order("id", { ascending: false })
    .limit(SEARCH_PAGE_SIZE + 1);

  if (error) throw error;

  const rows = data ?? [];
  const hasMore = rows.length > SEARCH_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, SEARCH_PAGE_SIZE) : rows;
  const last = page[page.length - 1];

  return {
    vessels: page.map(mapCardRow),
    nextCursor: hasMore && last ? `${last.rating_avg}:${last.id}` : null,
  };
}

export interface Amenity {
  id: string;
  key: string;
}

export async function getAllAmenities(): Promise<Amenity[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.from("amenities").select("id, key").order("key");

  if (error) throw error;
  return data ?? [];
}

export interface SearchLocation {
  id: string;
  country: LocalizedText;
  city: LocalizedText;
  latitude: number | null;
  longitude: number | null;
}

export async function getSearchLocations(): Promise<SearchLocation[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("locations")
    .select("id, country, city, latitude, longitude")
    .order("country");

  if (error) throw error;

  return (data ?? []).map((location) => ({
    id: location.id,
    country: (location.country ?? {}) as LocalizedText,
    city: (location.city ?? {}) as LocalizedText,
    latitude: location.latitude,
    longitude: location.longitude,
  }));
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
  latitude: number | null;
  longitude: number | null;
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
       rating_avg, rating_count, base_price_minor, currency, latitude, longitude,
       locations ( country, city, marina, latitude, longitude ),
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
    // Vessel's own pin refines the marina's default point when the owner set one.
    latitude: vessel.latitude ?? vessel.locations?.latitude ?? null,
    longitude: vessel.longitude ?? vessel.locations?.longitude ?? null,
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
