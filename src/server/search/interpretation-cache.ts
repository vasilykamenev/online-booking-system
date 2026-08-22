import "server-only";
import type { InterpretationOutcome } from "@/server/ai/query-interpreter";

/**
 * A minimal `SearchCache` for query interpretation (spec §25).
 *
 * It exists because of how criteria chips work: removing one criterion re-runs the search with the
 * same free-text query, and without a cache each removal would pay for a fresh model call to
 * re-derive an interpretation we already had. The same applies to a page refresh or a shared link.
 *
 * Process-local and bounded on purpose. A durable cross-instance cache belongs in Postgres or
 * Redis alongside the page and extraction caches spec §25 also calls for; this covers the hot path
 * (one user refining one query) without adding infrastructure, and it degrades to a plain cache
 * miss on a cold start or another instance.
 */

interface CacheEntry {
  outcome: InterpretationOutcome;
  storedAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 200;

const cache = new Map<string, CacheEntry>();

function cacheKey(locale: string, query: string): string {
  return `${locale}:${query.trim().toLowerCase()}`;
}

export function readCachedInterpretation(
  locale: string,
  query: string,
  now = Date.now(),
): InterpretationOutcome | null {
  const entry = cache.get(cacheKey(locale, query));
  if (!entry) return null;
  if (now - entry.storedAt > TTL_MS) {
    cache.delete(cacheKey(locale, query));
    return null;
  }
  return entry.outcome;
}

export function writeCachedInterpretation(
  locale: string,
  query: string,
  outcome: InterpretationOutcome,
  now = Date.now(),
): void {
  // A degraded interpretation must not be cached: it is usually the result of a transient failure
  // (timeout, rate limit), and caching it would pin the user to the worse answer for ten minutes.
  if (outcome.mode !== "AI") return;

  const key = cacheKey(locale, query);
  // Insertion-ordered eviction — `Map` preserves order, so the first key is the oldest.
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { outcome, storedAt: now });
}

/** Test seam — production code never needs to clear this. */
export function clearInterpretationCache(): void {
  cache.clear();
}
