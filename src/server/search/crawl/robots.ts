import "server-only";
import { safeFetch, type SafeFetchOptions } from "@/server/search/crawl/safe-fetch";
import {
  extractSitemapDirectives,
  isAllowedByRobots,
  parseRobotsTxt,
  type RobotsRules,
} from "@/server/search/crawl/robots-rules";

/**
 * Live robots.txt evaluation (spec §24). The parsing/matching logic itself lives in
 * `robots-rules.ts` as plain, network-free functions; this file is just the fetch that feeds it.
 */

export interface RobotsInfo {
  found: boolean;
  rules: RobotsRules;
  sitemapUrls: string[];
}

/** Fetches and parses `{origin}/robots.txt` once — used by both `checkRobotsAllowed` (a single
 *  path check) and anything that also wants the declared `Sitemap:` URLs (source registration,
 *  the generic provider's candidate discovery) without re-fetching. */
export async function fetchRobotsInfo(baseUrl: string, options?: SafeFetchOptions): Promise<RobotsInfo> {
  const origin = new URL(baseUrl).origin;
  const result = await safeFetch(`${origin}/robots.txt`, options);
  if (!result.ok) return { found: false, rules: { rules: [] }, sitemapUrls: [] };
  return {
    found: true,
    rules: parseRobotsTxt(result.body),
    sitemapUrls: extractSitemapDirectives(result.body),
  };
}

/**
 * Evaluates one path against `{origin}/robots.txt`. A fetch failure defaults to *disallowed*, not
 * allowed — the crawler must not treat "couldn't check" as "permission granted".
 */
export async function checkRobotsAllowed(baseUrl: string, path: string): Promise<boolean> {
  const info = await fetchRobotsInfo(baseUrl);
  if (!info.found) return false;
  return isAllowedByRobots(info.rules, path);
}
