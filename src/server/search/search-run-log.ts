import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Locale } from "@/i18n/routing";
import type { SearchCriteria } from "@/lib/search/criteria";
import type { InterpretationOutcome } from "@/server/ai/query-interpreter";
import type { ExternalSearchStats } from "@/server/search/providers";
import { getCurrentProfile } from "@/server/queries/profile";

/**
 * Spec §26's observability record. Every counter here answers "why did this search return what it
 * did" — without them, tuning ranking or extraction is guesswork rather than measurement.
 *
 * Written with the service-role client on purpose: `search_runs` has a select-only policy, so a
 * client can read its own history but can never forge or edit an entry. Same reasoning as
 * `payments` (CLAUDE.md §8).
 */

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
  externalStats: ExternalSearchStats;
  externalPhase: "SKIPPED" | "PENDING" | "COMPLETE" | "FAILED";
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
        errors: record.errors,
      });
  } catch {
    // Telemetry is never worth failing a user's search over — and the migration may simply not be
    // applied yet on this environment.
  }
}
