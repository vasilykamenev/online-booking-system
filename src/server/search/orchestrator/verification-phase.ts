import "server-only";
import type { Locale } from "@/i18n/routing";
import type { SearchCriteria } from "@/lib/search/request";
import type { VesselSearchResult } from "@/lib/search/offer";
import type { VesselSourceAdapter } from "@/server/search/adapters/adapter";
import { deriveAvailability } from "@/lib/search/availability";

/**
 * Э6's Phase 2 (docs/AI_Federated_Search_Migration_Plan_v1.md §6, Арх §13, step 4): live
 * `checkAvailability` for the TOP N external candidates `candidate-phase.ts` selected — parallel,
 * per-adapter timeout, bounded concurrency. The live call itself is only attempted when the query
 * names an exact date window: `checkAvailability` needs a concrete `[from, to]`, and inventing one
 * for a month-only or date-less query would be exactly the kind of guess CLAUDE.md's "never invent
 * missing data" rule forbids.
 *
 * Every current adapter's `checkAvailability` is an honest stub (`adapter.ts`'s own note: no source
 * publishes a checkable calendar yet), so today the live call's real effect is exercising the
 * plumbing and reporting `liveVerifications`/`verificationFailures` — not yet changing any result's
 * status via a real per-request confirmation. What this phase changes for *every* external result,
 * live check attempted or not, is Э7's `deriveAvailability` (Арх §15): a freshly-indexed candidate
 * that no live check ever touched still stops defaulting to a bare `UNKNOWN` and instead reports
 * `LIKELY_AVAILABLE` from index freshness alone, once the source's reliability and the row's own
 * `indexed_at` justify it — see that module's own doc comment for why this is never persisted back
 * onto `external_vessel_index` for reuse by a *different* date window.
 */

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_CONCURRENCY = 4;

export interface VerificationPhaseOptions {
  locale: Locale;
  /** Domain → reliability (0.0–1.0), the same shape `ranking.ts`'s `RankingOptions` already uses —
   *  `deriveAvailability`'s confidence tiering needs it too. */
  sourceReliability: Record<string, number>;
  timeoutMs?: number;
  concurrency?: number;
}

export interface VerificationPhaseResult {
  /** Same rows as the input, in the same order, minus any that came back `UNAVAILABLE` (step 5:
   *  "выбросить UNAVAILABLE") — an internal or unverified result is never dropped here, only one a
   *  live check just confirmed is gone. */
  results: VesselSearchResult[];
  liveVerifications: number;
  verificationFailures: number;
}

/** Runs `items` through `worker` with at most `concurrency` in flight at once — Phase 2's own
 *  "ограничение concurrency" requirement. `TOP_N` is small enough that this rarely matters in
 *  practice today, but the bound must exist independent of how small the input happens to be. */
async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function runOne(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runOne));
  return results;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("verification timed out")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function runVerificationPhase(
  ranked: VesselSearchResult[],
  criteria: SearchCriteria,
  adaptersById: Map<string, VesselSourceAdapter>,
  options: VerificationPhaseOptions,
): Promise<VerificationPhaseResult> {
  const from = criteria.date?.from ?? null;
  const to = criteria.date?.to ?? null;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  let liveVerifications = 0;
  let verificationFailures = 0;
  const now = Date.now();

  const verified = await mapWithConcurrency(ranked, concurrency, async (result) => {
    if (result.origin !== "EXTERNAL") return result;
    const reliability = result.source.domain ? (options.sourceReliability[result.source.domain] ?? null) : null;

    let liveVerification: { status: VesselSearchResult["availabilityStatus"]; confidence: VesselSearchResult["confidence"] } | null = null;
    let verifiedAt = result.verifiedAt;

    const adapter = result.sourceId ? adaptersById.get(result.sourceId) : undefined;
    if (from && to && adapter && result.externalId) {
      liveVerifications += 1;
      try {
        const outcome = await withTimeout(
          adapter.checkAvailability(result.externalId, from, to, {
            locale: options.locale,
            searchQueries: [],
            timeoutMs,
          }),
          timeoutMs,
        );
        liveVerification = outcome;
        verifiedAt = new Date(now).toISOString();
      } catch {
        // Honest degrade, same discipline as `VesselSourceAdapter.search()`'s own "never throw" rule
        // (adapter.ts) — a broken or timed-out check must not sink the whole verification pass, it
        // just falls through to the freshness-only inference below, same as never attempting one.
        verificationFailures += 1;
      }
    }

    const derived = deriveAvailability({
      origin: result.origin,
      now,
      indexedAt: result.indexedAt,
      liveVerification,
      sourceReliability: reliability,
    });

    return { ...result, availabilityStatus: derived.status, confidence: derived.confidence, verifiedAt };
  });

  return {
    results: verified.filter((result) => result.availabilityStatus !== "UNAVAILABLE"),
    liveVerifications,
    verificationFailures,
  };
}
