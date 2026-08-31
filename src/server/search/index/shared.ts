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

/** Threaded from `indexSource` into `indexGenericSource`/`indexBrilionsSource` — bundled into one
 *  object rather than positional params now that there are three, to keep call sites unambiguous. */
export interface RunOptions {
  /** Batch-boundary cursor from a resumed run (`beginResume`) — 0 for a fresh run. */
  startFrom: number;
  /** How many candidates the batch loop processes at once — `getReindexConcurrency()`. */
  concurrency: number;
  /** Absolute `Date.now()`-comparable deadline (`getReindexMaxDurationSeconds()`) — once reached,
   *  the batch loop stops itself cleanly between batches, exactly like a manual Stop
   *  (`reindex-progress.ts`'s `cancelReindexProgress`), rather than risking Vercel's own hard
   *  `maxDuration` killing the run mid-batch. */
  deadlineAt: number;
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
