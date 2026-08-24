import "server-only";
import { safeFetch, type SafeFetchOptions } from "@/server/search/crawl/safe-fetch";
import { FALLBACK_SITEMAP_PATHS } from "@/server/search/crawl/sitemap-discovery";
import {
  getSitemapRootKind,
  looksLikeSitemap,
  parseSitemapEntries,
  type SitemapEntry,
} from "@/server/search/crawl/sitemap-rules";

/**
 * Full, recursive sitemap walk for the URL Registry (docs/CLAUDE_SITEMAP_AI_CRAWLER_RULE.md §2.3,
 * §5.2) — deliberately separate from `sitemap-discovery.ts`'s `discoverSitemap`, which stays a fast,
 * shallow, single-sitemap lookup for live search and registration preview (see that file's own doc
 * comment on why it doesn't resolve `<sitemapindex>`). This one does resolve indexes, recursively,
 * because a URL Registry sync (`registry/url-registry-sync.ts`) is an explicit, admin-triggered
 * operation where a few extra seconds are an acceptable cost for actually seeing the whole catalog —
 * unlike a page load a user is waiting on.
 *
 * Bounded on every axis the rule document calls out (§5.2): recursion depth, how many sitemap
 * documents get fetched at all, and how many URL entries get returned — a malicious or pathological
 * site must not be able to turn "sync one source" into an unbounded crawl.
 */

const MAX_SITEMAP_DEPTH = 3;
const MAX_SITEMAPS_TO_FETCH = 20;
const MAX_URLS_TOTAL = 3000;
/** Child sitemaps at the same depth are fetched with limited concurrency — same fixed-worker-pool
 *  shape as `providers/generic/provider.ts`'s `fetchCandidates`, so one slow/hostile child sitemap
 *  can't serialize the whole walk. */
const FETCH_CONCURRENCY = 3;

export interface DiscoveredUrl extends SitemapEntry {
  sourceSitemap: string;
}

export interface FullSitemapDiscoveryResult {
  entries: DiscoveredUrl[];
  sitemapsVisited: string[];
  /** True when a bound (depth, sitemap count, or URL count) cut the walk short — surfaced so the
   *  caller/admin can tell "this is everything" from "this is a truncated sample". */
  truncated: boolean;
}

interface WalkState {
  entries: DiscoveredUrl[];
  sitemapsVisited: Set<string>;
  truncated: boolean;
}

async function fetchOneSitemap(
  url: string,
  options: SafeFetchOptions | undefined,
): Promise<string | null> {
  const result = await safeFetch(url, options);
  if (!result.ok || !looksLikeSitemap(result.body)) return null;
  return result.body;
}

/** Fetches `urls` with up to `FETCH_CONCURRENCY` in flight, feeding each successfully-parsed
 *  sitemap to `onSitemap` as it resolves — mirrors `provider.ts`'s `fetchCandidates` worker shape. */
async function fetchSitemapsConcurrently(
  urls: string[],
  options: SafeFetchOptions | undefined,
  onSitemap: (url: string, xml: string) => void,
): Promise<void> {
  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex++;
      if (index >= urls.length) return;
      const xml = await fetchOneSitemap(urls[index], options);
      if (xml) onSitemap(urls[index], xml);
    }
  }
  const workerCount = Math.min(FETCH_CONCURRENCY, urls.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

async function walk(
  sitemapUrls: string[],
  depth: number,
  state: WalkState,
  options: SafeFetchOptions | undefined,
): Promise<void> {
  if (depth > MAX_SITEMAP_DEPTH) {
    state.truncated = true;
    return;
  }

  const remainingBudget = MAX_SITEMAPS_TO_FETCH - state.sitemapsVisited.size;
  if (remainingBudget <= 0) {
    state.truncated = true;
    return;
  }
  const toFetch = sitemapUrls.filter((url) => !state.sitemapsVisited.has(url)).slice(0, remainingBudget);
  if (toFetch.length < sitemapUrls.length) state.truncated = true;

  const childIndexes: string[] = [];

  await fetchSitemapsConcurrently(toFetch, options, (url, xml) => {
    state.sitemapsVisited.add(url);
    const kind = getSitemapRootKind(xml);
    const parsed = parseSitemapEntries(xml);

    if (kind === "sitemapindex") {
      for (const entry of parsed) childIndexes.push(entry.loc);
      return;
    }

    // urlset (or an unrecognized-but-loc-bearing document — treat as leaf, same tolerance
    // `looksLikeSitemap` already applies before this callback runs).
    for (const entry of parsed) {
      if (state.entries.length >= MAX_URLS_TOTAL) {
        state.truncated = true;
        return;
      }
      state.entries.push({ ...entry, sourceSitemap: url });
    }
  });

  if (childIndexes.length > 0 && state.entries.length < MAX_URLS_TOTAL) {
    await walk(childIndexes, depth + 1, state, options);
  }
}

/**
 * Entry point: same declared-sitemap-then-fallback-paths discovery as `sitemap-discovery.ts`, but
 * walks every sitemap it finds (recursing into `sitemapindex` documents) instead of stopping at the
 * first one that parses. Reuses that file's fallback path list rather than duplicating it.
 */
export async function discoverAllSitemapEntries(
  origin: string,
  declaredUrls: string[],
  options?: SafeFetchOptions,
): Promise<FullSitemapDiscoveryResult> {
  const roots = declaredUrls.length > 0 ? declaredUrls : FALLBACK_SITEMAP_PATHS.map((path) => `${origin}${path}`);

  const state: WalkState = { entries: [], sitemapsVisited: new Set(), truncated: false };
  await walk(roots, 0, state, options);

  return {
    entries: state.entries,
    sitemapsVisited: [...state.sitemapsVisited],
    truncated: state.truncated,
  };
}
