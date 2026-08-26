import type { SearchCriteria } from "@/lib/search/criteria";
import { normalizeForMatch } from "@/lib/search/text";
import type { BrilionsSitemapEntry } from "@/server/search/providers/brilions/sitemap";

/**
 * Which sitemap entries `brilionsProvider` is even allowed to consider fetching, and how many of
 * them — split out of `provider.ts` (spec §7's per-source scoping) so it can be unit-tested
 * without mocking the network/Supabase calls the rest of the provider makes.
 */

const TURKEY_CITY_SLUGS = new Set([
  "bodrum",
  "fethiye",
  "antalya",
  "marmaris",
  "gocek",
  "kemer",
  "stambul",
  "alanya",
  "kas",
  "izmir",
]);
const UAE_CITY_SLUGS = new Set(["dubai", "abu"]);
export const KNOWN_CITY_SLUGS = new Set([...TURKEY_CITY_SLUGS, ...UAE_CITY_SLUGS]);

/**
 * Matches the query's location against the (English) city names this provider recognizes. Terms
 * are compared case/diacritic-insensitively via the same `normalizeForMatch` the interpreter and
 * ranking use, so "Стамбул" and "Istanbul" both resolve to the "stambul" slug prefix.
 */
const CITY_LABELS: Record<string, string> = {
  bodrum: "Bodrum",
  fethiye: "Fethiye",
  antalya: "Antalya",
  marmaris: "Marmaris",
  gocek: "Gocek",
  kemer: "Kemer",
  stambul: "Istanbul",
  alanya: "Alanya",
  kas: "Kas",
  izmir: "Izmir",
  dubai: "Dubai",
  abu: "Abu Dhabi",
};

/**
 * True when the query carries a criterion `matchesKnownCriteria` can actually filter fetched
 * pages on (vessel type, minimum guest count) — the two fields this source's own extraction reads
 * reliably. A query with neither has nothing for a location-less fallback fetch to be judged
 * against, so it isn't worth the request budget.
 */
function hasFilterableCriteria(criteria: SearchCriteria): boolean {
  return Boolean(criteria.vesselType) || Boolean(criteria.capacity?.persons);
}

/**
 * Which known city slugs a search should fetch from, or `null` to skip this source entirely.
 *
 * A named location (city, region, or country) narrows the fetch to the matching slugs — that's
 * the common, precise case. A query naming *no* location still deserves a search when it carries
 * some other criterion this source can filter on ("моторные яхты" has no city but does have a
 * vessel type): rather than silently contributing nothing to a multi-source search, this widens
 * the scope to every known city. `selectCandidates` below keeps that bounded to the same
 * `MAX_PAGES_PER_SEARCH` budget a single-city match gets, and `matchesKnownCriteria` hard-filters
 * whatever comes back — so the widening can't blow the time budget or return off-type results.
 * Only a query with neither a location nor anything else to filter on is skipped outright, with
 * the reason recorded in `errors` rather than silently returning nothing.
 */
export function matchingCitySlugs(criteria: SearchCriteria): Set<string> | null {
  const wanted = criteria.location;
  const terms = wanted
    ? [wanted.city, wanted.region, wanted.country].filter((term): term is string => Boolean(term))
    : [];

  if (terms.length === 0) {
    return hasFilterableCriteria(criteria) ? new Set(KNOWN_CITY_SLUGS) : null;
  }

  // A specific city name is strictly more precise than the country it happens to sit in — if any
  // term names a known city directly, that's the answer, full stop. The country-level widening
  // below must only fire when nothing named a specific city; otherwise a query like "Antalya,
  // Turkey" (city *and* country both present) would let the bare "Turkey" term add every other
  // Turkish city right back in, defeating the city the query actually asked for (the bug this
  // fixes — see `select-candidates.test.ts`).
  const cityMatches = new Set<string>();
  for (const slug of KNOWN_CITY_SLUGS) {
    const label = CITY_LABELS[slug];
    for (const term of terms) {
      if (normalizeForMatch(term) === normalizeForMatch(label)) cityMatches.add(slug);
    }
  }
  if (cityMatches.size > 0) return cityMatches;

  // No term named a specific known city — fall back to country-level widening. Still bounded by
  // `selectCandidates` below, so this can't blow the request budget open.
  const matched = new Set<string>();
  for (const term of terms) {
    const normalized = normalizeForMatch(term);
    if (normalized === "turkey" || normalized === "turkiye" || normalized === "турция") {
      for (const slug of TURKEY_CITY_SLUGS) matched.add(slug);
    }
    if (normalized === "uae" || normalized === "united arab emirates" || normalized === "оаэ") {
      for (const slug of UAE_CITY_SLUGS) matched.add(slug);
    }
  }
  return matched;
}

/**
 * Picks up to `limit` sitemap entries from the matched cities, round-robin across cities rather
 * than taking the first `limit` in sitemap order. A broad match — "Turkey", or the no-location
 * fallback above, which can span all known cities — would otherwise let whichever city happens to
 * sort first in the sitemap crowd out every other one, so a location-less "моторные яхты" query
 * could easily fetch ten pages that all turn out to be the wrong vessel type by sheer bad luck of
 * ordering. Round-robin gives every matched city a fair shot at the fetch budget instead.
 */
export function selectCandidates(
  entries: BrilionsSitemapEntry[],
  matchedSlugs: Set<string>,
  limit: number,
): BrilionsSitemapEntry[] {
  const byCity = new Map<string, BrilionsSitemapEntry[]>();
  for (const entry of entries) {
    if (!matchedSlugs.has(entry.citySlugGuess)) continue;
    const bucket = byCity.get(entry.citySlugGuess);
    if (bucket) bucket.push(entry);
    else byCity.set(entry.citySlugGuess, [entry]);
  }

  const buckets = [...byCity.values()];
  const selected: BrilionsSitemapEntry[] = [];
  for (let round = 0; selected.length < limit && buckets.some((bucket) => round < bucket.length); round++) {
    for (const bucket of buckets) {
      if (selected.length >= limit) break;
      if (round < bucket.length) selected.push(bucket[round]);
    }
  }
  return selected;
}
