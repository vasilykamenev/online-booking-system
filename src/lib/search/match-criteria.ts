import type { SearchCriteria } from "@/lib/search/criteria";
import type { VesselSearchResult } from "@/lib/search/result";

/**
 * Hard-filters a normalized result against criteria this source's own extraction knows reliably —
 * vessel type and guest capacity, when a provider actually determined them (not guessed), get the
 * same treatment `internal-provider.ts` gives its own DB columns: excluded outright, not merely
 * ranked lower. Without this, a query for "яхта … 6 человек" would still list a fishing charter
 * that seats two, relying entirely on ranking to bury it — technically sorted correctly, but still
 * occupying a result slot and inflating the shown count with a genuine non-match.
 *
 * Provider-agnostic on purpose (originally lived under `providers/brilions/`, promoted here once a
 * second provider needed the exact same filter): any `ExternalSearchProvider` whose extraction
 * reliably determines type/capacity should use this rather than relying on ranking alone.
 *
 * Price is deliberately absent from this check — a provider that never states one (or one whose
 * price for this listing is unknown) has nothing reliable to filter on, and `scorePrice` already
 * declines to score a null price rather than penalizing it.
 *
 * Location is the opposite case from price: when the query asks for a city or country,
 * `ranking.ts`'s `scoreLocation` alone isn't enough — it *scores* a location mismatch or a missing
 * location the same way (both just don't contribute to the average), which lets a result with no
 * location at all keep occupying a result slot on an unverifiable guess. `internal-provider.ts`
 * already enforces the stricter rule at the DB level ("we have no location for it — filter it out,
 * we genuinely have nothing there", its own `resolveLocationIds` comment) because every internal
 * vessel has a required location; external extraction has no equivalent guarantee, so this is the
 * external-provider mirror of that same principle, hard rather than soft.
 */
export function matchesKnownCriteria(result: VesselSearchResult, criteria: SearchCriteria): boolean {
  if (criteria.vesselTypes.length > 0 && result.vesselType && !criteria.vesselTypes.includes(result.vesselType)) {
    return false;
  }
  if (criteria.capacity?.persons && result.capacity.guests !== null) {
    if (result.capacity.guests < criteria.capacity.persons) return false;
  }
  if ((criteria.location?.city || criteria.location?.country) && !result.location.city && !result.location.country) {
    return false;
  }
  return true;
}
