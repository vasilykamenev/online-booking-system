/**
 * Which sitemap URLs a generic provider (`providers/generic/provider.ts`) is even worth fetching,
 * and how many — split out the same way `providers/brilions/select-candidates.ts` is, so it's
 * unit-testable without the network/Supabase calls the rest of the provider makes.
 *
 * Unlike brilions' city-slug heuristic, there is no site-agnostic way to pre-filter an arbitrary
 * sitemap by location or vessel type before fetching — so this is deliberately location-blind: an
 * evenly-spaced sample of the sitemap's own order, not the first `limit` entries. A "first N" pick
 * would bias toward however the site happens to order its sitemap (often alphabetical, which can
 * bunch by name/model rather than spread across the catalog) — an even stride at least gives every
 * part of the catalog a fair shot at the fetch budget, the same fairness goal brilions' round-robin
 * serves for its city buckets, just without buckets to round-robin over.
 */
export function selectGenericCandidates(urls: string[], limit: number): string[] {
  if (limit <= 0 || urls.length === 0) return [];
  if (urls.length <= limit) return urls;

  const step = urls.length / limit;
  const selected: string[] = [];
  for (let i = 0; i < limit; i++) {
    selected.push(urls[Math.floor(i * step)]);
  }
  return selected;
}
