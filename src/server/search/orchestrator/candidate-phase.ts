import "server-only";
import type { SearchCriteria } from "@/lib/search/request";
import { matchesKnownCriteria } from "@/lib/search/match-criteria";
import { dedupeResults } from "@/lib/search/dedupe";
import { rankResults, type RankingOptions } from "@/lib/search/ranking";
import type { VesselSearchResult } from "@/lib/search/offer";
import { listExternalAdaptersById } from "@/server/search/adapters/adapter-registry";
import { queryIndexCandidates } from "@/server/search/index/vessel-index";

/**
 * Э6's Phase 1 (docs/AI_Federated_Search_Migration_Plan_v1.md §6, Арх §13, step 3): reads
 * `external_vessel_index` directly instead of crawling every adapter live — the background indexer
 * (Э5) already did that work out-of-band. Combines with the (already-ranked-among-themselves)
 * internal results, dedupes, ranks the combined set, and returns only the TOP N — `verification-phase.ts`
 * only ever needs to look at that bounded slice, never the full candidate pool.
 */

/** How many of the combined, ranked results get a shot at Phase 2's live verification. Small on
 *  purpose: a per-adapter live check is real network I/O (once an adapter actually implements one —
 *  see `adapter.ts`'s honest `UNKNOWN` stub note), and nothing past what a result page actually shows
 *  needs verifying yet. */
export const TOP_N = 12;

export interface CandidatePhaseResult {
  ranked: VesselSearchResult[];
  /** Rows `queryIndexCandidates` returned before dedup/ranking/TOP-N — "how many did we find",
   *  the Э6 counterpart to the pre-Э6 external phase's raw `externalResults.length` (search_runs'
   *  new `candidates_from_index` column). */
  candidatesFromIndex: number;
  /** `combined.length - deduped.length`, computed *before* the TOP-N cut below — the cut discards
   *  candidates for being low-ranked, not for being duplicates, so counting it here would conflate
   *  the two and understate real duplication whenever more than `TOP_N` candidates existed. */
  duplicatesDetected: number;
  /** Э3 (Арх §9), carried through unchanged from `listExternalAdaptersById`. */
  skippedByCoverage: number;
}

export async function runCandidatePhase(
  criteria: SearchCriteria,
  internalResults: VesselSearchResult[],
  rankingOptions: RankingOptions,
): Promise<CandidatePhaseResult> {
  const { byId, skippedByCoverage } = await listExternalAdaptersById(criteria);
  const sourceIds = [...byId.keys()];

  const indexed = await queryIndexCandidates(criteria, sourceIds);
  const matched = indexed.filter((result) => matchesKnownCriteria(result, criteria));

  const combined = [...internalResults, ...matched];
  const deduped = dedupeResults(combined);
  const ranked = rankResults(deduped, criteria, rankingOptions).slice(0, TOP_N);

  return {
    ranked,
    candidatesFromIndex: matched.length,
    duplicatesDetected: combined.length - deduped.length,
    skippedByCoverage,
  };
}
