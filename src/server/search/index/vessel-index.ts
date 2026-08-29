import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ResultImage, ResultSource, VesselSearchResult } from "@/lib/search/offer";
import type { SearchCriteria } from "@/lib/search/request";
import { listingRowToResult, type FreshListingRow } from "@/server/search/registry/listing-index";

/**
 * Read side of `external_vessel_index` for Э6's candidate phase (docs/AI_Federated_Search_Migration_Plan_v1.md
 * §6, Арх §13) — a direct query across every indexed listing that might match a request, replacing
 * the old live-crawl-per-request external phase (`global-search-service.ts`'s pre-Э6 `runExternalProviders`).
 * Distinct from `registry/listing-index.ts`'s `getFreshListing`/`getStaleListing`, which look up one
 * exact `(source, url)` pair for the live path's own opportunistic P3 cache-check — this queries
 * across every row a set of covered sources hold, keyed by search criteria, not by URL.
 */

/** How stale a row may be and still be offered as a live candidate. Deliberately shorter than
 *  `index-retention.ts`'s `GONE_RETENTION_MS` (30 days, when a gone listing is physically deleted):
 *  a listing the indexer hasn't re-confirmed in over a week is old enough that showing it as a
 *  fresh find would overstate what we actually know, well before it's old enough to delete outright
 *  (that module's own doc comment already anticipates this as "whatever read-time exclusion Э6's
 *  orchestrator eventually adds"). */
export const CANDIDATE_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;

/** Upper bound on how many rows one candidate query pulls before dedup/ranking/TOP-N trims it down
 *  further. The index is currently a few hundred rows across all sources combined (Э5's own live
 *  verification numbers) — cheap to read in full and filter in application code, the same trade-off
 *  `internal-provider.ts`'s `resolveLocationIds` makes for the (also small) `locations` table. A
 *  catalog large enough to make this the bottleneck would need a real SQL-level location prefilter
 *  first (country/city columns are already indexed for exactly that); not needed yet. */
export const CANDIDATE_QUERY_LIMIT = 300;

const CANDIDATE_COLUMNS =
  "source_id, url, external_id, name, description, price_minor, currency, guests, cabins, vessel_type, vessel_type_raw, manufacturer, model, year, length_meters, region, country, city, marina, latitude, longitude, image, images, field_provenance, last_extracted_at, indexed_at, last_seen_at, vessel_identity_id, search_sources ( name, domain )";

interface IndexCandidateRow extends FreshListingRow {
  source_id: string;
  url: string;
  external_id: string;
  vessel_type: string | null;
  manufacturer: string | null;
  model: string | null;
  year: number | null;
  length_meters: number | null;
  region: string | null;
  marina: string | null;
  latitude: number | null;
  longitude: number | null;
  images: unknown;
  indexed_at: string;
  vessel_identity_id: string | null;
  search_sources: { name: string; domain: string } | null;
}

/**
 * Maps one `external_vessel_index` row onto the canonical result shape. Built on top of
 * `listingRowToResult` (the flat, always-populated comparison columns every extraction path writes
 * through `recordExtraction`) rather than the row's own `extracted` JSONB snapshot: that column
 * defaults to `{}` for any row a pre-Э5 live-crawl extraction wrote and the background indexer
 * hasn't revisited yet, which would silently produce an almost-empty result if trusted as the base.
 * The Э5-only columns (`vessel_type`, `marina`, coordinates, the multi-image array, `indexed_at`)
 * layer on top of that safe base — they only exist once the indexer has actually visited the row, so
 * a legacy row simply keeps `listingRowToResult`'s defaults (`null`/`[]`) for them, same as before
 * Э5 existed. Pure — no I/O — directly testable.
 */
export function indexRowToResult(row: IndexCandidateRow): VesselSearchResult {
  const domain = row.search_sources?.domain ?? null;
  const sourceName = row.search_sources?.name ?? domain ?? "external";
  const source: ResultSource = {
    type: "WEBSITE",
    name: sourceName,
    domain,
    url: row.url,
    retrievedAt: row.indexed_at,
  };

  const base = listingRowToResult(row, source);
  const images = Array.isArray(row.images) && row.images.length > 0 ? (row.images as ResultImage[]) : base.images;

  return {
    ...base,
    id: `${domain ?? "external"}:${row.external_id}`,
    vesselIdentityId: row.vessel_identity_id,
    sourceId: row.source_id,
    externalId: row.external_id,
    vesselType: (row.vessel_type as VesselSearchResult["vesselType"]) ?? null,
    manufacturer: row.manufacturer,
    model: row.model,
    year: row.year,
    lengthMeters: row.length_meters,
    location: {
      ...base.location,
      region: row.region,
      marina: row.marina,
      latitude: row.latitude,
      longitude: row.longitude,
    },
    images,
    indexedAt: row.indexed_at,
  };
}

/**
 * Every indexed listing from `sourceIds` fresh enough to offer (Э5's `last_seen_at`), narrowed to
 * this candidate query's cheap SQL-level filters — vessel type and guest capacity, both applied
 * null-tolerantly (an unclassified row stays a candidate; only a definite mismatch is excluded),
 * mirroring `matchesKnownCriteria`'s own null-tolerant rule so a row this query keeps is never one
 * that rule would then throw away anyway. Everything else criteria can hard-filter on (location,
 * per `matchesKnownCriteria`) or soft-score (price, per `ranking.ts`) is left to the caller — see
 * this module's own doc comment on why reading the (still small) index whole and filtering in
 * application code is the right trade-off today.
 *
 * `sourceIds` empty (no enabled source covers this request's location, Э3) short-circuits to an
 * empty result without a query — an empty `.in()` filter would otherwise match nothing anyway, but
 * skipping the round-trip makes that case free rather than merely cheap.
 */
export async function queryIndexCandidates(
  criteria: SearchCriteria,
  sourceIds: string[],
): Promise<VesselSearchResult[]> {
  if (sourceIds.length === 0) return [];

  const cutoff = new Date(Date.now() - CANDIDATE_FRESHNESS_MS).toISOString();
  let query = createAdminClient()
    .from("external_vessel_index")
    .select(CANDIDATE_COLUMNS)
    .in("source_id", sourceIds)
    .gte("last_seen_at", cutoff)
    .order("indexed_at", { ascending: false })
    .limit(CANDIDATE_QUERY_LIMIT);

  if (criteria.vesselTypes.length > 0) {
    query = query.or(`vessel_type.is.null,vessel_type.in.(${criteria.vesselTypes.join(",")})`);
  }
  if (criteria.capacity?.persons) {
    query = query.or(`guests.is.null,guests.gte.${criteria.capacity.persons}`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[queryIndexCandidates] external_vessel_index read failed", error);
    return [];
  }

  return (data ?? []).map((row) => indexRowToResult(row as unknown as IndexCandidateRow));
}
