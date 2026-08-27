import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { parseDateRangeLiteral } from "@/lib/supabase/date-range";
import { isRangeAvailable, type DateInterval } from "@/lib/availability/ranges";
import type { VesselSort } from "@/lib/validation/search";
import {
  VESSEL_SORT_CONFIG,
  buildVesselCursorFilter,
  decodeVesselCursor,
  encodeVesselCursor,
} from "@/lib/search/vessel-cursor";

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

export const CARD_COLUMNS = `id, slug, type, name, rating_avg, guests_capacity, cabins, length_meters, base_price_minor, currency, latitude, longitude,
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
  // Not on `FeaturedVessel` (no card shows it yet) — kept on the row only so `searchVessels` can
  // build a keyset cursor when sorting by length, the same way it already does for rating/price.
  length_meters: number;
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

  throwIfSupabaseError(error);

  return (data ?? []).map(mapCardRow);
}

export interface SearchFilters {
  type?: Database["public"]["Enums"]["vessel_type"];
  locationId?: string;
  guests?: number;
  priceMinMinor?: number;
  priceMaxMinor?: number;
  lengthMin?: number;
  lengthMax?: number;
  cabinsMin?: number;
  /** Only ever filters together — see `searchVessels`'s `wantsDateFilter`. */
  dateFrom?: string;
  dateTo?: string;
  sort?: VesselSort;
  cursor?: string;
}

export interface SearchResult {
  vessels: FeaturedVessel[];
  nextCursor: string | null;
}

const SEARCH_PAGE_SIZE = 8;
/** Over-fetch factor when a date filter is active — see the "flexible search" comment below. */
const DATE_FILTER_BATCH_SIZE = SEARCH_PAGE_SIZE * 3;
/** Bounds how many over-fetched batches one search will scan for available vessels — same
 *  budget-over-exhaustiveness principle as `MAX_CANDIDATE_POOL` in the external search providers. */
const MAX_DATE_FILTER_ITERATIONS = 5;

/**
 * One page of `vessels` matching every filter that maps directly to a column — every `if` here is
 * independent, so any subset of `filters` (or none at all) produces a valid query. Date-range
 * availability is deliberately not one of these `if`s: it isn't a column on `vessels`, so it can't
 * be pushed into this WHERE clause the way price/length/cabins/guests can — see `searchVessels`.
 */
async function fetchVesselPage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filters: Omit<SearchFilters, "cursor" | "sort">,
  sort: VesselSort,
  cursor: string | undefined,
  limit: number,
): Promise<{ rows: CardRow[]; nextCursor: string | null }> {
  const { column, ascending } = VESSEL_SORT_CONFIG[sort];
  let query = supabase.from("vessels").select(CARD_COLUMNS).eq("status", "published");

  if (filters.type) query = query.eq("type", filters.type);
  if (filters.locationId) query = query.eq("location_id", filters.locationId);
  if (filters.guests) query = query.gte("guests_capacity", filters.guests);
  if (filters.cabinsMin) query = query.gte("cabins", filters.cabinsMin);
  if (filters.lengthMin) query = query.gte("length_meters", filters.lengthMin);
  if (filters.lengthMax) query = query.lte("length_meters", filters.lengthMax);
  if (filters.priceMinMinor) query = query.gte("base_price_minor", filters.priceMinMinor);
  if (filters.priceMaxMinor) query = query.lte("base_price_minor", filters.priceMaxMinor);

  query = query.order(column, { ascending }).order("id", { ascending: false });
  const decoded = cursor ? decodeVesselCursor(cursor) : null;
  if (decoded) query = query.or(buildVesselCursorFilter(sort, decoded));

  const { data, error } = await query.limit(limit + 1);
  throwIfSupabaseError(error);

  const rows = (data ?? []) as unknown as CardRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    rows: page,
    nextCursor: hasMore && last ? encodeVesselCursor(last[column], last.id) : null,
  };
}

/**
 * Which of `vesselIds` are free for `[dateFrom, dateTo)` — two bulk queries, not 2N, same shape as
 * `searchInternalVessels`'s `loadUnavailableRanges` (`server/search/internal-provider.ts`), which
 * this deliberately mirrors rather than a third reimplementation of the same join. `bookings` is
 * read through the security-definer `get_vessels_booked_ranges` RPC because the `bookings_read` RLS
 * policy only exposes a client's own rows, while *whether* a vessel is booked for a window is
 * public information on a published vessel (the RPC enforces that itself).
 */
async function availableVesselIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  vesselIds: string[],
  dateFrom: string,
  dateTo: string,
): Promise<Set<string>> {
  if (vesselIds.length === 0) return new Set();

  const [blocked, booked] = await Promise.all([
    supabase.from("availability").select("vessel_id, date_range").in("vessel_id", vesselIds),
    supabase.rpc("get_vessels_booked_ranges", { p_vessel_ids: vesselIds }),
  ]);
  throwIfSupabaseError(blocked.error);
  throwIfSupabaseError(booked.error);

  const unavailable = new Map<string, DateInterval[]>();
  const push = (vesselId: string, raw: string) => {
    const list = unavailable.get(vesselId) ?? [];
    list.push(parseDateRangeLiteral(raw));
    unavailable.set(vesselId, list);
  };
  // `daterange` has no TypeScript equivalent, so the generated types surface it as `unknown`.
  for (const row of blocked.data ?? []) push(row.vessel_id, row.date_range as string);
  for (const row of booked.data ?? []) push(row.vessel_id, row.date_range as string);

  const requested: DateInterval = { start: dateFrom, end: dateTo };
  return new Set(vesselIds.filter((id) => isRangeAvailable(requested, unavailable.get(id) ?? [])));
}

/**
 * The catalog search page's main query (`(booking)/search`). Every filter is optional and
 * independent — this is a browse/filter UI, not a wizard, so "only a location", "only dates",
 * "everything at once", and "nothing at all" must all be valid, equally cheap calls.
 *
 * Dates are the one filter that can't be expressed as a plain column comparison, so they take a
 * different path: `wantsDateFilter` only turns on once *both* `dateFrom` and `dateTo` are present
 * (`searchParamsSchema` never lets a lone end reach here) — otherwise this behaves exactly like the
 * pre-dates version of this function. When it is on, each raw page is over-fetched
 * (`DATE_FILTER_BATCH_SIZE`) and walked in original sort order, keeping the first
 * `SEARCH_PAGE_SIZE` available rows; the returned cursor resumes from the exact raw row that walk
 * stopped at — never the over-fetched batch's own cursor, or rows this call skipped past would be
 * silently lost on the next "Load more". Bounded by `MAX_DATE_FILTER_ITERATIONS`: a search that
 * needs more than that many batches to fill a page just returns a shorter page, the same
 * budget-over-exhaustiveness trade-off `providers/generic/provider.ts` makes for external sources.
 */
export async function searchVessels(filters: SearchFilters): Promise<SearchResult> {
  const supabase = await createClient();
  const sort = filters.sort ?? "rating_desc";
  const wantsDateFilter = Boolean(filters.dateFrom && filters.dateTo);

  if (!wantsDateFilter) {
    const { rows, nextCursor } = await fetchVesselPage(supabase, filters, sort, filters.cursor, SEARCH_PAGE_SIZE);
    return { vessels: rows.map(mapCardRow), nextCursor };
  }

  const { column } = VESSEL_SORT_CONFIG[sort];
  const collected: CardRow[] = [];
  let cursor = filters.cursor;
  let resumeCursor: string | null = null;

  for (let iteration = 0; iteration < MAX_DATE_FILTER_ITERATIONS; iteration++) {
    const { rows, nextCursor } = await fetchVesselPage(supabase, filters, sort, cursor, DATE_FILTER_BATCH_SIZE);
    if (rows.length === 0) {
      resumeCursor = null;
      break;
    }

    const available = await availableVesselIds(
      supabase,
      rows.map((row) => row.id),
      filters.dateFrom!,
      filters.dateTo!,
    );

    let filledThisBatch = false;
    for (const row of rows) {
      if (!available.has(row.id)) continue;
      collected.push(row);
      if (collected.length === SEARCH_PAGE_SIZE) {
        resumeCursor = encodeVesselCursor(row[column], row.id);
        filledThisBatch = true;
        break;
      }
    }
    if (filledThisBatch) break;

    resumeCursor = nextCursor;
    if (!nextCursor) break; // Upstream is exhausted — nothing left to try.
    cursor = nextCursor;
  }

  return { vessels: collected.map(mapCardRow), nextCursor: resumeCursor };
}

export interface Amenity {
  id: string;
  key: string;
}

export async function getAllAmenities(): Promise<Amenity[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.from("amenities").select("id, key").order("key");

  throwIfSupabaseError(error);
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

  throwIfSupabaseError(error);

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
  description: LocalizedText;
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

  throwIfSupabaseError(error);
  if (!vessel) return null;

  const { data: reviews, error: reviewsError } = await supabase
    .from("reviews")
    .select("id, rating, comment, created_at")
    .eq("vessel_id", vessel.id)
    .order("created_at", { ascending: false });

  throwIfSupabaseError(reviewsError);

  return {
    id: vessel.id,
    slug: vessel.slug,
    type: vessel.type,
    name: vessel.name,
    description: (vessel.description ?? {}) as LocalizedText,
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
