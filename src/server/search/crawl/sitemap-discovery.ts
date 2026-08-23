import "server-only";
import { safeFetch, type SafeFetchOptions } from "@/server/search/crawl/safe-fetch";
import { countSitemapLocs, looksLikeSitemap } from "@/server/search/crawl/sitemap-rules";

/**
 * Finds and fetches one sitemap for a site — shared by `source-validation.ts` (registration-time
 * preview) and `providers/generic/provider.ts` (candidate discovery for an actual search), so the
 * two don't drift into slightly different notions of "does this site have a sitemap".
 *
 * Deliberately does not resolve a `<sitemapindex>` into its child sitemaps — a known gap, not an
 * oversight: a site whose declared sitemap is purely an index of indexes yields no candidates here.
 * Registration preview only ever samples a handful of pages anyway, and the generic provider is a
 * live, time-budgeted crawl (see its module doc) where recursing into child sitemaps would eat into
 * a budget better spent fetching actual candidate pages. Worth revisiting if a registered source
 * turns out to need it.
 */

export interface SitemapDiscoveryResult {
  url: string;
  xml: string;
  entryCount: number;
}

/** Tried only when the site declares no `Sitemap:` directive of its own in robots.txt. Exported so
 *  `providers/generic/provider.ts` can reuse the exact same guesses for its own cached fetch. */
export const FALLBACK_SITEMAP_PATHS = ["/sitemap.xml", "/sitemap_index.xml"];
/** Bounds how many candidate sitemap URLs get fetched while looking for one that's real. */
export const MAX_SITEMAP_CANDIDATES = 3;

export async function discoverSitemap(
  origin: string,
  declaredUrls: string[],
  options?: SafeFetchOptions,
): Promise<SitemapDiscoveryResult | null> {
  const candidates = (
    declaredUrls.length > 0 ? declaredUrls : FALLBACK_SITEMAP_PATHS.map((path) => `${origin}${path}`)
  ).slice(0, MAX_SITEMAP_CANDIDATES);

  for (const url of candidates) {
    const result = await safeFetch(url, options);
    if (result.ok && looksLikeSitemap(result.body)) {
      return { url, xml: result.body, entryCount: countSitemapLocs(result.body) };
    }
  }
  return null;
}
