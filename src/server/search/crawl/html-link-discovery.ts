import "server-only";
import * as cheerio from "cheerio";
import { safeFetch, type SafeFetchOptions } from "@/server/search/crawl/safe-fetch";
import { isAllowedByRobots, type RobotsRules } from "@/server/search/crawl/robots-rules";

/**
 * Same-origin breadth-first link crawl — the URL Registry's fallback source of URLs for a site that
 * publishes no sitemap at all (no declared `Sitemap:` directive, and none of the guessed common
 * paths resolve to one — see `sitemap-discovery.ts`'s `FALLBACK_SITEMAP_PATHS`). Not a general web
 * crawler: same-origin links only, and bounded on every axis (`MAX_PAGES_TO_VISIT`, `MAX_DEPTH`,
 * `MAX_URLS_TOTAL`) the same way `full-sitemap-discovery.ts` bounds its own walk — this file is that
 * one's sibling, walking `<a href>` instead of `<loc>`.
 */

const MAX_PAGES_TO_VISIT = 150;
const MAX_URLS_TOTAL = 1500;
const MAX_DEPTH = 3;
const FETCH_CONCURRENCY = 3;

export interface CrawledUrl {
  loc: string;
}

export interface HtmlLinkDiscoveryResult {
  entries: CrawledUrl[];
  pagesVisited: number;
  /** True when a bound (pages visited, depth, or URL count) cut the walk short — same meaning as
   *  `full-sitemap-discovery.ts`'s `truncated`. */
  truncated: boolean;
}

function extractSameOriginLinks(html: string, pageUrl: string, origin: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const resolved = new URL(href, pageUrl);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
      if (resolved.origin !== origin) return;
      resolved.hash = "";
      links.add(resolved.toString());
    } catch {
      // Malformed href (e.g. "javascript:void(0)" surviving the protocol check some other way) —
      // just not a link worth following.
    }
  });

  return [...links];
}

interface CrawlState {
  visited: Set<string>;
  discovered: Set<string>;
  truncated: boolean;
}

/** Fetches `urls` with up to `FETCH_CONCURRENCY` in flight, feeding each successfully-fetched page's
 *  HTML to `onPage` as it resolves — same fixed-worker-pool shape as
 *  `full-sitemap-discovery.ts`'s `fetchSitemapsConcurrently`. */
async function fetchPagesConcurrently(
  urls: string[],
  options: SafeFetchOptions | undefined,
  onPage: (url: string, html: string) => void,
): Promise<void> {
  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex++;
      if (index >= urls.length) return;
      const url = urls[index];
      const result = await safeFetch(url, options);
      if (result.ok) onPage(url, result.body);
    }
  }
  const workerCount = Math.min(FETCH_CONCURRENCY, urls.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

async function crawlLevel(
  urls: string[],
  depth: number,
  origin: string,
  robotsRules: RobotsRules,
  state: CrawlState,
  options: SafeFetchOptions | undefined,
): Promise<void> {
  if (depth > MAX_DEPTH) {
    state.truncated = true;
    return;
  }

  const remainingBudget = MAX_PAGES_TO_VISIT - state.visited.size;
  if (remainingBudget <= 0) {
    state.truncated = true;
    return;
  }

  const eligible = urls.filter(
    (url) => !state.visited.has(url) && isAllowedByRobots(robotsRules, new URL(url).pathname),
  );
  const toFetch = eligible.slice(0, remainingBudget);
  if (toFetch.length < eligible.length) state.truncated = true;

  const nextLevel: string[] = [];
  await fetchPagesConcurrently(toFetch, options, (url, html) => {
    state.visited.add(url);
    for (const link of extractSameOriginLinks(html, url, origin)) {
      if (state.discovered.size >= MAX_URLS_TOTAL) {
        state.truncated = true;
        continue;
      }
      const isNew = !state.discovered.has(link);
      state.discovered.add(link);
      if (isNew) nextLevel.push(link);
    }
  });

  if (nextLevel.length > 0 && state.discovered.size < MAX_URLS_TOTAL) {
    await crawlLevel(nextLevel, depth + 1, origin, robotsRules, state, options);
  }
}

/**
 * Entry point: starts from `baseUrl` itself and follows same-origin links breadth-first, respecting
 * the site's own robots.txt rules on every page it would otherwise fetch. Best-effort — a homepage
 * with no internal links (a single-page app that renders navigation client-side, say) simply yields
 * just `baseUrl` back, not an error.
 */
export async function discoverUrlsByCrawling(
  baseUrl: string,
  robotsRules: RobotsRules,
  options?: SafeFetchOptions,
): Promise<HtmlLinkDiscoveryResult> {
  const origin = new URL(baseUrl).origin;
  const state: CrawlState = { visited: new Set(), discovered: new Set([baseUrl]), truncated: false };
  await crawlLevel([baseUrl], 0, origin, robotsRules, state, options);

  return {
    entries: [...state.discovered].map((loc) => ({ loc })),
    pagesVisited: state.visited.size,
    truncated: state.truncated,
  };
}
