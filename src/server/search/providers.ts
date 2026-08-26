import type { SearchCriteria } from "@/lib/search/criteria";
import type { VesselSearchResult } from "@/lib/search/result";
import type { Locale } from "@/i18n/routing";

/**
 * The seam every external source plugs into (spec §7, §22).
 *
 * It is intentionally the *only* thing `GlobalVesselSearchService` knows about the outside world.
 * Crawling, robots.txt, structured-data parsing, AI extraction and per-site quirks all live behind
 * this interface, which is what lets spec §23's "generic web search layer" be swapped in later —
 * or reused for hotels or aircraft — without the orchestrator changing at all.
 *
 * A provider must never throw: a single unreachable site cannot be allowed to fail a whole search.
 * Report the failure in `errors` and return whatever was gathered.
 */

export interface ExternalSearchContext {
  locale: Locale;
  /** Query variants generated for this search (spec §21), if the provider wants them. */
  searchQueries: string[];
  /** Hard ceiling on wall-clock time for this provider, in ms. */
  timeoutMs: number;
  /** Cooperative cancellation, so an abandoned search stops burning crawl budget. */
  signal?: AbortSignal;
}

/** Per-provider counters, aggregated into `search_runs` for spec §26's metrics. */
export interface ExternalSearchStats {
  sourcesVisited: number;
  pagesVisited: number;
  pagesRejected: number;
  offersExtracted: number;
  aiCalls: number;
  /** Candidates served straight from `search_extracted_listings` (design doc §4 P3) — no HTTP fetch,
   *  no AI call, not counted in `pagesVisited`/`aiCalls`. The measurable win P3 exists for. */
  pagesServedFromIndex: number;
  /** Candidates where a conditional GET (design doc §5.4) confirmed the page hadn't changed since
   *  the last extraction — a real request went out (unlike `pagesServedFromIndex`), but selectors/
   *  JSON-LD/AI never ran; the previous extraction was reused as-is. Not counted in `pagesVisited`
   *  or `aiCalls`. */
  pagesRevalidatedUnchanged: number;
}

export interface ExternalSearchOutcome {
  results: VesselSearchResult[];
  stats: ExternalSearchStats;
  errors: string[];
}

export interface ExternalSearchProvider {
  readonly id: string;
  search(criteria: SearchCriteria, context: ExternalSearchContext): Promise<ExternalSearchOutcome>;
}

export const emptyExternalStats: ExternalSearchStats = {
  sourcesVisited: 0,
  pagesVisited: 0,
  pagesRejected: 0,
  offersExtracted: 0,
  aiCalls: 0,
  pagesServedFromIndex: 0,
  pagesRevalidatedUnchanged: 0,
};

export function mergeExternalStats(stats: ExternalSearchStats[]): ExternalSearchStats {
  return stats.reduce<ExternalSearchStats>(
    (total, current) => ({
      sourcesVisited: total.sourcesVisited + current.sourcesVisited,
      pagesVisited: total.pagesVisited + current.pagesVisited,
      pagesRejected: total.pagesRejected + current.pagesRejected,
      offersExtracted: total.offersExtracted + current.offersExtracted,
      aiCalls: total.aiCalls + current.aiCalls,
      pagesServedFromIndex: total.pagesServedFromIndex + current.pagesServedFromIndex,
      pagesRevalidatedUnchanged: total.pagesRevalidatedUnchanged + current.pagesRevalidatedUnchanged,
    }),
    { ...emptyExternalStats },
  );
}
