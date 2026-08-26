import "server-only";
import { randomUUID } from "node:crypto";
import type { Locale } from "@/i18n/routing";
import { routing } from "@/i18n/routing";
import { isEmptyCriteria, removeCriterion, type SearchCriteria } from "@/lib/search/criteria";
import { dedupeResults } from "@/lib/search/dedupe";
import { rankResults } from "@/lib/search/ranking";
import type { ResultSource, UnifiedSearchResponse, VesselSearchResult } from "@/lib/search/result";
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
  emptyExternalStats,
  mergeExternalStats,
  type ExternalSearchOutcome,
  type ExternalSearchProvider,
} from "@/server/search/providers";

/**
 * `GlobalVesselSearchService` (spec §5) — the orchestrator, split into two independently-awaited
 * phases (see `docs/data-merger-provenance-design.md`'s sibling performance note — internal search is
 * a fast, indexed Postgres query; external search is a live, budgeted crawl that can take seconds).
 *
 * Historically both ran inside one `Promise.all` and the whole response waited for the slower of the
 * two — which defeated the internal phase's own speed and directly contradicted BRD §8's ≤1s budget
 * for it. `runInternalSearchPhase` now returns as soon as internal search is done; `discover/page.tsx`
 * renders those results immediately and streams `runExternalSearchPhase`'s results into a
 * `<Suspense>` boundary once the external crawl (or timeout) resolves. Dedup/ranking correctness is
 * preserved by computing `dedupeResults`/`rankResults` over BOTH sets together, same as before — see
 * `runExternalSearchPhase`'s doc comment for how the two phases avoid rendering the same vessel twice.
 */

export type GlobalSearchResponse = UnifiedSearchResponse<SearchCriteria>;

const DEFAULT_EXTERNAL_TIMEOUT_MS = 20_000;

export interface InternalSearchPhaseOptions {
  locale: Locale;
  /** Criterion paths the user dismissed via the UI chips (spec §20) — applied *after*
   *  interpretation, since a chip is derived from the interpreted criteria. */
  removedCriteria?: string[];
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

  const internalOutcome = await searchInternalVessels(criteria, options.locale).catch((error: unknown) => {
    errors.push(`internal: ${String(error)}`);
    return { results: [] as VesselSearchResult[], rejectedForDates: 0 };
  });

  const rankedInternal = rankResults(internalOutcome.results, criteria, {
    sourceReliability: await getSourceReliability().catch(() => ({})),
  });

  return {
    searchId,
    query,
    locale: options.locale,
    interpretedCriteria: criteria,
    interpretation,
    internalResults: rankedInternal,
    rejectedForDates: internalOutcome.rejectedForDates,
    startedAt,
    baseErrors: errors,
  };
}

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
  options: { locale: Locale; timeoutMs: number; signal?: AbortSignal },
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
            stats: { ...emptyExternalStats },
            errors: [`${providers[index].id}: ${String(outcome.reason)}`],
          },
        },
  );
}

export interface ExternalSearchPhaseOptions {
  externalProviders: ExternalSearchProvider[];
  externalTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface ExternalSearchPhaseResult {
  /**
   * Only the externally-sourced rows that survived deduplication as their own entry — never a
   * duplicate of what section A (internal results) already rendered. `dedupeResults` always keeps an
   * internal result as the merge's primary (`dedupe.ts`'s `preferPrimary`), so a vessel found both
   * internally and externally comes out of `dedupeResults` still tagged `origin: "INTERNAL"` — this
   * filters to `origin === "EXTERNAL"`, which is therefore exactly the set with no internal
   * counterpart already on screen. The one accepted trade-off: that merged vessel's `alternateSources`
   * (the "also listed on…" line) won't retroactively appear on the already-rendered internal card —
   * true only for the rare vessel listed both on our platform and scraped externally.
   */
  externalOnlyResults: VesselSearchResult[];
  sources: ResultSource[];
  meta: GlobalSearchResponse["meta"];
}

/** External crawl + combine (spec §5's slow half) — awaited inside a `<Suspense>` boundary in
 *  `discover/page.tsx`, streamed in after section A already rendered `internalResults`. */
export async function runExternalSearchPhase(
  internalPhase: InternalSearchPhaseResult,
  options: ExternalSearchPhaseOptions,
): Promise<ExternalSearchPhaseResult> {
  const providers = options.externalProviders;
  const errors = [...internalPhase.baseErrors];

  const externalOutcomes =
    providers.length > 0
      ? await runExternalProviders(providers, internalPhase.interpretedCriteria, {
          locale: internalPhase.locale,
          timeoutMs: options.externalTimeoutMs ?? DEFAULT_EXTERNAL_TIMEOUT_MS,
          signal: options.signal,
        })
      : [];

  const externalResults = externalOutcomes.flatMap((run) => run.outcome.results);
  const externalStats = mergeExternalStats(externalOutcomes.map((run) => run.outcome.stats));
  const anyProviderHardFailed = externalOutcomes.some((run) => run.hardFailed);
  errors.push(...externalOutcomes.flatMap((run) => run.outcome.errors));

  // Aggregate, deduplicate, rank (spec §16-§18) — over BOTH sets together, same as before the split,
  // so a vessel found in both worlds still collapses into one row (just not the one rendered in
  // section A — see this function's own return-type doc comment).
  const combined = [...internalPhase.internalResults, ...externalResults];
  const deduped = dedupeResults(combined);
  const ranked = rankResults(deduped, internalPhase.interpretedCriteria, {
    sourceReliability: await getSourceReliability().catch(() => ({})),
  });
  const externalOnlyResults = ranked.filter((result) => result.origin === "EXTERNAL");

  const durationMs = Date.now() - internalPhase.startedAt;
  const sources = [
    ...new Map(
      ranked.flatMap((result) => [result.source, ...result.alternateSources]).map((source) => [source.url, source]),
    ).values(),
  ];

  const meta: GlobalSearchResponse["meta"] = {
    internalResults: internalPhase.internalResults.length,
    externalResults: externalResults.length,
    sourcesChecked: externalStats.sourcesVisited,
    searchDurationMs: durationMs,
    interpretationDegraded: internalPhase.interpretation.mode !== "AI",
    // Driven by whether a provider actually broke its contract (`hardFailed`), not by whether
    // `errors` is non-empty: a provider correctly declining to act (no location in the query,
    // robots.txt disallow) reports that via `errors` too, and that is not a failure.
    externalPhase: providers.length === 0 ? "SKIPPED" : anyProviderHardFailed ? "FAILED" : "COMPLETE",
  };

  // Observability (spec §26). Awaited rather than fire-and-forget for the same reason as before the
  // split: a floating promise is not guaranteed to survive the response on serverless.
  await recordSearchRun({
    id: internalPhase.searchId,
    locale: internalPhase.locale,
    query: internalPhase.query,
    criteria: internalPhase.interpretedCriteria,
    interpretation: internalPhase.interpretation,
    durationMs,
    internalResults: internalPhase.internalResults.length,
    externalResults: externalResults.length,
    duplicatesDetected: combined.length - deduped.length,
    pagesRejected: externalStats.pagesRejected + internalPhase.rejectedForDates,
    externalStats,
    externalPhase: meta.externalPhase,
    errors,
  });

  return { externalOnlyResults, sources, meta };
}

/** Re-exported so callers can tell "understood nothing" from "understood, found nothing". */
export { isEmptyCriteria };
