import "server-only";
import { randomUUID } from "node:crypto";
import type { Locale } from "@/i18n/routing";
import { routing } from "@/i18n/routing";
import { isEmptyCriteria, removeCriterion, type SearchCriteria } from "@/lib/search/request";
import type { ResultSource, UnifiedSearchResponse, VesselSearchResult } from "@/lib/search/offer";
import { rankResults } from "@/lib/search/ranking";
import { interpretQuery, type InterpretationOutcome } from "@/server/ai/query-interpreter";
import { buildSearchVocabulary } from "@/server/queries/search-vocabulary";
import { getSourceReliability } from "@/server/search/source-registry";
import { getInternalFirstSettings } from "@/server/queries/admin";
import { recordSearchRun } from "@/server/search/search-run-log";
import {
  readCachedInterpretation,
  writeCachedInterpretation,
} from "@/server/search/interpretation-cache";
import { emptyAdapterStats } from "@/server/search/adapters/adapter";
import { internalAdapter } from "@/server/search/adapters/internal-adapter";
import { listExternalAdaptersById } from "@/server/search/adapters/adapter-registry";
import { runCandidatePhase } from "@/server/search/orchestrator/candidate-phase";
import { runVerificationPhase } from "@/server/search/orchestrator/verification-phase";

/**
 * The Э6 search orchestrator (docs/AI_Federated_Search_Migration_Plan_v1.md §6, Арх §13, §14, §26),
 * replacing `global-search-service.ts`. Still split into the same two independently-awaited phases
 * that module's own doc comment explained (internal search is a fast, indexed Postgres query;
 * `discover/page.tsx` awaits it directly, then streams the rest into a `<Suspense>` boundary) — what
 * changed is what the second phase actually does:
 *
 *   - **Before Э6:** ran every external adapter's `search()` live, on every request — a real crawl of
 *     third-party sites in the request path.
 *   - **Э6 (Internal First, Арх §14):** if internal coverage alone already meets
 *     `min_internal_results` (`platform_settings`, off by default — see `getInternalFirstSettings`'s
 *     own doc comment), the external phase never runs at all; the user can still ask for it
 *     explicitly (`forceExternal`).
 *   - **Э6 (Candidate + Verification, Арх §13):** otherwise, Phase 1 (`candidate-phase.ts`) reads
 *     already-indexed listings from `external_vessel_index` — no live HTTP — merges/dedupes/ranks
 *     them against internal results, and keeps only the TOP N; Phase 2 (`verification-phase.ts`)
 *     live-verifies just that bounded slice.
 *
 * A request whose internal coverage is sufficient therefore makes zero external HTTP requests, and
 * one that isn't never crawls more than the small set it's about to actually show.
 */

export type GlobalSearchResponse = UnifiedSearchResponse<SearchCriteria>;

export interface InternalSearchPhaseOptions {
  locale: Locale;
  /** Criterion paths the user dismissed via the UI chips (spec §20) — applied *after*
   *  interpretation, since a chip is derived from the interpreted criteria. */
  removedCriteria?: string[];
  /** The UI's explicit "искать во внешних источниках" request (`?external=1`) — overrides Internal
   *  First's short-circuit even when internal coverage already meets `min_internal_results`. */
  forceExternal?: boolean;
}

export interface InternalSearchPhaseResult {
  searchId: string;
  query: string;
  locale: Locale;
  interpretedCriteria: SearchCriteria;
  interpretation: InterpretationOutcome;
  /** Ranked among themselves — `runExternalSearchPhase` re-ranks the combined set once external
   *  results exist, but section A (rendered immediately, before that) needs a sensible order too. */
  internalResults: VesselSearchResult[];
  rejectedForDates: number;
  startedAt: number;
  baseErrors: string[];
  /** Арх §14: true when internal coverage alone already met `min_internal_results` and the caller
   *  didn't force external search. `discover/page.tsx` renders a "search external sources anyway"
   *  link instead of ever calling `runExternalSearchPhase` — no Phase 1/Phase 2, no `<Suspense>`
   *  fallback either, since there is nothing left to wait for. */
  internalFirstShortCircuit: boolean;
}

/** Interpretation + internal search only (spec §5's fast half) — no network crawl, so this alone
 *  comfortably fits BRD §8's ≤1s budget on a warm interpretation-cache hit, and is bounded by one
 *  model call (`AI_CALL_TIMEOUT_MS`) on a miss. `discover/page.tsx` awaits this directly, outside any
 *  `<Suspense>` boundary. */
export async function runInternalSearchPhase(
  query: string,
  options: InternalSearchPhaseOptions,
): Promise<InternalSearchPhaseResult> {
  const startedAt = Date.now();
  const searchId = randomUUID();
  const errors: string[] = [];

  const vocabulary = await buildSearchVocabulary();
  let interpretation: InterpretationOutcome;
  const cached = readCachedInterpretation(options.locale, query);
  if (cached) {
    interpretation = cached;
  } else {
    interpretation = await interpretQuery({ query, vocabulary, locales: routing.locales });
    writeCachedInterpretation(options.locale, query, interpretation);
  }

  const criteria = (options.removedCriteria ?? []).reduce(removeCriterion, interpretation.criteria);

  // Э4: the internal catalogue is a `VesselSourceAdapter` like any other now, not a free function
  // called directly — `internalAdapter.search()` never throws (see `adapters/adapter.ts`'s own
  // "never throws" rule), so its `errors` entries fold straight into this phase's, no `.catch()`
  // needed here any more.
  const internalOutcome = await internalAdapter.search(criteria, {
    locale: options.locale,
    searchQueries: [],
    timeoutMs: 20_000,
  });
  errors.push(...internalOutcome.errors);

  const rankedInternal = rankResults(internalOutcome.results, criteria, {
    sourceReliability: await getSourceReliability().catch(() => ({})),
  });

  const internalFirstSettings = await getInternalFirstSettings().catch(() => ({ enabled: false, minInternalResults: 3 }));
  const internalFirstShortCircuit =
    internalFirstSettings.enabled &&
    !options.forceExternal &&
    rankedInternal.length >= internalFirstSettings.minInternalResults;

  // Nothing left to wait for once short-circuited — no Phase 1/Phase 2 will ever run for this
  // request, so this is the only chance to record the run at all (mirrors what `runExternalSearchPhase`
  // does for every other case, see its own doc comment).
  if (internalFirstShortCircuit) {
    const durationMs = Date.now() - startedAt;
    await recordSearchRun({
      id: searchId,
      locale: options.locale,
      query,
      criteria,
      interpretation,
      durationMs,
      internalResults: rankedInternal.length,
      externalResults: 0,
      duplicatesDetected: 0,
      pagesRejected: internalOutcome.rejectedForDates ?? 0,
      externalStats: emptyAdapterStats,
      externalPhase: "SKIPPED",
      // Internal First never asks the registry which sources would have covered this request —
      // that check itself is skipped along with everything else the external phase would have done.
      sourcesSkippedByCoverage: 0,
      candidatesFromIndex: 0,
      liveVerifications: 0,
      verificationFailures: 0,
      internalFirstShortCircuit: true,
      errors,
    });
  }

  return {
    searchId,
    query,
    locale: options.locale,
    interpretedCriteria: criteria,
    interpretation,
    internalResults: rankedInternal,
    rejectedForDates: internalOutcome.rejectedForDates ?? 0,
    startedAt,
    baseErrors: errors,
    internalFirstShortCircuit,
  };
}

export interface ExternalSearchPhaseOptions {
  verificationTimeoutMs?: number;
}

export interface ExternalSearchPhaseResult {
  /**
   * Only the externally-sourced rows that survived Phase 1's dedup as their own entry — never a
   * duplicate of what section A (internal results) already rendered. `dedupeResults` always keeps an
   * internal result as the merge's primary (`dedupe.ts`'s `preferPrimary`), so a vessel found both
   * internally and externally comes out still tagged `origin: "INTERNAL"` — this filters to
   * `origin === "EXTERNAL"`, which is therefore exactly the set with no internal counterpart already
   * on screen.
   */
  externalOnlyResults: VesselSearchResult[];
  sources: ResultSource[];
  meta: GlobalSearchResponse["meta"];
}

/** Candidate + verification (Э6's slow half) — awaited inside a `<Suspense>` boundary in
 *  `discover/page.tsx`, streamed in after section A already rendered `internalResults`. Never called
 *  when `internalPhase.internalFirstShortCircuit` is true — that path already recorded its own
 *  `search_runs` row inside `runInternalSearchPhase` and has nothing left for this function to do. */
export async function runExternalSearchPhase(
  internalPhase: InternalSearchPhaseResult,
  options: ExternalSearchPhaseOptions = {},
): Promise<ExternalSearchPhaseResult> {
  const criteria = internalPhase.interpretedCriteria;
  const errors = [...internalPhase.baseErrors];
  const sourceReliability = await getSourceReliability().catch(() => ({}));

  const candidatePhase = await runCandidatePhase(criteria, internalPhase.internalResults, { sourceReliability });

  const { byId: adaptersById } = await listExternalAdaptersById(criteria);
  const verification = await runVerificationPhase(candidatePhase.ranked, criteria, adaptersById, {
    locale: internalPhase.locale,
    sourceReliability,
    timeoutMs: options.verificationTimeoutMs,
  });

  // Final ranking (step 6): re-scored after Phase 2 (Э7) may have changed availability status/
  // confidence — a no-op against today's scoring factors (`ranking.ts` doesn't weigh either one yet;
  // that would be a ranking-factor change, out of Э7's own scope), but keeps this orchestrator
  // correct the moment it does, without another pass over this file.
  const ranked = rankResults(verification.results, criteria, { sourceReliability });
  const externalOnlyResults = ranked.filter((result) => result.origin === "EXTERNAL");

  const durationMs = Date.now() - internalPhase.startedAt;
  const sources = [
    ...new Map(
      ranked.flatMap((result) => [result.source, ...result.alternateSources]).map((source) => [source.url, source]),
    ).values(),
  ];

  const meta: GlobalSearchResponse["meta"] = {
    internalResults: internalPhase.internalResults.length,
    externalResults: candidatePhase.candidatesFromIndex,
    // No live crawl runs in this phase any more (Phase 1 reads the index, Phase 2's adapters are
    // still honest stubs) — `sourcesVisited` stays 0 rather than reporting a number that would
    // otherwise imply an HTTP request went out for it.
    sourcesChecked: 0,
    searchDurationMs: durationMs,
    interpretationDegraded: internalPhase.interpretation.mode !== "AI",
    externalPhase: "COMPLETE",
  };

  await recordSearchRun({
    id: internalPhase.searchId,
    locale: internalPhase.locale,
    query: internalPhase.query,
    criteria,
    interpretation: internalPhase.interpretation,
    durationMs,
    internalResults: internalPhase.internalResults.length,
    externalResults: candidatePhase.candidatesFromIndex,
    duplicatesDetected: candidatePhase.duplicatesDetected,
    pagesRejected: internalPhase.rejectedForDates,
    externalStats: emptyAdapterStats,
    externalPhase: meta.externalPhase,
    sourcesSkippedByCoverage: candidatePhase.skippedByCoverage,
    candidatesFromIndex: candidatePhase.candidatesFromIndex,
    liveVerifications: verification.liveVerifications,
    verificationFailures: verification.verificationFailures,
    internalFirstShortCircuit: false,
    errors,
  });

  return { externalOnlyResults, sources, meta };
}

/** Re-exported so callers can tell "understood nothing" from "understood, found nothing". */
export { isEmptyCriteria };
