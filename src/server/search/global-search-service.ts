import "server-only";
import { randomUUID } from "node:crypto";
import type { Locale } from "@/i18n/routing";
import { routing } from "@/i18n/routing";
import { isEmptyCriteria, removeCriterion, type SearchCriteria } from "@/lib/search/criteria";
import { dedupeResults } from "@/lib/search/dedupe";
import { rankResults } from "@/lib/search/ranking";
import type { UnifiedSearchResponse, VesselSearchResult } from "@/lib/search/result";
import { interpretQuery, type InterpretationOutcome } from "@/server/ai/query-interpreter";
import { buildSearchVocabulary } from "@/server/queries/search-vocabulary";
import { searchInternalVessels } from "@/server/search/internal-provider";
import { getSourceReliability } from "@/server/search/source-registry";
import { recordSearchRun } from "@/server/search/search-run-log";
import {
  readCachedInterpretation,
  writeCachedInterpretation,
} from "@/server/search/interpretation-cache";
import {
  mergeExternalStats,
  type ExternalSearchOutcome,
  type ExternalSearchProvider,
} from "@/server/search/providers";

/**
 * `GlobalVesselSearchService` (spec §5) — the orchestrator.
 *
 * It owns the pipeline order and nothing else: interpret → search internal and external
 * independently → normalize → deduplicate → rank → return. Spec §2's dividing line is enforced
 * here, in that every step below is deterministic code; the only AI in the whole flow sits behind
 * `interpretQuery` (and, later, behind an extraction provider).
 *
 * External search is a separate phase on purpose. BRD §8 budgets a search response at one second,
 * which no amount of crawling will ever fit inside, so internal results return immediately and the
 * external phase is reported through `meta.externalPhase` rather than blocking the response.
 */

export type GlobalSearchResponse = UnifiedSearchResponse<SearchCriteria>;

export interface GlobalSearchOptions {
  locale: Locale;
  /**
   * Criterion paths the user dismissed via the UI chips (spec §20), in `criteriaToChips`'s
   * vocabulary. Applied *after* interpretation, since a chip is derived from the interpreted
   * criteria — which also means the removals survive in a shared URL without the criteria
   * themselves having to travel in it.
   */
  removedCriteria?: string[];
  /**
   * External providers to consult. Empty by default: the Source Registry is populated first
   * (spec §8's "known sources" stage) and providers are enabled per source from there.
   */
  externalProviders?: ExternalSearchProvider[];
  externalTimeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_EXTERNAL_TIMEOUT_MS = 20_000;

/** An outcome plus whether the provider actually broke its "never throw" contract. */
interface ExternalProviderRun {
  outcome: ExternalSearchOutcome;
  /** True only when the provider's promise rejected — a real bug, distinct from a provider
   *  correctly returning zero results with an explanatory entry in `outcome.errors` (e.g. "no
   *  location in the query"), which is expected behavior, not a failure. */
  hardFailed: boolean;
}

/**
 * Runs every provider concurrently and never lets one failure sink the batch — spec §7's registry
 * is explicitly a set of independent sources, so a dead site must degrade the result set, not the
 * request.
 */
async function runExternalProviders(
  providers: ExternalSearchProvider[],
  criteria: SearchCriteria,
  options: Required<Pick<GlobalSearchOptions, "locale">> & { timeoutMs: number; signal?: AbortSignal },
): Promise<ExternalProviderRun[]> {
  const settled = await Promise.allSettled(
    providers.map((provider) =>
      provider.search(criteria, {
        locale: options.locale,
        searchQueries: [],
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      }),
    ),
  );

  return settled.map((outcome, index) =>
    outcome.status === "fulfilled"
      ? { outcome: outcome.value, hardFailed: false }
      : {
          hardFailed: true,
          outcome: {
            results: [],
            stats: { sourcesVisited: 0, pagesVisited: 0, pagesRejected: 0, offersExtracted: 0, aiCalls: 0 },
            errors: [`${providers[index].id}: ${String(outcome.reason)}`],
          },
        },
  );
}

export async function runGlobalVesselSearch(
  query: string,
  options: GlobalSearchOptions,
): Promise<GlobalSearchResponse> {
  const startedAt = Date.now();
  const searchId = randomUUID();
  const providers = options.externalProviders ?? [];
  const errors: string[] = [];

  // Understand the query ------------------------------------------------
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

  // Search both worlds independently (spec §5) --------------------------
  const [internalOutcome, externalOutcomes] = await Promise.all([
    searchInternalVessels(criteria, options.locale).catch((error: unknown) => {
      errors.push(`internal: ${String(error)}`);
      return { results: [] as VesselSearchResult[], rejectedForDates: 0 };
    }),
    providers.length > 0
      ? runExternalProviders(providers, criteria, {
          locale: options.locale,
          timeoutMs: options.externalTimeoutMs ?? DEFAULT_EXTERNAL_TIMEOUT_MS,
          signal: options.signal,
        })
      : Promise.resolve([]),
  ]);

  const externalResults = externalOutcomes.flatMap((run) => run.outcome.results);
  const externalStats = mergeExternalStats(externalOutcomes.map((run) => run.outcome.stats));
  const anyProviderHardFailed = externalOutcomes.some((run) => run.hardFailed);
  errors.push(...externalOutcomes.flatMap((run) => run.outcome.errors));

  // Aggregate, deduplicate, rank (spec §16-§18) -------------------------
  const combined = [...internalOutcome.results, ...externalResults];
  const deduped = dedupeResults(combined);
  const ranked = rankResults(deduped, criteria, {
    sourceReliability: await getSourceReliability().catch(() => ({})),
  });

  const durationMs = Date.now() - startedAt;
  const sources = [
    ...new Map(
      ranked.flatMap((result) => [result.source, ...result.alternateSources]).map((source) => [source.url, source]),
    ).values(),
  ];

  const response: GlobalSearchResponse = {
    searchId,
    query,
    interpretedCriteria: criteria,
    results: ranked,
    sources,
    meta: {
      internalResults: internalOutcome.results.length,
      externalResults: externalResults.length,
      sourcesChecked: externalStats.sourcesVisited,
      searchDurationMs: durationMs,
      interpretationDegraded: interpretation.mode !== "AI",
      // Driven by whether a provider actually broke its contract (`hardFailed`), not by whether
      // `errors` is non-empty: a provider correctly declining to act (no location in the query,
      // robots.txt disallow) reports that via `errors` too, and that is not a failure.
      externalPhase: providers.length === 0 ? "SKIPPED" : anyProviderHardFailed ? "FAILED" : "COMPLETE",
    },
  };

  // Observability (spec §26). Awaited rather than fire-and-forget: a floating promise is not
  // guaranteed to survive the response on serverless, and silently losing the metrics that make
  // search quality measurable costs more than one INSERT on the critical path. `recordSearchRun`
  // swallows its own failures, so this can never fail the search.
  await recordSearchRun({
    id: searchId,
    locale: options.locale,
    query,
    criteria,
    interpretation,
    durationMs,
    internalResults: internalOutcome.results.length,
    externalResults: externalResults.length,
    duplicatesDetected: combined.length - deduped.length,
    pagesRejected: externalStats.pagesRejected + internalOutcome.rejectedForDates,
    externalStats,
    externalPhase: response.meta.externalPhase,
    errors,
  });

  return response;
}

/** Re-exported so callers can tell "understood nothing" from "understood, found nothing". */
export { isEmptyCriteria };
