import type { SearchCriteria } from "@/lib/search/criteria";
import type { VesselSearchResult } from "@/lib/search/result";

/**
 * Hard-filters a normalized result against criteria this source's own extraction knows reliably —
 * vessel type and guest capacity are read straight off the page's own ACF fields, not guessed, so
 * they get the same treatment `internal-provider.ts` gives its own DB columns: excluded outright,
 * not merely ranked lower. Without this, a query for "яхта … 6 человек" would still list a
 * fishing charter that seats two, relying entirely on ranking to bury it — technically sorted
 * correctly, but still occupying a result slot and inflating the shown count with a genuine
 * non-match.
 *
 * Price is deliberately absent from this check: this source never states one, so there is nothing
 * reliable to filter on, and `scorePrice` already declines to score a null price rather than
 * penalizing it.
 */
export function matchesKnownCriteria(result: VesselSearchResult, criteria: SearchCriteria): boolean {
  if (criteria.vesselType && result.vesselType && result.vesselType !== criteria.vesselType) {
    return false;
  }
  if (criteria.capacity?.persons && result.capacity.guests !== null) {
    if (result.capacity.guests < criteria.capacity.persons) return false;
  }
  return true;
}
