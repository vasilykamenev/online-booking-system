/**
 * Parses `yacht-sitemap.xml` (WordPress/Yoast SEO's custom-post-type sitemap for the `yacht` post
 * type) into one entry per vessel, with both locale URLs merged.
 *
 * Observed during integration research (2026-08-21): 601 `<loc>` entries, of which 2 are the
 * archive root (`/yacht/`, `/en/yacht/`) rather than a detail page, and the remaining 599 split
 * into 312 Russian + 287 English URLs for the same ~312 vessels (a few vessels apparently lack an
 * English translation yet). Every detail URL follows `/yacht/{slug}/` or `/en/yacht/{slug}/` —
 * the slug is shared between locales, which is what lets this pair them up without fetching
 * anything.
 */

export interface BrilionsSitemapEntry {
  slug: string;
  /** First hyphen-delimited segment of the slug — usually the city, e.g. "antalya" in
   *  "antalya-adelya". Not a guaranteed city (a few slugs are named after the boat instead,
   *  e.g. "gulet-*"), so callers must treat this as a fast pre-filter, never as ground truth
   *  about where the vessel actually is — the page itself states the real port. */
  citySlugGuess: string;
  urlRu: string;
  urlEn: string | null;
}

const DETAIL_URL_PATTERN = /^https:\/\/brilions\.com\/(en\/)?yacht\/([a-z0-9-]+)\/$/;

/** Pure XML parsing via regex, not a full XML parser: the sitemap's `<loc>` structure is fixed and simple enough that a dependency isn't warranted for it alone. */
function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());
}

export function parseYachtSitemap(xml: string): BrilionsSitemapEntry[] {
  const bySlug = new Map<string, { urlRu: string | null; urlEn: string | null }>();

  for (const loc of extractLocs(xml)) {
    const match = DETAIL_URL_PATTERN.exec(loc);
    if (!match) continue; // Skips the bare `/yacht/`/`/en/yacht/` archive roots and anything unexpected.
    const [, enPrefix, slug] = match;
    const entry = bySlug.get(slug) ?? { urlRu: null, urlEn: null };
    if (enPrefix) entry.urlEn = loc;
    else entry.urlRu = loc;
    bySlug.set(slug, entry);
  }

  const entries: BrilionsSitemapEntry[] = [];
  for (const [slug, { urlRu, urlEn }] of bySlug) {
    // The Russian page is treated as canonical: it's the one guaranteed to exist for every
    // vessel, and numeric fields (guests, cabins, year, length) don't depend on locale anyway.
    if (!urlRu) continue;
    entries.push({ slug, citySlugGuess: slug.split("-")[0], urlRu, urlEn });
  }
  return entries;
}
