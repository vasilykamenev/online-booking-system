import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SearchCriteria } from "@/lib/search/request";
import type { VesselSearchResult } from "@/lib/search/offer";
import { fetchWithCache } from "@/server/search/crawl/cached-fetch";
import { hashContent } from "@/server/search/crawl/page-cache";
import { checkRobotsAllowed } from "@/server/search/crawl/robots";
import {
  emptyExternalStats,
  type ExternalSearchContext,
  type ExternalSearchOutcome,
  type ExternalSearchProvider,
  type ExternalSearchStats,
} from "@/server/search/providers";
import { parseYachtSitemap, type BrilionsSitemapEntry } from "@/server/search/providers/brilions/sitemap";
import { extractDeterministic } from "@/server/search/providers/brilions/extract";
import { extractAmenitiesWithAi } from "@/server/search/providers/brilions/ai-extract";
import {
  emptyAmenitiesExtraction,
  type AmenitiesExtraction,
} from "@/server/search/providers/brilions/amenities-extraction";
import { normalizeBrilionsResult } from "@/server/search/providers/brilions/normalize";
import { matchesKnownCriteria } from "@/lib/search/match-criteria";
import { matchingCitySlugs, selectCandidates } from "@/server/search/providers/brilions/select-candidates";

/**
 * `ExternalSearchProvider` for brilions.com — the first, and so far only, implementation of the
 * seam described in `providers.ts`. See `src/server/search/README.md` for the integration
 * research this was built from (robots.txt, page structure, the no-pricing limitation).
 *
 * ## Why this is location-gated, not a general crawl
 *
 * The site publishes ~312 vessels across Turkey and the UAE (spec §7 would call this "site-
 * specific search", not full "direct page crawling" of everything). Fetching all of them inside
 * one user request would take minutes, not the ≤1s BRD §8 asks of *internal* search — and there is
 * no PageCache-backed background indexer yet (spec §9/§10's discovery/crawling services remain
 * unbuilt, per the README). So this provider only ever fetches pages it has a specific reason to
 * believe are relevant, using the sitemap slug's city prefix as a pre-filter:
 *
 * - A query naming a country/city this site actually covers (Turkey or the UAE, by the concrete
 *   cities observed in the sitemap) fetches a bounded, city-matched subset.
 * - A query naming no location but carrying some other criterion this source can filter on
 *   (vessel type, guest count — see `select-candidates.ts`) widens to a bounded, round-robin
 *   sample across every known city, so "моторные яхты" still gets checked against this source
 *   instead of silently contributing nothing to the combined result set.
 * - A query naming no location *and* nothing else to filter on, or a location this site doesn't
 *   cover, fetches nothing and says so in `errors` — not a silent empty array, and not an
 *   unscoped sample judged against no criteria at all either.
 *
 * How many pages actually get fetched is bounded by **time**, not a fixed count: `MAX_CANDIDATE_POOL`
 * only caps how many round-robin-ordered candidates are worth considering, and `fetchCandidates`
 * below fetches them with bounded concurrency until `context.timeoutMs` runs out. A page whose HTML
 * is already warm in `PageCache` (`page-cache.ts`, 24h) costs one Supabase round-trip; a page whose
 * amenities text was already run through AI extraction this process's lifetime costs nothing further
 * (see `amenitiesCache` below) — so a search that repeats an earlier one's candidates gets
 * meaningfully more pages in the same time budget than a fully cold one.
 *
 * This is a real limitation, not a corner cut for expedience — full-corpus coverage (indexing the
 * whole catalogue ahead of time instead of crawling live per search) is written up as the next thing
 * to fix rather than worked around with a guess.
 */

const SOURCE_DOMAIN = "brilions.com";
const BASE_URL = "https://brilions.com";
const SITEMAP_URL = `${BASE_URL}/yacht-sitemap.xml`;

const SITEMAP_CACHE_MS = 24 * 60 * 60 * 1000; // The corpus changes by the week, not the minute.
const PAGE_CACHE_MS = 24 * 60 * 60 * 1000;
// How many round-robin-ordered candidates are even worth queuing. Generous on purpose: the real
// bound on pages *fetched* is `context.timeoutMs` via `fetchCandidates`'s deadline check below, so
// this only needs to be large enough that the time budget — not this number — is what runs out.
const MAX_CANDIDATE_POOL = 60;
// Parallel page fetches. Bounds concurrent load on brilions.com and concurrent Anthropic calls at
// once, while letting the time budget above buy more *total* pages per search than a sequential
// loop could fit in the same window.
const FETCH_CONCURRENCY = 5;

/** Whether this source's robots.txt currently permits `/yacht/` paths, cached on `search_sources`. */
async function resolveRobotsAllowed(): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("search_sources")
    .select("id, robots_allows")
    .eq("domain", SOURCE_DOMAIN)
    .maybeSingle();

  if (data?.robots_allows !== null && data?.robots_allows !== undefined) return data.robots_allows;

  const allowed = await checkRobotsAllowed(BASE_URL, "/yacht/x/");
  if (data) {
    await admin
      .from("search_sources")
      .update({ robots_allows: allowed, last_checked_at: new Date().toISOString() })
      .eq("id", data.id);
  }
  return allowed;
}

async function loadSitemapEntries(): Promise<BrilionsSitemapEntry[] | null> {
  const fetched = await fetchWithCache(SITEMAP_URL, SITEMAP_CACHE_MS);
  if (!fetched.ok || !fetched.html) return null;
  return parseYachtSitemap(fetched.html);
}

/**
 * In-process cache of AI amenities extraction, keyed by a hash of the amenities text itself (the
 * actual model input) rather than the page URL — so two pages that happen to carry byte-identical
 * amenities copy share one result. Deliberately not persisted (see the module doc comment): this
 * only needs to survive one warm process, not a deploy, to meaningfully cut repeat Anthropic spend
 * within a search and across a burst of similar ones. Bounded by the corpus size (~312 vessels), so
 * no eviction policy is needed.
 */
const amenitiesCache = new Map<string, AmenitiesExtraction>();

async function extractAmenitiesCached(amenitiesText: string): Promise<{ amenities: AmenitiesExtraction; usedAi: boolean }> {
  const cacheKey = hashContent(amenitiesText);
  const cached = amenitiesCache.get(cacheKey);
  if (cached) return { amenities: cached, usedAi: false };

  const amenities = await extractAmenitiesWithAi(amenitiesText);
  amenitiesCache.set(cacheKey, amenities);
  return { amenities, usedAi: true };
}

async function fetchAndNormalize(
  entry: BrilionsSitemapEntry,
  context: ExternalSearchContext,
): Promise<{ result: VesselSearchResult | null; usedAi: boolean }> {
  // The English page exists for most, not all, vessels (see sitemap.ts) — falling back to the
  // Russian canonical page keeps a vessel visible on the English UI rather than dropping it.
  const pageUrl = context.locale === "en" && entry.urlEn ? entry.urlEn : entry.urlRu;

  const page = await fetchWithCache(pageUrl, PAGE_CACHE_MS);
  if (!page.ok || !page.html) return { result: null, usedAi: false };

  const deterministic = extractDeterministic(page.html);
  if (!deterministic.name) return { result: null, usedAi: false }; // Not a real vessel page (404, moved, etc).

  const { amenities, usedAi } = deterministic.amenitiesText
    ? await extractAmenitiesCached(deterministic.amenitiesText)
    : { amenities: emptyAmenitiesExtraction, usedAi: false };

  const result = normalizeBrilionsResult({
    vesselId: entry.slug,
    sourceUrl: pageUrl,
    retrievedAt: new Date().toISOString(),
    citySlugGuess: entry.citySlugGuess,
    deterministic,
    amenities,
  });

  // `usedAi` now means "an actual Anthropic call happened", not merely "there was amenities text
  // to look at" — a cache hit still enriches the result but costs nothing, so it shouldn't count
  // toward `stats.aiCalls`, which exists specifically to track spend.
  return { result, usedAi };
}

/**
 * Fetches `toFetch` with up to `FETCH_CONCURRENCY` requests in flight at once, stopping — not
 * mid-flight, but before starting the next one — once `deadline` passes. A fixed-size pool of
 * workers pulling from a shared cursor, rather than chunking into batches of `FETCH_CONCURRENCY`:
 * a batch would let one slow page (a cold cache miss) stall every other worker in its batch until
 * it resolves, wasting exactly the time budget this exists to spend well.
 */
async function fetchCandidates(
  toFetch: BrilionsSitemapEntry[],
  criteria: SearchCriteria,
  context: ExternalSearchContext,
  deadline: number,
  stats: ExternalSearchStats,
  errors: string[],
): Promise<VesselSearchResult[]> {
  const results: VesselSearchResult[] = [];
  let nextIndex = 0;
  let stoppedForDeadline = false;

  async function worker(): Promise<void> {
    for (;;) {
      if (context.signal?.aborted || Date.now() > deadline) {
        stoppedForDeadline = true;
        return;
      }
      const index = nextIndex++;
      if (index >= toFetch.length) return;
      const entry = toFetch[index];

      try {
        const { result, usedAi } = await fetchAndNormalize(entry, context);
        stats.pagesVisited += 1;
        if (usedAi) stats.aiCalls += 1;
        if (result) {
          stats.offersExtracted += 1;
          if (matchesKnownCriteria(result, criteria)) results.push(result);
        }
      } catch (error) {
        errors.push(`brilions: ${entry.slug}: ${String(error)}`);
      }
    }
  }

  const workerCount = Math.min(FETCH_CONCURRENCY, toFetch.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (stoppedForDeadline) errors.push("brilions: stopped early — time budget exhausted");

  return results;
}

async function runSearch(
  criteria: SearchCriteria,
  context: ExternalSearchContext,
): Promise<ExternalSearchOutcome> {
  const stats: ExternalSearchStats = { ...emptyExternalStats };
  const errors: string[] = [];
  const deadline = Date.now() + context.timeoutMs;

  const allowed = await resolveRobotsAllowed();
  if (!allowed) {
    errors.push("brilions: robots.txt disallows /yacht/ — skipping");
    return { results: [], stats, errors };
  }

  const matchedSlugs = matchingCitySlugs(criteria);
  if (matchedSlugs === null) {
    errors.push(
      "brilions: no location and nothing else to filter on — skipped rather than sampling arbitrarily",
    );
    return { results: [], stats, errors };
  }
  if (matchedSlugs.size === 0) {
    // A real, informative "we checked, this source has nothing there" — not a failure.
    return { results: [], stats, errors };
  }

  const entries = await loadSitemapEntries();
  if (!entries) {
    errors.push("brilions: could not load or parse the sitemap");
    return { results: [], stats, errors };
  }
  stats.sourcesVisited = 1;

  const matchedCount = entries.filter((entry) => matchedSlugs.has(entry.citySlugGuess)).length;
  const toFetch = selectCandidates(entries, matchedSlugs, MAX_CANDIDATE_POOL);
  stats.pagesRejected = matchedCount - toFetch.length;

  const results = await fetchCandidates(toFetch, criteria, context, deadline, stats, errors);
  // Candidates queued but never reached because the deadline hit — on top of the ones the
  // candidate pool itself already excluded above.
  stats.pagesRejected += toFetch.length - stats.pagesVisited;

  return { results, stats, errors };
}

export const brilionsProvider: ExternalSearchProvider = {
  id: "brilions",
  search: runSearch,
};
