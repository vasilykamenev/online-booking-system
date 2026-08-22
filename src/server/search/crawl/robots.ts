import "server-only";
import { safeFetch } from "@/server/search/crawl/safe-fetch";
import { isAllowedByRobots, parseRobotsTxt } from "@/server/search/crawl/robots-rules";

/**
 * Live robots.txt evaluation for one path (spec §24). The parsing/matching logic itself lives in
 * `robots-rules.ts` as plain, network-free functions; this file is just the fetch that feeds it.
 */

/**
 * Fetches and evaluates `{origin}/robots.txt` for one path. A fetch failure defaults to
 * *disallowed*, not allowed — the crawler must not treat "couldn't check" as "permission granted".
 */
export async function checkRobotsAllowed(baseUrl: string, path: string): Promise<boolean> {
  const origin = new URL(baseUrl).origin;
  const result = await safeFetch(`${origin}/robots.txt`);
  if (!result.ok) return false;
  return isAllowedByRobots(parseRobotsTxt(result.body), path);
}
