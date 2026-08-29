import "server-only";

/**
 * Pieces `index/indexer.ts` (generic-tier indexing) and `index/brilions-indexer.ts` (brilions'
 * bespoke sitemap-and-extractor indexing) both need — kept in their own module rather than one
 * importing from the other, since `indexer.ts`'s public `indexSource` dispatcher imports
 * `indexBrilionsSource` and would otherwise create a cycle.
 */

export interface IndexRunResult {
  sourceId: string;
  urlsConsidered: number;
  pagesFetched: number;
  pagesFailed: number;
  pagesUnchanged: number;
  listingsIndexed: number;
  aiCalls: number;
}

export const emptyRunResult = (sourceId: string): IndexRunResult => ({
  sourceId,
  urlsConsidered: 0,
  pagesFetched: 0,
  pagesFailed: 0,
  pagesUnchanged: 0,
  listingsIndexed: 0,
  aiCalls: 0,
});

/** Э8: pacing moved to `resilience/rate-limiter.ts` (shared with `orchestrator/verification-phase.ts`
 *  now, not just the indexer) — re-exported here so this module's existing importers don't all need
 *  touching for the move. */
export { sleep, getRequestsPerSecond, throttle } from "@/server/search/resilience/rate-limiter";
