import type { SearchCriteria } from "@/lib/search/request";
import type {
  ContactCapability,
  OfferAvailabilityStatus,
  OfferConfidence,
  VesselSearchResult,
} from "@/lib/search/offer";
import type { Locale } from "@/i18n/routing";

/**
 * `VesselSourceAdapter` (docs/AI_Federated_Search_Migration_Plan_v1.md §6, Э4; Арх §10) — the seam
 * every source plugs into, internal catalogue included.
 *
 * Replaces `ExternalSearchProvider` (spec §7, §22, §23), which only ever expressed `search()`. That
 * was the whole interface while external search was the only thing worth abstracting; once the
 * internal catalogue and external sources are meant to sit behind one uniform list (Э4's own
 * "Готово когда"), the internal side needs the same shape — `internal-adapter.ts` implements this
 * exactly like `generic-adapter.ts`/`brilions-adapter.ts` do, not as a special case the orchestrator
 * branches on.
 *
 * `search()` keeps `ExternalSearchProvider`'s one unconditional rule, carried over verbatim because
 * it already proved itself: **never throws.** A single broken source must degrade the result set
 * (via `errors`), never fail the whole search. The three new methods (`getDetails`,
 * `checkAvailability`, `getContactCapability`) follow the same discipline — `getDetails`/
 * `checkAvailability` report failure through their own return shape (`null`, or an honest
 * `UNKNOWN`/low-confidence result) rather than rejecting.
 */

export interface AdapterContext {
  locale: Locale;
  /** Query variants generated for this search (spec §21), if the adapter wants them. */
  searchQueries: string[];
  /** Hard ceiling on wall-clock time for this call, in ms. */
  timeoutMs: number;
  /** Cooperative cancellation, so an abandoned search stops burning crawl budget. */
  signal?: AbortSignal;
}

/** Per-adapter counters, aggregated into `search_runs` for spec §26's metrics. */
export interface AdapterSearchStats {
  sourcesVisited: number;
  pagesVisited: number;
  pagesRejected: number;
  offersExtracted: number;
  aiCalls: number;
  /** Candidates served straight from `external_vessel_index` (design doc §4 P3) — no HTTP fetch,
   *  no AI call, not counted in `pagesVisited`/`aiCalls`. The measurable win P3 exists for. */
  pagesServedFromIndex: number;
  /** Candidates where a conditional GET (design doc §5.4) confirmed the page hadn't changed since
   *  the last extraction — a real request went out (unlike `pagesServedFromIndex`), but selectors/
   *  JSON-LD/AI never ran; the previous extraction was reused as-is. Not counted in `pagesVisited`
   *  or `aiCalls`. */
  pagesRevalidatedUnchanged: number;
}

export const emptyAdapterStats: AdapterSearchStats = {
  sourcesVisited: 0,
  pagesVisited: 0,
  pagesRejected: 0,
  offersExtracted: 0,
  aiCalls: 0,
  pagesServedFromIndex: 0,
  pagesRevalidatedUnchanged: 0,
};

export function mergeAdapterStats(stats: AdapterSearchStats[]): AdapterSearchStats {
  return stats.reduce<AdapterSearchStats>(
    (total, current) => ({
      sourcesVisited: total.sourcesVisited + current.sourcesVisited,
      pagesVisited: total.pagesVisited + current.pagesVisited,
      pagesRejected: total.pagesRejected + current.pagesRejected,
      offersExtracted: total.offersExtracted + current.offersExtracted,
      aiCalls: total.aiCalls + current.aiCalls,
      pagesServedFromIndex: total.pagesServedFromIndex + current.pagesServedFromIndex,
      pagesRevalidatedUnchanged: total.pagesRevalidatedUnchanged + current.pagesRevalidatedUnchanged,
    }),
    { ...emptyAdapterStats },
  );
}

export interface AdapterSearchResponse {
  results: VesselSearchResult[];
  stats: AdapterSearchStats;
  /** Candidates discarded because they were booked/blacked out for the requested window (internal
   *  adapter only, so far — a hard DB-backed filter, not a ranking signal). Absent (not 0) for an
   *  adapter that has no such concept, so the orchestrator can tell "didn't reject any" from
   *  "doesn't track rejection" if that distinction ever matters. */
  rejectedForDates?: number;
  errors: string[];
}

export interface AvailabilityResult {
  status: OfferAvailabilityStatus;
  /** `null` for a deterministic check (our own tables) — the same "absence is the signal" rule
   *  `OfferConfidence` already follows at the offer level (`offer.ts`'s `OfferConfidence` doc
   *  comment), just returned here instead of stamped onto a result row. */
  confidence: OfferConfidence;
}

export interface VesselSourceAdapter {
  readonly sourceId: string;

  /**
   * Whether this adapter is even wired up to attempt `request` at all — the source-level
   * eligibility check `provider-registry.ts`'s `isGenericEligible` used to make free-standing
   * (e.g. `HTML`/`HYBRID` needs a `selectorConfig`), now asked of the adapter itself. Independent of
   * `coverage.ts`'s `sourceCovers`: that asks "does this source serve the place `request` names",
   * this asks "can this adapter's extraction strategy attempt this request at all". Both must pass.
   */
  supports(request: SearchCriteria): boolean;

  /** Never throws — report a failure through `errors`, not a rejection (see this module's own doc
   *  comment). */
  search(request: SearchCriteria, ctx: AdapterContext): Promise<AdapterSearchResponse>;

  /**
   * A single offer's full detail, keyed by the adapter's own id space (`internalVesselId` for the
   * internal adapter, `externalId` for every other one — see `offer.ts`). `null` when the adapter
   * has no way to produce one (not found, or — for a source with no per-listing detail fetch
   * implemented yet — genuinely not attempted; `null` is the honest answer, not a placeholder for
   * "not implemented").
   */
  getDetails(externalId: string, ctx: AdapterContext): Promise<VesselSearchResult | null>;

  /**
   * Live availability for one offer over `[from, to]` (Арх §15). A source with no public calendar
   * honestly returns `{status: "UNKNOWN", confidence: null}` — that is the predicted, correct
   * outcome for such a source (Э4's own note: "not a shortcoming"), never a guess dressed up as a
   * verified fact.
   */
  checkAvailability(
    externalId: string,
    from: string,
    to: string,
    ctx: AdapterContext,
  ): Promise<AvailabilityResult>;

  /** How a user can act on an offer from this adapter (Арх §20) — a per-adapter default, since a
   *  contact channel is a property of the source, not of one particular offer. */
  getContactCapability(): ContactCapability;
}
