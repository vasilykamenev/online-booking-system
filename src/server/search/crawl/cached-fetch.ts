import "server-only";
import { safeFetch, type SafeFetchOptions } from "@/server/search/crawl/safe-fetch";
import { getCachedPage, putCachedPage } from "@/server/search/crawl/page-cache";

/**
 * `safeFetch` + `PageCache` combined: the shape every provider actually wants — "give me this
 * page's HTML, fetching only if the cache is stale."
 */
export interface CachedFetchResult {
  ok: boolean;
  html: string | null;
  fromCache: boolean;
  reason?: string;
}

export async function fetchWithCache(
  url: string,
  maxAgeMs: number,
  options?: SafeFetchOptions,
): Promise<CachedFetchResult> {
  const cached = await getCachedPage(url, maxAgeMs);
  if (cached) return { ok: true, html: cached.html, fromCache: true };

  const fetched = await safeFetch(url, options);
  if (!fetched.ok) return { ok: false, html: null, fromCache: false, reason: fetched.reason };

  await putCachedPage(url, fetched.body, fetched.status);
  return { ok: true, html: fetched.body, fromCache: false };
}
