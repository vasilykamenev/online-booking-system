/**
 * Pure sitemap sniffing, split out the same way `robots-rules.ts` is split from `robots.ts` — no
 * network, so it's unit-testable on its own. Regex-based, not a full XML parser: mirrors the same
 * deliberate shortcut as `providers/brilions/sitemap.ts` — a sitemap's `<loc>` structure is fixed
 * and simple enough that a dependency isn't warranted just to sniff it during source registration.
 */

function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());
}

export function countSitemapLocs(xml: string): number {
  return extractLocs(xml).length;
}

/**
 * A handful of candidate detail-page URLs to sample during source registration (spec §9's
 * "does it contain vessel rental offers?"), not the whole catalog. Excludes the site's own base
 * URL, which sitemaps sometimes list alongside real detail pages and which tells us nothing new —
 * it was already fetched by the reachability check.
 */
export function sampleSitemapLocs(xml: string, limit: number, excludeUrl?: string): string[] {
  const locs = extractLocs(xml).filter((loc) => loc !== excludeUrl);
  return locs.slice(0, limit);
}

/**
 * True when the document looks like an actual sitemap (a `<urlset>` or `<sitemapindex>` root with
 * at least one `<loc>`), not e.g. an HTML 404/error page a misconfigured server returned with a
 * 200 status for a guessed path like `/sitemap.xml`.
 */
export function looksLikeSitemap(xml: string): boolean {
  return /<(urlset|sitemapindex)[\s>]/i.test(xml) && countSitemapLocs(xml) > 0;
}
