import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Locale } from "@/i18n/routing";
import type { SearchCriteria } from "@/lib/search/request";
import type { InterpretationOutcome } from "@/server/ai/query-interpreter";
import type { AdapterSearchStats } from "@/server/search/adapters/adapter";
import { getCurrentProfile } from "@/server/queries/profile";

/**
 * Spec §26's observability record. Every counter here answers "why did this search return what it
 * did" — without them, tuning ranking or extraction is guesswork rather than measurement.
 *
 * Written with the service-role client on purpose: `search_runs` has a select-only policy, so a
 * client can read its own history but can never forge or edit an entry. Same reasoning as
 * `payments` (CLAUDE.md §8).
 */

/** Current shape of `interpreted_criteria` — bump alongside `SearchCriteria` whenever its shape
 *  changes again, so old rows in `search_runs` stay distinguishable (see the migration adding
 *  `request_version`). */
export const CURRENT_REQUEST_VERSION = 2;

export interface SearchRunRecord {
  id: string;
  locale: Locale;
  query: string;
  criteria: SearchCriteria;
  interpretation: InterpretationOutcome;
  durationMs: number;
  internalResults: number;
  externalResults: number;
  duplicatesDetected: number;
  pagesRejected: number;
  externalStats: AdapterSearchStats;
  externalPhase: "SKIPPED" | "PENDING" | "COMPLETE" | "FAILED";
  /** Э3 (Арх §9) — enabled sources this run never consulted because their coverage didn't include
   *  the request's location. */
  sourcesSkippedByCoverage: number;
  /** Э6 (Арх §13, §14) — rows `candidate-phase.ts` pulled from `external_vessel_index` before
   *  dedup/ranking/TOP-N; 0 when Internal First short-circuited or no source covered the request. */
  candidatesFromIndex: number;
  /** Э6 — `checkAvailability` calls `verification-phase.ts` actually attempted for the TOP-N
   *  external candidates, and how many of those broke the adapter's own "never throw" contract. */
  liveVerifications: number;
  verificationFailures: number;
  /** Э6 (Арх §14) — true when internal coverage alone met `min_internal_results` and the external
   *  phase never ran at all. */
  internalFirstShortCircuit: boolean;
  /** Э8 (Арх §23) — live checks this run skipped outright because that source's circuit breaker was
   *  OPEN, distinct from `verificationFailures` (attempted and broke). */
  circuitBreakerSkips: number;
  errors: string[];
}

export async function recordSearchRun(record: SearchRunRecord): Promise<void> {
  try {
    // Anonymous search is allowed, so a missing profile is normal rather than an error.
    const profile = await getCurrentProfile().catch(() => null);

    await createAdminClient()
      .from("search_runs")
      .insert({
        id: record.id,
        user_id: profile?.id ?? null,
        locale: record.locale,
        original_query: record.query,
        interpreted_criteria: record.criteria,
        request_version: CURRENT_REQUEST_VERSION,
        interpretation_mode: record.interpretation.mode,
        degraded_reason: record.interpretation.degradedReason ?? null,
        sources_visited: record.externalStats.sourcesVisited,
        pages_visited: record.externalStats.pagesVisited,
        pages_from_index: record.externalStats.pagesServedFromIndex,
        pages_revalidated_unchanged: record.externalStats.pagesRevalidatedUnchanged,
        pages_rejected: record.pagesRejected,
        offers_extracted: record.externalStats.offersExtracted,
        offers_normalized: record.externalResults,
        duplicates_detected: record.duplicatesDetected,
        internal_results: record.internalResults,
        external_results: record.externalResults,
        ai_calls: record.interpretation.mode === "AI" ? 1 + record.externalStats.aiCalls : record.externalStats.aiCalls,
        execution_ms: record.durationMs,
        external_phase: record.externalPhase,
        sources_skipped_by_coverage: record.sourcesSkippedByCoverage,
        candidates_from_index: record.candidatesFromIndex,
        live_verifications: record.liveVerifications,
        verification_failures: record.verificationFailures,
        internal_first_short_circuit: record.internalFirstShortCircuit,
        circuit_breaker_skips: record.circuitBreakerSkips,
        errors: record.errors,
      });
  } catch {
    // Telemetry is never worth failing a user's search over — and the migration may simply not be
    // applied yet on this environment.
  }
}
