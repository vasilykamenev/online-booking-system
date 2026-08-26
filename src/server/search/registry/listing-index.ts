import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { emptyResult, type FieldProvenance, type ResultSource, type VesselSearchResult } from "@/lib/search/result";
import type { ListingFieldProvenance } from "@/server/search/registry/listing-merge";

/**
 * Read path counterpart to `extracted-listings.ts` (design doc §4, phase P3): lets a live search
 * serve a candidate straight from `search_extracted_listings` when a fresh-enough row exists,
 * instead of always re-fetching and re-extracting the page. `fetchAndNormalize` in
 * `providers/generic/provider.ts` remains the only thing that ever *writes* this table — this module
 * only reads what it already wrote, on some earlier request.
 */

export interface FreshListingRow {
  name: string | null;
  description: string | null;
  price_minor: number | null;
  currency: string | null;
  guests: number | null;
  cabins: number | null;
  vessel_type_raw: string | null;
  country: string | null;
  city: string | null;
  image: string | null;
  field_provenance: ListingFieldProvenance;
  last_extracted_at: string;
}

const LISTING_ROW_COLUMNS =
  "name, description, price_minor, currency, guests, cabins, vessel_type_raw, country, city, image, field_provenance, last_extracted_at";

/** `null` when there is no row at all, or the row is older than `maxAgeMs` — a stale row is treated
 *  exactly like a missing one, falling back to a live fetch (which then refreshes it). */
export async function getFreshListing(
  sourceId: string,
  url: string,
  maxAgeMs: number,
): Promise<FreshListingRow | null> {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const { data } = await createAdminClient()
    .from("search_extracted_listings")
    .select(LISTING_ROW_COLUMNS)
    .eq("source_id", sourceId)
    .eq("url", url)
    .gte("last_extracted_at", cutoff)
    .maybeSingle();
  return (data as FreshListingRow | null) ?? null;
}

/**
 * Whatever row is stored, regardless of age — the counterpart `getFreshListing` needs for the
 * ETag/If-Modified-Since path (design doc §5.4): before running a full re-extraction on an
 * otherwise-stale row, `providers/generic/provider.ts` checks whether the underlying page even
 * changed at all, and if not, reuses this row's already-extracted values rather than discarding
 * them just because `INDEX_FRESHNESS_MS` elapsed.
 */
export async function getStaleListing(sourceId: string, url: string): Promise<FreshListingRow | null> {
  const { data } = await createAdminClient()
    .from("search_extracted_listings")
    .select(LISTING_ROW_COLUMNS)
    .eq("source_id", sourceId)
    .eq("url", url)
    .maybeSingle();
  return (data as FreshListingRow | null) ?? null;
}

/** Only these six carry provenance on the ephemeral `VesselSearchResult` in the live path too
 *  (`providers/generic/normalize.ts`) — description and image never do, matching that convention. */
const PROVENANCE_FIELDS: { row: keyof ListingFieldProvenance; result: string }[] = [
  { row: "name", result: "name" },
  { row: "guests", result: "capacity.guests" },
  { row: "cabins", result: "capacity.cabins" },
  { row: "vessel_type_raw", result: "vesselTypeRaw" },
  { row: "country", result: "location.country" },
  { row: "city", result: "location.city" },
];

/**
 * Maps a stored row back onto the canonical result shape, mirroring `normalizeGenericResult`.
 * Pure — no I/O — so it's directly testable without a database.
 *
 * Provenance: the ephemeral `FieldProvenance` convention (`result.ts`) is "present only for
 * AI-derived fields" — a stored field whose last extraction came from `SELECTOR`/`JSON_LD`/`MANUAL`
 * gets no entry here, same as it wouldn't on a freshly-extracted result from that same tier.
 */
export function listingRowToResult(row: FreshListingRow, source: ResultSource): VesselSearchResult {
  const result = emptyResult(`${source.domain}:${source.url}`, "EXTERNAL", source);

  const fieldProvenance: Record<string, FieldProvenance> = {};
  for (const { row: rowField, result: resultField } of PROVENANCE_FIELDS) {
    const entry = row.field_provenance[rowField];
    if (entry && entry.source === "AI") {
      fieldProvenance[resultField] = { sourceUrl: entry.sourceUrl, confidence: entry.confidence };
    }
  }

  return {
    ...result,
    name: row.name,
    vesselTypeRaw: row.vessel_type_raw,
    capacity: { guests: row.guests, cabins: row.cabins, beds: null },
    location: {
      country: row.country,
      region: null,
      city: row.city,
      marina: null,
      latitude: null,
      longitude: null,
    },
    rental: { ...result.rental, priceMinor: row.price_minor, currency: row.currency },
    description: row.description,
    images: row.image ? [{ url: row.image, alt: row.name }] : [],
    fieldProvenance,
  };
}
