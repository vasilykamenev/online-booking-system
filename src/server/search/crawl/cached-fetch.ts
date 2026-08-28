import "server-only";
import { safeFetch, safeFetchConditional, type SafeFetchOptions } from "@/server/search/crawl/safe-fetch";
import { getCachedPage, putCachedPage, touchCachedPage } from "@/server/search/crawl/page-cache";

/**
 * `safeFetch` + `PageCache` combined: the shape every provider actually wants — "give me this
 * page's HTML, fetching only if the cache is stale." Owns the freshness policy (`page-cache.ts` is
 * just storage): a row within `maxAgeMs` is used as-is; a stale row that still carries a validator
 * (`etag`/`last_modified`) gets a conditional GET instead of a full re-fetch (design doc §5.4) — a
 * `304` means the origin confirms nothing changed, cheaper than a full transfer and lets a caller
 * skip re-processing the (unchanged) content entirely; only a row with no validator at all, or a
 * revalidation that itself fails (network/timeout), falls back to the original unconditional fetch.
 */
export interface CachedFetchResult {
  ok: boolean;
  html: string | null;
  fromCache: boolean;
  /** Set only when a conditional GET actually happened (as opposed to a plain in-window cache hit)
   *  and the origin confirmed the content is byte-identical to what's already stored — the signal
   *  `providers/generic/provider.ts` uses to skip re-extraction for an otherwise-stale
   *  `external_vessel_index` row. Absent (not merely `false`) whenever no conditional check
   *  happened, so a caller can tell "confirmed unchanged" apart from "don't know". */
  contentUnchanged?: boolean;
  reason?: string;
}

export async function fetchWithCache(
  url: string,
  maxAgeMs: number,
  options?: SafeFetchOptions,
): Promise<CachedFetchResult> {
  const cached = await getCachedPage(url);
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() <= maxAgeMs) {
    return { ok: true, html: cached.html, fromCache: true };
  }

  if (cached && (cached.etag || cached.lastModified)) {
    const revalidated = await safeFetchConditional(url, {
      ifNoneMatch: cached.etag ?? undefined,
      ifModifiedSince: cached.lastModified ?? undefined,
      ...options,
    });
    if (revalidated.ok && revalidated.notModified) {
      await touchCachedPage(url);
      return { ok: true, html: cached.html, fromCache: true, contentUnchanged: true };
    }
    if (revalidated.ok && !revalidated.notModified) {
      await putCachedPage(url, revalidated.body, revalidated.status, revalidated.etag, revalidated.lastModified);
      return { ok: true, html: revalidated.body, fromCache: false, contentUnchanged: false };
    }
    // The conditional request itself failed (network/timeout/etc) — fall through to an
    // unconditional fetch below, exactly as if this row had no validator to try in the first place.
  }

  const fetched = await safeFetch(url, options);
  if (!fetched.ok) return { ok: false, html: null, fromCache: false, reason: fetched.reason };

  await putCachedPage(url, fetched.body, fetched.status, fetched.etag, fetched.lastModified);
  return { ok: true, html: fetched.body, fromCache: false };
}
