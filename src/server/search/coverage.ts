import { normalizeForMatch } from "@/lib/search/text";
import { isWithinRadiusKm } from "@/lib/search/geo";
import type { SearchCriteria } from "@/lib/search/request";

/**
 * `SourceCoverage` (Арх §9) — asked *before* a source is ever consulted, so a source that only
 * serves the Baltic never spends crawl budget on a query naming Greece. One source can have several
 * rows (a regional operator covering two neighbouring countries, say); any one row matching is
 * enough for the source to be considered.
 */
export interface SourceCoverageRow {
  worldwide: boolean;
  country: string | null;
  region: string | null;
  destination: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusKm: number | null;
}

function matchesPlace(coverageValue: string | null, requestValue: string | null | undefined): boolean {
  if (!coverageValue || !requestValue) return false;
  return normalizeForMatch(coverageValue) === normalizeForMatch(requestValue);
}

/**
 * True when `coverage` covers the place `request` names — or when there is nothing to disqualify a
 * source over: no coverage configured yet, no location in the request, or a source explicitly
 * marked worldwide. "Unconfigured" deliberately means "don't exclude", never "excludes everything" —
 * the same "absent beats invented" discipline `SearchCriteria` follows, applied to registry data:
 * an admin who hasn't gotten around to filling in coverage yet must not silently lose their source
 * from every search.
 */
export function sourceCovers(coverage: SourceCoverageRow[], request: SearchCriteria): boolean {
  if (coverage.length === 0) return true;
  if (coverage.some((row) => row.worldwide)) return true;

  const location = request.location;
  if (!location) return true;

  return coverage.some((row) => {
    if (matchesPlace(row.country, location.country)) return true;
    if (matchesPlace(row.region, location.region)) return true;
    if (matchesPlace(row.destination, location.city) || matchesPlace(row.destination, location.marina)) {
      return true;
    }

    if (
      row.latitude !== null &&
      row.longitude !== null &&
      row.radiusKm !== null &&
      location.latitude !== null &&
      location.longitude !== null
    ) {
      // The coverage circle plus however far the request itself is willing to search — a request
      // for "within 50km of Split" should still reach a source whose own covered circle just
      // touches that radius, not only one whose center is inside it.
      const effectiveRadiusKm = row.radiusKm + (request.searchRadiusKm ?? 0);
      return isWithinRadiusKm(
        { latitude: row.latitude, longitude: row.longitude },
        { latitude: location.latitude, longitude: location.longitude },
        effectiveRadiusKm,
      );
    }

    return false;
  });
}
